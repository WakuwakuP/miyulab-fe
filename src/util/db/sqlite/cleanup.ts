/**
 * SQLite ベースのクリーンアップ
 *
 * TTL + MAX_LENGTH 管理を SQL で効率的に行う。
 */

import { MAX_LENGTH } from 'util/environment'
import type { TimelineType } from '../database'
import { getSqliteDb, notifyChange } from './connection'

const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7日

/**
 * 古いデータをクリーンアップ（TTLベース）
 */
export async function cleanupOldData(): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const threshold = Date.now() - TTL_MS

  db.exec('BEGIN;')
  try {
    db.exec('DELETE FROM statuses WHERE storedAt < ?;', {
      bind: [threshold],
    })
    db.exec('DELETE FROM notifications WHERE storedAt < ?;', {
      bind: [threshold],
    })
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
  notifyChange('notifications')
}

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
        // 古い方から MAX_LENGTH を超えた分のキーを取得
        const toRemoveRows = db.exec(
          `SELECT stt.compositeKey
           FROM statuses_timeline_types stt
           INNER JOIN statuses s ON s.compositeKey = stt.compositeKey
           WHERE stt.timelineType = ?
           ORDER BY s.created_at_ms ASC
           LIMIT ?;`,
          { bind: [type, count - MAX_LENGTH], returnValue: 'resultRows' },
        ) as string[][]

        for (const row of toRemoveRows) {
          const key = row[0]

          // このタイムライン種別を削除
          db.exec(
            'DELETE FROM statuses_timeline_types WHERE compositeKey = ? AND timelineType = ?;',
            { bind: [key, type] },
          )

          // 他のタイムラインに属していなければ物理削除
          const remaining = (
            db.exec(
              'SELECT COUNT(*) FROM statuses_timeline_types WHERE compositeKey = ?;',
              { bind: [key], returnValue: 'resultRows' },
            ) as number[][]
          )[0][0]

          if (remaining === 0) {
            db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
              bind: [key],
            })
          }
        }
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
      await cleanupOldData()
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
          await cleanupOldData()
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
