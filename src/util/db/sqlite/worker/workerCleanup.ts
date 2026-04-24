/**
 * Worker 側: クリーンアップ処理
 *
 * 1 呼び出し = 1 バッチ設計。呼び出し側は `hasMore === false` になるまで繰り返す。
 *
 * 優先順: (a) timeline_entries 超過分 → (b) notifications 超過分 → (c) 孤立 posts。
 * `batchLimit` (default 10,000) を超えないように 1 回の呼び出しで削除する。
 * これにより単一トランザクションが肥大化してタイムアウトする問題を回避する。
 */

import type { TableName } from '../protocol'

type DbExec = {
  exec: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => unknown
}

/**
 * 1 バッチあたりの削除上限（default）
 *
 * OPFS 上の SQLite では 1 件あたりの DELETE コスト (WAL 書き込み + fsync) が
 * 無視できないため、90s の Worker タイムアウト内に確実に完了するサイズに抑える。
 * 旧値 10,000 ではタイムアウトするケースがあったため 2,000 に引き下げた。
 */
const DEFAULT_BATCH_LIMIT = 2_000

export type EnforceMaxLengthOptions = {
  /** 'periodic' (default) または 'emergency' */
  mode?: 'periodic' | 'emergency'
  /** emergency モードで各グループに残す割合 (0 < x <= 1)。default 0.5 */
  targetRatio?: number
  /** 1 バッチあたりの削除上限。default 10,000 */
  batchLimit?: number
}

export type EnforceMaxLengthHandlerResult = {
  changedTables: TableName[]
  hasMore: boolean
  deletedCounts: {
    timeline_entries: number
    notifications: number
    posts: number
  }
}

function readChanges(db: DbExec): number {
  const rows = db.exec('SELECT changes();', {
    returnValue: 'resultRows',
  }) as number[][]
  if (rows.length > 0 && rows[0] !== undefined) {
    return rows[0][0] ?? 0
  }
  return 0
}

/**
 * (local_account_id, timeline_key) グループで超過 1 件以上あるか確認しつつ 1 バッチ削除する。
 * 戻り値は { deleted, issuedDelete, remainingBudget, hasRemainingExcess }。
 */
function processTimelineBatch(
  db: DbExec,
  maxTimeline: number,
  mode: 'periodic' | 'emergency',
  targetRatio: number,
  budget: number,
): {
  deleted: number
  issuedDelete: boolean
  remainingBudget: number
  hasRemainingExcess: boolean
} {
  // emergency モードでは maxTimeline の制限を外して全グループを対象とする
  // (ターゲットは cnt * targetRatio で決まる)。HAVING の閾値は 0 にする。
  const havingThreshold = mode === 'emergency' ? 0 : maxTimeline

  // 超過のあるグループを列挙
  const groups = db.exec(
    'SELECT local_account_id, timeline_key, COUNT(*) as cnt FROM timeline_entries GROUP BY local_account_id, timeline_key HAVING cnt > ?;',
    { bind: [havingThreshold], returnValue: 'resultRows' },
  ) as (number | string)[][]

  let deleted = 0
  let issuedDelete = false
  let remaining = budget
  let hasRemainingExcess = false

  for (const [laId, tlKey, cntRaw] of groups) {
    const cnt = cntRaw as number
    // emergency モード: cnt * targetRatio を残す → 超過 = cnt - floor(cnt * targetRatio)
    // periodic モード: maxTimeline を残す → 超過 = cnt - maxTimeline
    const target =
      mode === 'emergency' ? Math.floor(cnt * targetRatio) : maxTimeline
    const excess = cnt - target
    if (excess <= 0) continue

    if (remaining <= 0) {
      hasRemainingExcess = true
      break
    }

    const limit = Math.min(excess, remaining)
    db.exec(
      `DELETE FROM timeline_entries WHERE id IN (
        SELECT id FROM timeline_entries
        WHERE local_account_id = ? AND timeline_key = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      );`,
      { bind: [laId, tlKey, limit] },
    )
    issuedDelete = true
    const changed = readChanges(db)
    deleted += changed
    remaining -= limit
    if (excess > limit) {
      hasRemainingExcess = true
    }
  }

  return {
    deleted,
    hasRemainingExcess,
    issuedDelete,
    remainingBudget: remaining,
  }
}

function processNotificationsBatch(
  db: DbExec,
  maxNotifications: number,
  mode: 'periodic' | 'emergency',
  targetRatio: number,
  budget: number,
): {
  deleted: number
  issuedDelete: boolean
  remainingBudget: number
  hasRemainingExcess: boolean
} {
  const havingThreshold = mode === 'emergency' ? 0 : maxNotifications

  const groups = db.exec(
    'SELECT local_account_id, COUNT(*) as cnt FROM notifications GROUP BY local_account_id HAVING cnt > ?;',
    { bind: [havingThreshold], returnValue: 'resultRows' },
  ) as number[][]

  let deleted = 0
  let issuedDelete = false
  let remaining = budget
  let hasRemainingExcess = false

  for (const [laId, cnt] of groups) {
    const target =
      mode === 'emergency' ? Math.floor(cnt * targetRatio) : maxNotifications
    const excess = cnt - target
    if (excess <= 0) continue

    if (remaining <= 0) {
      hasRemainingExcess = true
      break
    }

    const limit = Math.min(excess, remaining)
    db.exec(
      `DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications
        WHERE local_account_id = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      );`,
      { bind: [laId, limit] },
    )
    issuedDelete = true
    const changed = readChanges(db)
    deleted += changed
    remaining -= limit
    if (excess > limit) {
      hasRemainingExcess = true
    }
  }

  return {
    deleted,
    hasRemainingExcess,
    issuedDelete,
    remainingBudget: remaining,
  }
}

