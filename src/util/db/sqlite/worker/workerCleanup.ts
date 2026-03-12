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
  const timelineTypes = ['home', 'local', 'public', 'tag']
  const changedTables: TableName[] = []

  db.exec('BEGIN;')
  try {
    for (const type of timelineTypes) {
      const countRows = db.exec(
        'SELECT COUNT(*) FROM posts_timeline_types WHERE timelineType = ?;',
        { bind: [type], returnValue: 'resultRows' },
      ) as number[][]
      const count = countRows[0][0]

      if (count > maxLength) {
        // 1. まず posts_timeline_types から最古のエントリを除去
        db.exec(
          `DELETE FROM posts_timeline_types
           WHERE timelineType = ?
             AND post_id IN (
               SELECT ptt2.post_id
               FROM posts_timeline_types ptt2
               INNER JOIN posts p ON p.post_id = ptt2.post_id
               WHERE ptt2.timelineType = ?
               ORDER BY p.created_at_ms ASC
               LIMIT ?
             );`,
          { bind: [type, type, count - maxLength] },
        )

        // 2. どのタイムラインにも属さなくなった孤立 posts を削除
        db.exec(
          `DELETE FROM posts
           WHERE post_id NOT IN (
             SELECT DISTINCT post_id FROM posts_timeline_types
           );`,
        )

        if (!changedTables.includes('posts')) {
          changedTables.push('posts')
        }
      }
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
