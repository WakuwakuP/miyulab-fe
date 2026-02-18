/**
 * SQLite ベースのクリーンアップ
 *
 * MAX_LENGTH 管理を SQL で効率的に行う。
 * TTL は設けず、MAX_LENGTH を超えるまでデータを半永久的に保持する。
 */

import { MAX_LENGTH } from 'util/environment'
import type { TimelineType } from '../database'
import { getSqliteDb, notifyChange } from './connection'

/**
 * MAX_LENGTH を超えるデータを削除（タイムライン種類ごと）
 */
export async function enforceMaxLength(): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const timelineTypes: TimelineType[] = ['home', 'local', 'public', 'tag']

  db.exec('BEGIN;')
  try {
    for (const type of timelineTypes) {
      // このタイムラインに属する Status の数を取得
      const countRows = db.exec(
        'SELECT COUNT(*) FROM statuses_timeline_types WHERE timelineType = ?;',
        { bind: [type], returnValue: 'resultRows' },
      ) as number[][]
      const count = countRows[0][0]

      if (count > MAX_LENGTH) {
        // サブクエリで古い方から MAX_LENGTH を超えた分を直接削除（バインド変数上限回避）

        // 他のタイムラインに属していないものを物理削除
        db.exec(
          `DELETE FROM statuses
           WHERE compositeKey IN (
             SELECT stt.compositeKey
             FROM statuses_timeline_types stt
             INNER JOIN statuses s ON s.compositeKey = stt.compositeKey
             WHERE stt.timelineType = ?
             ORDER BY s.created_at_ms ASC
             LIMIT ?
           )
           AND compositeKey NOT IN (
             SELECT compositeKey
             FROM statuses_timeline_types
             WHERE timelineType <> ?
           );`,
          { bind: [type, count - MAX_LENGTH, type] },
        )

        // このタイムライン種別との関連を削除
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
          { bind: [type, type, count - MAX_LENGTH] },
        )
      }
    }

    // notifications の MAX_LENGTH 制限
    const notifCount = (
      db.exec('SELECT COUNT(*) FROM notifications;', {
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (notifCount > MAX_LENGTH) {
      db.exec(
        `DELETE FROM notifications WHERE compositeKey IN (
          SELECT compositeKey FROM notifications
          ORDER BY created_at_ms ASC
          LIMIT ?
        );`,
        { bind: [notifCount - MAX_LENGTH] },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
  notifyChange('notifications')
}

/**
 * 定期クリーンアップの開始
 */
export function startPeriodicCleanup(): () => void {
  // 初回実行
  void (async () => {
    try {
      await enforceMaxLength()
    } catch (error) {
      console.error('Failed to perform initial periodic cleanup', error)
    }
  })()

  // 1時間ごとに実行
  const intervalId = setInterval(
    () => {
      void (async () => {
        try {
          await enforceMaxLength()
        } catch (error) {
          console.error('Failed to perform periodic cleanup', error)
        }
      })()
    },
    60 * 60 * 1000,
  )

  return () => clearInterval(intervalId)
}
