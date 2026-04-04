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
 */
export function handleEnforceMaxLength(
  db: DbExec,
  maxTimeline = 100000,
  maxNotifications = 100000,
): HandlerResult {
  const changedTables: TableName[] = []

  db.exec('BEGIN;')
  try {
    // 1. timeline_entries: 各 (local_account_id, timeline_key) グループで上限チェック
    const groups = db.exec(
      'SELECT local_account_id, timeline_key, COUNT(*) as cnt FROM timeline_entries GROUP BY local_account_id, timeline_key HAVING cnt > ?;',
      { bind: [maxTimeline], returnValue: 'resultRows' },
    ) as (number | string)[][]

    let postsDeleted = false
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
        postsDeleted = true
      }
    }

    // どのタイムラインにも属さなくなった孤立 posts を削除
    // notifications.related_post_id の FK は ON DELETE CASCADE がないため、
    // notifications から参照されている posts も除外する
    // NOT EXISTS は NOT IN より効率的（サブクエリがインデックスを活用しやすい）
    if (postsDeleted) {
      db.exec(
        `DELETE FROM posts WHERE NOT EXISTS (
           SELECT 1 FROM timeline_entries te WHERE te.post_id = posts.id
         ) AND NOT EXISTS (
           SELECT 1 FROM notifications n WHERE n.related_post_id = posts.id
         );`,
      )
      changedTables.push('posts')
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
      }
    }

    if (notifGroups.length > 0) {
      // 通知削除後、孤立 posts も削除する
      db.exec(
        `DELETE FROM posts WHERE NOT EXISTS (
           SELECT 1 FROM timeline_entries te WHERE te.post_id = posts.id
         ) AND NOT EXISTS (
           SELECT 1 FROM notifications n WHERE n.related_post_id = posts.id
         );`,
      )
      if (!changedTables.includes('notifications')) {
        changedTables.push('notifications')
      }
      if (!changedTables.includes('posts')) {
        changedTables.push('posts')
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables }
}
