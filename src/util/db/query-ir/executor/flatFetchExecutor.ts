// ============================================================
// Flat Fetch — Executor
//
// フローエディタでフィルタ済みの post_ids / notification_ids を受け取り、
// 最小限のクエリで表示データを取得する。Worker 内で同期実行される。
//
// 実行フロー:
//   1. コア post クエリ (id IN postIds)
//   2. reblog_of_post_id 抽出 → 親 post 取得
//   3. コア notification クエリ (id IN notificationIds)
//   4. related_post_id 抽出 → 追加 post 取得
//   5. 全 post_ids でバッチクエリ ×8
//   6. 通知アクター profile_id でプロフィール絵文字バッチ
//   7. Assemble → FlatFetchResult
// ============================================================

import type { SqliteStoredNotification } from '../../sqlite/notificationStore'
import type { DbExec } from '../../sqlite/queries/executionEngine'
import {
  BATCH_PROFILE_EMOJIS_BY_ID_SQL,
  buildNotificationFlatQuery,
  buildPostFlatQuery,
} from '../../sqlite/queries/flatSelect'
import type { BatchMaps } from '../../sqlite/queries/statusBatch'
import { BATCH_SQL_TEMPLATES } from '../../sqlite/queries/statusBatch'
import type { SqliteStoredStatus } from '../../sqlite/queries/statusMapper'
import {
  assembleNotificationFromFlat,
  assemblePostFromFlat,
  NOTIF_ACTOR_PROFILE_ID_COL,
  NOTIF_RELATED_POST_ID_COL,
  POST_ID_COL,
  POST_REBLOG_OF_COL,
} from './flatFetchAssembler'
import type { FlatFetchRequest, FlatFetchResult } from './flatFetchTypes'

// ================================================================
// メインエントリ
// ================================================================

/**
 * フラットフェッチを実行する。
 *
 * Worker 内で同期的にクエリを実行し、組み立て済みの Entity を返す。
 * メインスレッドでの追加 assembly は不要。
 */
export function executeFlatFetch(
  db: DbExec,
  request: FlatFetchRequest,
): FlatFetchResult {
  const startMs = performance.now()
  const { backendUrls, displayOrder, notificationIds, postIds } = request

  // ── 1. Core post fetch ──
  const postCoreRows =
    postIds.length > 0
      ? fetchCoreRows(db, buildPostFlatQuery(backendUrls, postIds))
      : []

  // ── 2. Reblog parent expansion ──
  const fetchedPostIds = new Set(postIds)
  const parentIds: number[] = []
  for (const row of postCoreRows) {
    const reblogId = row[POST_REBLOG_OF_COL] as number | null
    if (reblogId != null && !fetchedPostIds.has(reblogId)) {
      parentIds.push(reblogId)
      fetchedPostIds.add(reblogId)
    }
  }
  const parentCoreRows =
    parentIds.length > 0
      ? fetchCoreRows(db, buildPostFlatQuery(backendUrls, parentIds))
      : []

  // ── 3. Core notification fetch ──
  const notifCoreRows =
    notificationIds.length > 0
      ? fetchCoreRows(db, buildNotificationFlatQuery(notificationIds))
      : []

  // ── 4. Notification related post expansion ──
  const relatedPostIds: number[] = []
  for (const row of notifCoreRows) {
    const relatedId = row[NOTIF_RELATED_POST_ID_COL] as number | null
    if (relatedId != null && !fetchedPostIds.has(relatedId)) {
      relatedPostIds.push(relatedId)
      fetchedPostIds.add(relatedId)
    }
  }
  const relatedCoreRows =
    relatedPostIds.length > 0
      ? fetchCoreRows(db, buildPostFlatQuery(backendUrls, relatedPostIds))
      : []

  // ── 5. Batch queries for all posts ──
  const allPostIds = [...fetchedPostIds]
  const batchMaps = runBatchQueries(db, allPostIds)

  // ── 6. Profile emoji batch for notification actors ──
  const actorProfileIds = new Set<number>()
  for (const row of notifCoreRows) {
    const actorId = row[NOTIF_ACTOR_PROFILE_ID_COL] as number | null
    if (actorId != null) actorProfileIds.add(actorId)
  }
  const actorEmojisMap =
    actorProfileIds.size > 0
      ? fetchProfileEmojisById(db, [...actorProfileIds])
      : new Map<number, string>()

  // ── 7. Assemble posts ──
  const allPostRows = [...postCoreRows, ...parentCoreRows, ...relatedCoreRows]
  const postMap = new Map<number, SqliteStoredStatus>()
  for (const row of allPostRows) {
    const pid = row[POST_ID_COL] as number
    postMap.set(pid, assemblePostFromFlat(row, batchMaps))
  }

  // ── 8. Link reblogs ──
  for (const row of allPostRows) {
    const pid = row[POST_ID_COL] as number
    const reblogOfId = row[POST_REBLOG_OF_COL] as number | null
    if (reblogOfId != null) {
      const status = postMap.get(pid)
      const parent = postMap.get(reblogOfId)
      if (status && parent) {
        status.reblog = parent
      }
    }
  }

  // ── 9. Assemble notifications ──
  const notifMap = new Map<number, SqliteStoredNotification>()
  for (const row of notifCoreRows) {
    const nid = row[0] as number
    notifMap.set(
      nid,
      assembleNotificationFromFlat(row, postMap, actorEmojisMap),
    )
  }

  // ── 10. Source type ──
  const hasPost = postIds.length > 0
  const hasNotif = notificationIds.length > 0
  const sourceType: 'post' | 'notification' | 'mixed' =
    hasPost && hasNotif ? 'mixed' : hasNotif ? 'notification' : 'post'

  return {
    displayOrder,
    meta: {
      sourceType,
      totalDurationMs: performance.now() - startMs,
    },
    notifications: notifMap,
    posts: postMap,
  }
}

