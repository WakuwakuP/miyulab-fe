/**
 * Worker 側: Notification 関連のトランザクション処理
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import { createCompositeKey, extractNotificationColumns } from '../shared'

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

export function handleAddNotification(
  db: DbExec,
  notificationJson: string,
  backendUrl: string,
): HandlerResult {
  const notification = JSON.parse(notificationJson) as Entity.Notification
  const compositeKey = createCompositeKey(backendUrl, notification.id)
  const created_at_ms = new Date(notification.created_at).getTime()
  const now = Date.now()
  const cols = extractNotificationColumns(notification)

  db.exec(
    `INSERT INTO notifications (
      compositeKey, backendUrl, created_at_ms, storedAt,
      notification_type, status_id, account_acct,
      json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(compositeKey) DO UPDATE SET
      created_at_ms     = excluded.created_at_ms,
      storedAt          = excluded.storedAt,
      notification_type = excluded.notification_type,
      status_id         = excluded.status_id,
      account_acct      = excluded.account_acct,
      json              = excluded.json;`,
    {
      bind: [
        compositeKey,
        backendUrl,
        created_at_ms,
        now,
        cols.notification_type,
        cols.status_id,
        cols.account_acct,
        JSON.stringify(notification),
      ],
    },
  )

  return { changedTables: ['notifications'] }
}

export function handleBulkAddNotifications(
  db: DbExec,
  notificationsJson: string[],
  backendUrl: string,
): HandlerResult {
  if (notificationsJson.length === 0) return { changedTables: [] }

  const now = Date.now()

  db.exec('BEGIN;')
  try {
    for (const nJson of notificationsJson) {
      const notification = JSON.parse(nJson) as Entity.Notification
      const compositeKey = createCompositeKey(backendUrl, notification.id)
      const created_at_ms = new Date(notification.created_at).getTime()
      const cols = extractNotificationColumns(notification)

      db.exec(
        `INSERT INTO notifications (
          compositeKey, backendUrl, created_at_ms, storedAt,
          notification_type, status_id, account_acct,
          json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(compositeKey) DO UPDATE SET
          created_at_ms     = excluded.created_at_ms,
          storedAt          = excluded.storedAt,
          notification_type = excluded.notification_type,
          status_id         = excluded.status_id,
          account_acct      = excluded.account_acct,
          json              = excluded.json;`,
        {
          bind: [
            compositeKey,
            backendUrl,
            created_at_ms,
            now,
            cols.notification_type,
            cols.status_id,
            cols.account_acct,
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

  return { changedTables: ['notifications'] }
}

export function handleUpdateNotificationStatusAction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): HandlerResult {
  // statuses_backends 経由で compositeKey を解決
  const sbRows = db.exec(
    'SELECT compositeKey FROM statuses_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, statusId], returnValue: 'resultRows' },
  ) as string[][]
  const statusCompositeKey = sbRows.length > 0 ? sbRows[0][0] : null

  const statusIds: string[] = [statusId]

  if (statusCompositeKey) {
    const localIdRows = db.exec(
      'SELECT local_id FROM statuses_backends WHERE compositeKey = ?;',
      { bind: [statusCompositeKey], returnValue: 'resultRows' },
    ) as string[][]
    for (const r of localIdRows) {
      if (!statusIds.includes(r[0])) {
        statusIds.push(r[0])
      }
    }
  }

  const placeholders = statusIds.map(() => '?').join(',')
  const rows = db.exec(
    `SELECT compositeKey, json FROM notifications
     WHERE status_id IN (${placeholders});`,
    { bind: statusIds, returnValue: 'resultRows' },
  ) as (string | number)[][]

  const updates: { key: string; json: string }[] = []
  for (const row of rows) {
    const notification = JSON.parse(row[1] as string) as Entity.Notification
    if (notification.status) {
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
  }

  return { changedTables: updates.length > 0 ? ['notifications'] : [] }
}
