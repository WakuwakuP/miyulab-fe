/**
 * Worker 側: Notification 関連のトランザクション処理
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import { extractNotificationColumns } from '../shared'

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
  const created_at_ms = new Date(notification.created_at).getTime()
  const now = Date.now()
  const cols = extractNotificationColumns(notification)

  // (backend_url, local_id) で既存チェック
  const existing = db.exec(
    'SELECT notification_id FROM notifications WHERE backend_url = ? AND local_id = ?;',
    { bind: [backendUrl, notification.id], returnValue: 'resultRows' },
  ) as number[][]

  if (existing.length > 0) {
    const notificationId = existing[0][0]
    db.exec(
      `UPDATE notifications SET
        created_at_ms     = ?,
        stored_at         = ?,
        notification_type = ?,
        status_id         = ?,
        account_acct      = ?,
        json              = ?
      WHERE notification_id = ?;`,
      {
        bind: [
          created_at_ms,
          now,
          cols.notification_type,
          cols.status_id,
          cols.account_acct,
          JSON.stringify(notification),
          notificationId,
        ],
      },
    )
  } else {
    db.exec(
      `INSERT INTO notifications (
        backend_url, local_id, created_at_ms, stored_at,
        notification_type, status_id, account_acct,
        json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          backendUrl,
          notification.id,
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
      const created_at_ms = new Date(notification.created_at).getTime()
      const cols = extractNotificationColumns(notification)

      const existing = db.exec(
        'SELECT notification_id FROM notifications WHERE backend_url = ? AND local_id = ?;',
        { bind: [backendUrl, notification.id], returnValue: 'resultRows' },
      ) as number[][]

      if (existing.length > 0) {
        const notificationId = existing[0][0]
        db.exec(
          `UPDATE notifications SET
            created_at_ms     = ?,
            stored_at         = ?,
            notification_type = ?,
            status_id         = ?,
            account_acct      = ?,
            json              = ?
          WHERE notification_id = ?;`,
          {
            bind: [
              created_at_ms,
              now,
              cols.notification_type,
              cols.status_id,
              cols.account_acct,
              JSON.stringify(notification),
              notificationId,
            ],
          },
        )
      } else {
        db.exec(
          `INSERT INTO notifications (
            backend_url, local_id, created_at_ms, stored_at,
            notification_type, status_id, account_acct,
            json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              backendUrl,
              notification.id,
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
  // posts_backends 経由で post_id を解決
  const pbRows = db.exec(
    'SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, statusId], returnValue: 'resultRows' },
  ) as number[][]
  const postId = pbRows.length > 0 ? pbRows[0][0] : null

  const statusIds: string[] = [statusId]

  if (postId !== null) {
    const localIdRows = db.exec(
      'SELECT local_id FROM posts_backends WHERE post_id = ?;',
      { bind: [postId], returnValue: 'resultRows' },
    ) as string[][]
    for (const r of localIdRows) {
      if (!statusIds.includes(r[0])) {
        statusIds.push(r[0])
      }
    }
  }

  const placeholders = statusIds.map(() => '?').join(',')
  const rows = db.exec(
    `SELECT notification_id, json FROM notifications
     WHERE status_id IN (${placeholders});`,
    { bind: statusIds, returnValue: 'resultRows' },
  ) as (string | number)[][]

  const updates: { id: number; json: string }[] = []
  for (const row of rows) {
    const notification = JSON.parse(row[1] as string) as Entity.Notification
    if (notification.status) {
      ;(notification.status as Record<string, unknown>)[action] = value
      updates.push({
        id: row[0] as number,
        json: JSON.stringify(notification),
      })
    }
  }

  if (updates.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const u of updates) {
        db.exec(
          'UPDATE notifications SET json = ? WHERE notification_id = ?;',
          {
            bind: [u.json, u.id],
          },
        )
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
  }

  return { changedTables: updates.length > 0 ? ['notifications'] : [] }
}
