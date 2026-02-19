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
        'SELECT COUNT(*) FROM statuses_timeline_types WHERE timelineType = ?;',
        { bind: [type], returnValue: 'resultRows' },
      ) as number[][]
      const count = countRows[0][0]

      if (count > maxLength) {
        // 1. まず statuses_timeline_types から最古のエントリを除去
        //    （CASCADE 依存を避けるため、先にリレーションテーブルから削除）
        db.exec(
          `DELETE FROM statuses_timeline_types
           WHERE timelineType = ?
             AND compositeKey IN (
               SELECT stt2.compositeKey
               FROM statuses_timeline_types stt2
               INNER JOIN statuses s ON s.compositeKey = stt2.compositeKey
               WHERE stt2.timelineType = ?
               ORDER BY s.created_at_ms ASC
               LIMIT ?
             );`,
          { bind: [type, type, count - maxLength] },
        )

        // 2. どのタイムラインにも属さなくなった孤立 statuses を削除
        db.exec(
          `DELETE FROM statuses
           WHERE compositeKey NOT IN (
             SELECT DISTINCT compositeKey FROM statuses_timeline_types
           );`,
        )

        if (!changedTables.includes('statuses')) {
          changedTables.push('statuses')
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
        `DELETE FROM notifications WHERE compositeKey IN (
          SELECT compositeKey FROM notifications
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