/**
 * MAX_LENGTH を超えるデータを 1 バッチ削除する。
 *
 * 優先順: (a) timeline_entries → (b) notifications → (c) 孤立 posts。
 * `batchLimit` を超える作業が残っている場合 `hasMore: true` を返し、
 * 呼び出し側は `hasMore === false` になるまで繰り返し呼び出す。
 *
 * 後方互換: `options` を省略すると従来の periodic モード相当で動作する。
 */
export function handleEnforceMaxLength(
  db: DbExec,
  maxTimeline = 100000,
  maxNotifications = 100000,
  options: EnforceMaxLengthOptions = {},
): EnforceMaxLengthHandlerResult {
  const mode = options.mode ?? 'periodic'
  const targetRatio = options.targetRatio ?? 0.5
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT

  const changedTables: TableName[] = []
  const deletedCounts = {
    notifications: 0,
    posts: 0,
    timeline_entries: 0,
  }
  let hasMore = false
  let needOrphanCleanup = false

  // Phase 1: timeline_entries + notifications を 1 トランザクションで処理
  db.exec('BEGIN;')
  try {
    const tlResult = processTimelineBatch(
      db,
      maxTimeline,
      mode,
      targetRatio,
      batchLimit,
    )
    deletedCounts.timeline_entries = tlResult.deleted
    if (tlResult.issuedDelete) {
      needOrphanCleanup = true
      if (!changedTables.includes('timeline_entries')) {
        changedTables.push('timeline_entries')
      }
    }

    const notifBudget = tlResult.remainingBudget
    if (notifBudget > 0) {
      const notifResult = processNotificationsBatch(
        db,
        maxNotifications,
        mode,
        targetRatio,
        notifBudget,
      )
      deletedCounts.notifications = notifResult.deleted
      if (notifResult.issuedDelete) {
        needOrphanCleanup = true
        if (!changedTables.includes('notifications')) {
          changedTables.push('notifications')
        }
      }
      if (
        tlResult.hasRemainingExcess ||
        notifResult.hasRemainingExcess ||
        notifResult.remainingBudget <= 0
      ) {
        hasMore = true
      }
    } else {
      // 予算枯渇: notifications は次回回し
      hasMore = true
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  // Phase 2: 孤立 posts を 1 バッチだけ削除（短いトランザクション）
  // timeline/notifications のいずれかで削除があった場合のみ実行する。
  // 削除件数がバッチ上限に達した場合は次回呼び出しで続きを処理する。
  //
  // SQL は LEFT JOIN 形式で書く:
  //   - te   (timeline_entries.post_id)       → idx_timeline_entries_post (v2.0.6 で追加)
  //   - n    (notifications.related_post_id)  → idx_notifications_post
  //   - rb   (posts.reblog_of_post_id)        → idx_posts_reblog_of
  //   - qt   (posts.quote_of_post_id)         → idx_posts_quote_of
  //
  // reblog_of_post_id / quote_of_post_id は posts 同士の自己参照 FK で
  // ON DELETE 指定がないため、参照されている行を削除しようとすると
  // SQLITE_CONSTRAINT_FOREIGNKEY が発生する。
  // これらを参照元として持つ行も「孤立していない」とみなして除外する。
  //
  // いずれのインデックスも partial index / 単列インデックスが存在するため
  // posts 全件スキャンは発生しない。
  if (needOrphanCleanup) {
    db.exec('BEGIN;')
    let orphanDeleted = 0
    try {
      db.exec(
        `DELETE FROM posts WHERE id IN (
          SELECT p.id FROM posts p
          LEFT JOIN timeline_entries te ON te.post_id = p.id
          LEFT JOIN notifications n ON n.related_post_id = p.id
          LEFT JOIN posts rb ON rb.reblog_of_post_id = p.id
          LEFT JOIN posts qt ON qt.quote_of_post_id = p.id
          WHERE te.post_id IS NULL
            AND n.related_post_id IS NULL
            AND rb.id IS NULL
            AND qt.id IS NULL
          LIMIT ?
        );`,
        { bind: [batchLimit] },
      )
      orphanDeleted = readChanges(db)
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }

    deletedCounts.posts = orphanDeleted
    // DELETE を発行した時点で posts テーブル変更として扱う（後方互換）
    if (!changedTables.includes('posts')) {
      changedTables.push('posts')
    }
    // バッチ上限いっぱいまで削除した場合、まだ孤立 posts が残っている可能性あり
    if (orphanDeleted >= batchLimit) {
      hasMore = true
    }
  }

  return { changedTables, deletedCounts, hasMore }
}
