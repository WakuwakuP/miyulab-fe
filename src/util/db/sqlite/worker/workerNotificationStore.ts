/**
 * Worker 側: Notification 関連のトランザクション処理
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import {
  ACTION_TO_ENGAGEMENT,
  ensureProfile,
  ensureProfileAlias,
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
 * 既に存在する場合も post_id を返す。
 *
 * poll_expired 等で通知に付いてくる最新の poll（集計結果・期限）を、タイムライン上の同一投稿に反映するため、
 * 既存 post でも status.poll があれば polls / poll_options を上書き同期する。
 */
function ensurePostForNotification(
  db: DbExec,
  status: Entity.Status,
  backendUrl: string,
  serverId: number,
): { postId: number; updatedPollOnExistingPost: boolean } {
  // posts_backends で既存チェック
  const existing = resolvePostId(db, backendUrl, status.id)
  if (existing !== null) {
    if (status.poll) {
      syncPollData(db, existing, status.poll)
      return { postId: existing, updatedPollOnExistingPost: true }
    }
    return { postId: existing, updatedPollOnExistingPost: false }
  }

  // URI で既存チェック
  const normalizedUri = status.uri?.trim() || ''
  if (normalizedUri) {
    const uriRows = db.exec('SELECT post_id FROM posts WHERE object_uri = ?;', {
      bind: [normalizedUri],
      returnValue: 'resultRows',
    }) as number[][]
    if (uriRows.length > 0) {
      const postId = uriRows[0][0]
      // posts_backends マッピングを追加
      db.exec(
        `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
         VALUES (?, ?, ?, ?);`,
        { bind: [postId, backendUrl, status.id, serverId] },
      )
      if (status.poll) {
        syncPollData(db, postId, status.poll)
        return { postId, updatedPollOnExistingPost: true }
      }
      return { postId, updatedPollOnExistingPost: false }
    }
  }

  // 新規投稿を挿入
  const cols = extractStatusColumns(status)
  const profileId = ensureProfile(db, status.account)
  ensureProfileAlias(db, profileId, serverId, status.account.id)
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

  // 新規行＋poll もタイムラインの集計表示に効くので posts 購読を起こす
  return { postId, updatedPollOnExistingPost: Boolean(status.poll) }
}

/**
 * 通知の status がブーストでラップされ、poll が reblog 先だけに付いているとき用。
 * 元投稿（reblog 内）の local_id で posts を引き、無ければ ensurePostForNotification で格納する。
 */
function syncPollOntoStoredPost(
  db: DbExec,
  carrier: Entity.Status,
  backendUrl: string,
  serverId: number,
): boolean {
  if (!carrier.poll) return false
  const existing = resolvePostId(db, backendUrl, carrier.id)
  if (existing !== null) {
    syncPollData(db, existing, carrier.poll)
    return true
  }
  const r = ensurePostForNotification(db, carrier, backendUrl, serverId)
  return r.updatedPollOnExistingPost
}

/**
 * 単一通知を解決して notifications テーブルに upsert する。
 * handleAddNotification と handleBulkAddNotifications の共通処理を集約。
 *
 * @returns 既存タイムライン投稿の poll を同期した場合 true（posts 購読の再取得用）
 */
function upsertNotification(
  db: DbExec,
  notification: Entity.Notification,
  serverId: number,
  backendUrl: string,
  now: number,
): boolean {
  const created_at_ms = new Date(notification.created_at).getTime()
  const notificationTypeId = resolveNotificationTypeId(db, notification.type)
  const actorProfileId = notification.account
    ? ensureProfile(db, notification.account)
    : null
  if (actorProfileId !== null && notification.account) {
    ensureProfileAlias(db, actorProfileId, serverId, notification.account.id)
  }
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
  let relatedPostId: number | null = null
  let touchPosts = false
  if (notification.status) {
    const r = ensurePostForNotification(
      db,
      notification.status,
      backendUrl,
      serverId,
    )
    relatedPostId = r.postId
    touchPosts = r.updatedPollOnExistingPost
    const rb = notification.status.reblog
    if (rb?.poll) {
      touchPosts =
        touchPosts || syncPollOntoStoredPost(db, rb, backendUrl, serverId)
    }
  }

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
        stored_at            = ?,
        reaction_name        = ?,
        reaction_url         = ?
      WHERE notification_id = ?;`,
      {
        bind: [
          notificationTypeId,
          actorProfileId,
          relatedPostId,
          created_at_ms,
          now,
          notification.reaction?.name ?? null,
          notification.reaction?.url ??
            notification.reaction?.static_url ??
            null,
          notificationId,
        ],
      },
    )
  } else {
    db.exec(
      `INSERT INTO notifications (
        server_id, local_id, notification_type_id, actor_profile_id,
        related_post_id, created_at_ms, stored_at,
        reaction_name, reaction_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          serverId,
          notification.id,
          notificationTypeId,
          actorProfileId,
          relatedPostId,
          created_at_ms,
          now,
          notification.reaction?.name ?? null,
          notification.reaction?.url ??
            notification.reaction?.static_url ??
            null,
        ],
      },
    )
  }

  return touchPosts
}

export function handleAddNotification(
  db: DbExec,
  notificationJson: string,
  backendUrl: string,
): HandlerResult {
  const notification = JSON.parse(notificationJson) as Entity.Notification
  const now = Date.now()
  const serverId = ensureServer(db, backendUrl)
  const touchPosts = upsertNotification(
    db,
    notification,
    serverId,
    backendUrl,
    now,
  )
  return {
    changedTables: touchPosts
      ? (['notifications', 'posts'] as TableName[])
      : ['notifications'],
  }
}

export function handleBulkAddNotifications(
  db: DbExec,
  notificationsJson: string[],
  backendUrl: string,
): HandlerResult {
  if (notificationsJson.length === 0) return { changedTables: [] }

  const now = Date.now()

  db.exec('BEGIN;')
  let touchPosts = false
  try {
    const serverId = ensureServer(db, backendUrl)
    for (const nJson of notificationsJson) {
      const notification = JSON.parse(nJson) as Entity.Notification
      if (upsertNotification(db, notification, serverId, backendUrl, now)) {
        touchPosts = true
      }
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return {
    changedTables: touchPosts
      ? (['notifications', 'posts'] as TableName[])
      : ['notifications'],
  }
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
