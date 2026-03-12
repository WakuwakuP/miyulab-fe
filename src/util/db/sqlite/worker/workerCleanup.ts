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
 * MAX_LENGTH は Worker 側には環境変数がないため、引数で受け取る。
 * デフォルト値は 100000。
 */
export function handleEnforceMaxLength(
  db: DbExec,
  maxLength = 100000,
): HandlerResult {
  const changedTables: TableName[] = []

  db.exec('BEGIN;')
  try {
    // 全 timeline を取得してそれぞれ上限チェック
    const timelines = db.exec('SELECT timeline_id FROM timelines;', {
      returnValue: 'resultRows',
    }) as number[][]

    let postsDeleted = false
    for (const [timelineId] of timelines) {
      const countRows = db.exec(
        'SELECT COUNT(*) FROM timeline_items WHERE timeline_id = ?;',
        { bind: [timelineId], returnValue: 'resultRows' },
      ) as number[][]
      const count = countRows[0][0]

      if (count > maxLength) {
        // 1. timeline_items から最古のエントリを除去 (sort_key ASC)
        db.exec(
          `DELETE FROM timeline_items
           WHERE timeline_item_id IN (
             SELECT timeline_item_id
             FROM timeline_items
             WHERE timeline_id = ?
             ORDER BY sort_key ASC
             LIMIT ?
           );`,
          { bind: [timelineId, count - maxLength] },
        )
        postsDeleted = true
      }
    }

    // どのタイムラインにも属さなくなった孤立 posts を削除
    if (postsDeleted) {
      db.exec(
        `DELETE FROM posts
         WHERE post_id NOT IN (
           SELECT DISTINCT post_id FROM timeline_items WHERE post_id IS NOT NULL
         );`,
      )
      changedTables.push('posts')
    }

    const notifCount = (
      db.exec('SELECT COUNT(*) FROM notifications;', {
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (notifCount > maxLength) {
      db.exec(
        `DELETE FROM notifications WHERE notification_id IN (
          SELECT notification_id FROM notifications
          ORDER BY created_at_ms ASC
          LIMIT ?
        );`,
        { bind: [notifCount - maxLength] },
      )

      if (!changedTables.includes('notifications')) {
        changedTables.push('notifications')
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables }
}