// ================================================================
// ヘルパー
// ================================================================

/** 単一の SELECT クエリを実行して行配列を返す */
function fetchCoreRows(
  db: DbExec,
  query: { sql: string; bind: number[] },
): (string | number | null)[][] {
  return db.exec(query.sql, {
    bind: query.bind,
    returnValue: 'resultRows',
  })
}

/**
 * BATCH_SQL_TEMPLATES を使って全バッチクエリを実行し BatchMaps を返す。
 *
 * {IDS} プレースホルダを実際の (?, ?, ...) に置換して実行する。
 * polls クエリは local_account_id 用の追加バインドパラメータを先頭に付加する。
 */
function runBatchQueries(db: DbExec, allPostIds: number[]): BatchMaps {
  if (allPostIds.length === 0) {
    return emptyBatchMaps()
  }

  const placeholders = allPostIds.map(() => '?').join(',')

  const run = (key: keyof typeof BATCH_SQL_TEMPLATES): Map<number, string> => {
    const sql = BATCH_SQL_TEMPLATES[key].replaceAll('{IDS}', placeholders)
    // polls template は先頭に pv.local_account_id = ? のバインドが必要
    const bind: (string | number | null)[] =
      key === 'polls' ? [null, ...allPostIds] : [...allPostIds]
    const rows = db.exec(sql, { bind, returnValue: 'resultRows' })
    const map = new Map<number, string>()
    for (const row of rows) {
      map.set(row[0] as number, row[1] as string)
    }
    return map
  }

  return {
    belongingTagsMap: run('belongingTags'),
    customEmojisMap: run('customEmojis'),
    emojiReactionsMap: new Map(),
    interactionsMap: run('interactions'),
    mediaMap: run('media'),
    mentionsMap: run('mentions'),
    pollsMap: run('polls'),
    profileEmojisMap: run('profileEmojis'),
    timelineTypesMap: run('timelineTypes'),
  }
}

/**
 * BATCH_PROFILE_EMOJIS_BY_ID_SQL を実行して
 * profile_id → emojis_json の Map を返す。
 */
function fetchProfileEmojisById(
  db: DbExec,
  profileIds: number[],
): Map<number, string> {
  const placeholders = profileIds.map(() => '?').join(',')
  const sql = BATCH_PROFILE_EMOJIS_BY_ID_SQL.replace('{IDS}', placeholders)
  const rows = db.exec(sql, {
    bind: profileIds,
    returnValue: 'resultRows',
  })
  const map = new Map<number, string>()
  for (const row of rows) {
    map.set(row[0] as number, row[1] as string)
  }
  return map
}

/** 空の BatchMaps を返す */
function emptyBatchMaps(): BatchMaps {
  return {
    belongingTagsMap: new Map(),
    customEmojisMap: new Map(),
    emojiReactionsMap: new Map(),
    interactionsMap: new Map(),
    mediaMap: new Map(),
    mentionsMap: new Map(),
    pollsMap: new Map(),
    profileEmojisMap: new Map(),
    timelineTypesMap: new Map(),
  }
}
