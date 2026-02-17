/**
 * SQLite ベースの Notification ストア
 */

import type { Entity } from 'megalodon'
import { getSqliteDb, notifyChange } from './connection'
import { createCompositeKey } from './statusStore'

export interface SqliteStoredNotification extends Entity.Notification {
  compositeKey: string
  backendUrl: string
  created_at_ms: number
  storedAt: number
}

function rowToStoredNotification(
  row: (string | number)[],
): SqliteStoredNotification {
  const compositeKey = row[0] as string
  const backendUrl = row[1] as string
  const created_at_ms = row[2] as number
  const storedAt = row[3] as number
  const json = row[4] as string
  const notification = JSON.parse(json) as Entity.Notification

  return {
    ...notification,
    backendUrl,
    compositeKey,
    created_at_ms,
    storedAt,
  }
}

/**
 * Notification を追加
 */
export async function addNotification(
  notification: Entity.Notification,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, notification.id)
  const created_at_ms = new Date(notification.created_at).getTime()
  const now = Date.now()

  db.exec(
    `INSERT INTO notifications (compositeKey, backendUrl, created_at_ms, storedAt, json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(compositeKey) DO UPDATE SET
       created_at_ms = excluded.created_at_ms,
       storedAt = excluded.storedAt,
       json = excluded.json;`,
    {
      bind: [
        compositeKey,
        backendUrl,
        created_at_ms,
        now,
        JSON.stringify(notification),
      ],
    },
  )

  notifyChange('notifications')
}

/**
 * 複数の Notification を一括追加
 */
export async function bulkAddNotifications(
  notifications: Entity.Notification[],
  backendUrl: string,
): Promise<void> {
  if (notifications.length === 0) return

  const handle = await getSqliteDb()
  const { db } = handle
  const now = Date.now()

  db.exec('BEGIN;')
  try {
    for (const notification of notifications) {
      const compositeKey = createCompositeKey(backendUrl, notification.id)
      const created_at_ms = new Date(notification.created_at).getTime()

      db.exec(
        `INSERT INTO notifications (compositeKey, backendUrl, created_at_ms, storedAt, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(compositeKey) DO UPDATE SET
           created_at_ms = excluded.created_at_ms,
           storedAt = excluded.storedAt,
           json = excluded.json;`,
        {
          bind: [
            compositeKey,
            backendUrl,
            created_at_ms,
            now,
            JSON.stringify(notification),
          ],
        },
      )
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('notifications')
}

/**
 * Notification を取得
 */
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()
  const { db } = handle

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT compositeKey, backendUrl, created_at_ms, storedAt, json
      FROM notifications
      WHERE backendUrl IN (${placeholders})
      ORDER BY created_at_ms DESC
      LIMIT ?;
    `
    binds.push(...backendUrls, limit ?? 2147483647)
  } else {
    sql = `
      SELECT compositeKey, backendUrl, created_at_ms, storedAt, json
      FROM notifications
      ORDER BY created_at_ms DESC
      LIMIT ?;
    `
    binds.push(limit ?? 2147483647)
  }

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  return rows.map(rowToStoredNotification)
}

/**
 * Notification 内の Status アクション状態を更新
 */
export async function updateNotificationStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle

  // backendUrl に属する通知の中から status.id が一致するものを探す
  const rows = db.exec(
    `SELECT compositeKey, json FROM notifications WHERE backendUrl = ?;`,
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as (string | number)[][]

  const updates: { key: string; json: string }[] = []
  for (const row of rows) {
    const notification = JSON.parse(row[1] as string) as Entity.Notification
    if (notification.status?.id === statusId) {
      ;(notification.status as Record<string, unknown>)[action] = value
      updates.push({
        json: JSON.stringify(notification),
        key: row[0] as string,
      })
    }
  }

  if (updates.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const u of updates) {
        db.exec('UPDATE notifications SET json = ? WHERE compositeKey = ?;', {
          bind: [u.json, u.key],
        })
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    notifyChange('notifications')
  }
}
