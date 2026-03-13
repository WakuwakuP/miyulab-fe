/**
 * Worker 側: Notification 関連のトランザクション処理
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import {
  ACTION_TO_ENGAGEMENT,
  ensureProfile,
  ensureServer,
  extractStatusColumns,
  resolveLocalAccountId,
  resolvePostId,
  syncPollData,
  syncPostCustomEmojis,
  syncProfileCustomEmojis,
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

function resolveVisibilityId(db: DbExec, visibility: string): number | null {
  const rows = db.exec(
    'SELECT visibility_id FROM visibility_types WHERE code = ?;',
    { bind: [visibility], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * 通知の関連投稿が DB に存在しない場合、Entity.Status から投稿を挿入して post_id を返す。
 * 既に存在する場合はそのまま post_id を返す。
 */
function ensurePostForNotification(
  db: DbExec,
  status: Entity.Status,
  backendUrl: string,
  serverId: number,
): number {
  // posts_backends で既存チェック
  const existing = resolvePostId(db, backendUrl, status.id)
  if (existing !== null) return existing

  // URI で既存チェック
  const normalizedUri = status.uri?.trim() || ''
  if (normalizedUri) {
    const uriRows = db.exec('SELECT post_id FROM posts WHERE object_uri = ?;', {
      bind: [normalizedUri],
      returnValue: 'resultRows',
    }) as number[][]
    if (uriRows.length > 0) {
      // posts_backends マッピングを追加
      db.exec(
        `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
         VALUES (?, ?, ?, ?);`,
        { bind: [uriRows[0][0], backendUrl, status.id, serverId] },
      )
      return uriRows[0][0]
    }
  }

  // 新規投稿を挿入
  const cols = extractStatusColumns(status)
  const profileId = ensureProfile(db, status.account)
  const visibilityId = resolveVisibilityId(db, cols.visibility)
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()

  db.exec(
    `INSERT INTO posts (
      object_uri, origin_server_id, created_at_ms, stored_at,
      author_profile_id, visibility_id, language,
      content_html, spoiler_text, canonical_url,
      has_media, media_count, is_reblog, reblog_of_uri,
      is_sensitive, has_spoiler, in_reply_to_id,
      is_local_only, edited_at
    ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?);`,
    {
      bind: [
        cols.uri,
        serverId,
        created_at_ms,
        now,
        profileId,
        visibilityId,
        cols.language,
        cols.content_html,
        cols.spoiler_text,
        cols.canonical_url,
        cols.has_media,
        cols.media_count,
        cols.is_reblog,
        cols.reblog_of_uri,
        cols.is_sensitive,
        cols.has_spoiler,
        cols.in_reply_to_id,
        0,
        cols.edited_at,
      ],
    },
  )

  const postId = (
    db.exec('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    }) as number[][]
  )[0][0]

  // posts_backends マッピング
  db.exec(
    `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
     VALUES (?, ?, ?, ?);`,
    { bind: [postId, backendUrl, status.id, serverId] },
  )

  // カスタム絵文字を同期
  if (status.emojis.length > 0 || status.account.emojis.length > 0) {
    syncPostCustomEmojis(
      db,
      postId,
      serverId,
      status.emojis,
      status.account.emojis,
    )
  }

  // 投票データを同期
  if (status.poll) {
    syncPollData(db, postId, status.poll)
  }

  return postId
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
  if (
    actorProfileId !== null &&
    notification.account &&
    notification.account.emojis.length > 0
  ) {
    syncProfileCustomEmojis(
      db,
      actorProfileId,
      serverId,
      notification.account.emojis,
    )
  }
  const relatedPostId = notification.status
    ? ensurePostForNotification(db, notification.status, backendUrl, serverId)
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
      if (
        actorProfileId !== null &&
        notification.account &&
        notification.account.emojis.length > 0
      ) {
        syncProfileCustomEmojis(
          db,
          actorProfileId,
          serverId,
          notification.account.emojis,
        )
      }
      const relatedPostId = notification.status
        ? ensurePostForNotification(
            db,
            notification.status,
            backendUrl,
            serverId,
          )
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
