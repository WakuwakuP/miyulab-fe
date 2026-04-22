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

/** 1 バッチあたりの削除上限（default） */
const DEFAULT_BATCH_LIMIT = 10_000

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

  if (!Number.isFinite(targetRatio) || targetRatio <= 0 || targetRatio > 1) {
    throw new RangeError(
      `handleEnforceMaxLength: options.targetRatio must satisfy 0 < targetRatio <= 1, got ${String(targetRatio)}`,
    )
  }

  const rawBatchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT
  if (!Number.isFinite(rawBatchLimit) || rawBatchLimit <= 0) {
    throw new RangeError(
      `handleEnforceMaxLength: options.batchLimit must be a positive number, got ${String(rawBatchLimit)}`,
    )
  }
  const batchLimit = Math.floor(rawBatchLimit)
  if (batchLimit <= 0) {
    throw new RangeError(
      `handleEnforceMaxLength: options.batchLimit must resolve to at least 1 after normalization, got ${String(rawBatchLimit)}`,
    )
  }

  const changedTables: TableName[] = []
  const deletedCounts = {
    notifications: 0,
    posts: 0,
    timeline_entries: 0,
  }
  let hasMore = false

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
        if (!changedTables.includes('notifications')) {
          changedTables.push('notifications')
        }
      }
      if (tlResult.hasRemainingExcess || notifResult.hasRemainingExcess) {
        hasMore = true
      }
    } else {
      // 予算枯渇: notifications に超過があるか確認
      const notifExcessRows = db.exec(
        'SELECT 1 FROM notifications GROUP BY local_account_id HAVING COUNT(*) > ? LIMIT 1;',
        { bind: [maxNotifications], returnValue: 'resultRows' },
      ) as number[][]
      if (tlResult.hasRemainingExcess || notifExcessRows.length > 0) {
        hasMore = true
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  // Phase 2: 孤立 posts を 1 バッチだけ削除（短いトランザクション）
  // timeline/notifications の削除有無にかかわらず常に実行する。
  // 前のバッチで孤立 posts が発生していた場合でも確実に処理できるようにするため。
  // 削除件数がバッチ上限に達した場合は次回呼び出しで続きを処理する。
  db.exec('BEGIN;')
  let orphanDeleted = 0
  try {
    db.exec(
      `DELETE FROM posts WHERE id IN (
        SELECT p.id FROM posts p
        WHERE NOT EXISTS (
          SELECT 1 FROM timeline_entries te WHERE te.post_id = p.id
        ) AND NOT EXISTS (
          SELECT 1 FROM notifications n WHERE n.related_post_id = p.id
        )
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

  if (orphanDeleted > 0) {
    deletedCounts.posts = orphanDeleted
    if (!changedTables.includes('posts')) {
      changedTables.push('posts')
    }
  }
  // バッチ上限いっぱいまで削除した場合、まだ孤立 posts が残っている可能性あり
  if (orphanDeleted >= batchLimit) {
    hasMore = true
  }

  return { changedTables, deletedCounts, hasMore }
}
