/**
 * Worker 側: クリーンアップ処理
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

type HandlerResult = { changedTables: TableName[] }

/**
 * MAX_LENGTH を超えるデータを削除
 *
 * タイムラインと通知それぞれに個別の上限を設定可能。
 * Worker 側には環境変数がないため、引数で受け取る。
 * デフォルト値はそれぞれ 100000。
 *
 * 孤立 posts の削除はバッチ単位で行い、長時間ロックを防止する。
 */

/** 孤立 posts 削除の 1 バッチあたりの上限 */
const ORPHAN_DELETE_BATCH = 1000

export function handleEnforceMaxLength(
  db: DbExec,
  maxTimeline = 100000,
  maxNotifications = 100000,
): HandlerResult {
  const changedTables: TableName[] = []
  let needOrphanCleanup = false

  db.exec('BEGIN;')
  try {
    // 1. timeline_entries: 各 (local_account_id, timeline_key) グループで上限チェック
    const groups = db.exec(
      'SELECT local_account_id, timeline_key, COUNT(*) as cnt FROM timeline_entries GROUP BY local_account_id, timeline_key HAVING cnt > ?;',
      { bind: [maxTimeline], returnValue: 'resultRows' },
    ) as (number | string)[][]

    for (const [laId, tlKey, cnt] of groups) {
      const excess = (cnt as number) - maxTimeline
      if (excess > 0) {
        db.exec(
          `DELETE FROM timeline_entries WHERE id IN (
            SELECT id FROM timeline_entries
            WHERE local_account_id = ? AND timeline_key = ?
            ORDER BY created_at_ms ASC
            LIMIT ?
          );`,
          { bind: [laId, tlKey, excess] },
        )
        needOrphanCleanup = true
      }
    }

    // 2. notifications: 各 local_account_id で上限チェック
    const notifGroups = db.exec(
      'SELECT local_account_id, COUNT(*) as cnt FROM notifications GROUP BY local_account_id HAVING cnt > ?;',
      { bind: [maxNotifications], returnValue: 'resultRows' },
    ) as number[][]

    for (const [laId, cnt] of notifGroups) {
      const excess = cnt - maxNotifications
      if (excess > 0) {
        db.exec(
          `DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications
            WHERE local_account_id = ?
            ORDER BY created_at_ms ASC
            LIMIT ?
          );`,
          { bind: [laId, excess] },
        )
        needOrphanCleanup = true
      }
    }

    if (notifGroups.length > 0) {
      if (!changedTables.includes('notifications')) {
        changedTables.push('notifications')
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  // 孤立 posts をバッチ削除（トランザクション外で段階的に実行）
  if (needOrphanCleanup) {
    let deletedInBatch: number
    do {
      db.exec('BEGIN;')
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
          { bind: [ORPHAN_DELETE_BATCH] },
        )
        const changesRows = db.exec('SELECT changes();', {
          returnValue: 'resultRows',
        }) as number[][]
        deletedInBatch =
          changesRows.length > 0 && changesRows[0] !== undefined
            ? changesRows[0][0]
            : 0
        db.exec('COMMIT;')
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }
    } while (deletedInBatch >= ORPHAN_DELETE_BATCH)

    if (!changedTables.includes('posts')) {
      changedTables.push('posts')
    }
  }

  return { changedTables }
}
