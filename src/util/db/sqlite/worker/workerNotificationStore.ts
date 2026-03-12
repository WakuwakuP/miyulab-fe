/**
 * Worker 側: Notification 関連のトランザクション処理
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import {
  ACTION_TO_ENGAGEMENT,
  ensureProfile,
  ensureServer,
  resolveLocalAccountId,
  resolvePostId,
  toggleEngagement,
} from '../shared'

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

function resolveNotificationTypeId(
  db: DbExec,
  notificationType: string,
): number | null {
  const rows = db.exec(
    'SELECT notification_type_id FROM notification_types WHERE code = ?;',
    { bind: [notificationType], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

export function handleAddNotification(
  db: DbExec,
  notificationJson: string,
  backendUrl: string,
): HandlerResult {
  const notification = JSON.parse(notificationJson) as Entity.Notification
  const created_at_ms = new Date(notification.created_at).getTime()
  const now = Date.now()
  const serverId = ensureServer(db, backendUrl)
  const notificationTypeId = resolveNotificationTypeId(db, notification.type)
  const actorProfileId = notification.account
    ? ensureProfile(db, notification.account)
    : null
  const relatedPostId = notification.status
    ? resolvePostId(db, backendUrl, notification.status.id)
    : null

  // (server_id, local_id) で既存チェック
  const existing = db.exec(
    'SELECT notification_id FROM notifications WHERE server_id = ? AND local_id = ?;',
    { bind: [serverId, notification.id], returnValue: 'resultRows' },
  ) as number[][]

  if (existing.length > 0) {
    const notificationId = existing[0][0]
    db.exec(
      `UPDATE notifications SET
        notification_type_id = ?,
        actor_profile_id     = ?,
        related_post_id      = ?,
        created_at_ms        = ?,
        stored_at            = ?
      WHERE notification_id = ?;`,
      {
        bind: [
          notificationTypeId,
          actorProfileId,
          relatedPostId,
          created_at_ms,
          now,
          notificationId,
        ],
      },
    )
  } else {
    db.exec(
      `INSERT INTO notifications (
        server_id, local_id, notification_type_id, actor_profile_id,
        related_post_id, created_at_ms, stored_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          serverId,
          notification.id,
          notificationTypeId,
          actorProfileId,
          relatedPostId,
          created_at_ms,
          now,
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
    const serverId = ensureServer(db, backendUrl)

    for (const nJson of notificationsJson) {
      const notification = JSON.parse(nJson) as Entity.Notification
      const created_at_ms = new Date(notification.created_at).getTime()
      const notificationTypeId = resolveNotificationTypeId(
        db,
        notification.type,
      )
      const actorProfileId = notification.account
        ? ensureProfile(db, notification.account)
        : null
      const relatedPostId = notification.status
        ? resolvePostId(db, backendUrl, notification.status.id)
        : null

      const existing = db.exec(
        'SELECT notification_id FROM notifications WHERE server_id = ? AND local_id = ?;',
        { bind: [serverId, notification.id], returnValue: 'resultRows' },
      ) as number[][]

      if (existing.length > 0) {
        const notificationId = existing[0][0]
        db.exec(
          `UPDATE notifications SET
            notification_type_id = ?,
            actor_profile_id     = ?,
            related_post_id      = ?,
            created_at_ms        = ?,
            stored_at            = ?
          WHERE notification_id = ?;`,
          {
            bind: [
              notificationTypeId,
              actorProfileId,
              relatedPostId,
              created_at_ms,
              now,
              notificationId,
            ],
          },
        )
      } else {
        db.exec(
          `INSERT INTO notifications (
            server_id, local_id, notification_type_id, actor_profile_id,
            related_post_id, created_at_ms, stored_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              serverId,
              notification.id,
              notificationTypeId,
              actorProfileId,
              relatedPostId,
              created_at_ms,
              now,
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
  // 通知関連のステータスの engagement 更新は post_engagements で処理
  const postId = resolvePostId(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  const engagementCode = ACTION_TO_ENGAGEMENT[action]
  if (!engagementCode) return { changedTables: [] }

  toggleEngagement(db, localAccountId, postId, engagementCode, value)

  return { changedTables: ['notifications'] }
}
