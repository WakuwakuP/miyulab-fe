/**
 * Worker 側: Notification 関連のトランザクション処理
 *
 * 新スキーマ (v2) 対応版:
 *   - notification_types: code → name, DBルックアップ → インライン定数マップ
 *   - posts_backends → post_backend_ids
 *   - extractStatusColumns → extractPostColumns
 *   - ensureProfileAlias 削除
 *   - ensureServer(db, host) — host は backendUrl から抽出
 *   - ensureProfile(db, account, serverId)
 *   - posts PK: post_id → id
 *   - notifications: server_id / stored_at 削除, local_account_id 必須
 *   - UNIQUE: (server_id, local_id) → (local_account_id, local_id)
 *   - toggleEngagement / ACTION_TO_ENGAGEMENT → updateInteraction
 *   - syncPostCustomEmojis: accountEmojis パラメータ削除
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  ensureServer,
  extractPostColumns,
  resolveLocalAccountId,
  resolvePostId,
  syncPollData,
  syncPostCustomEmojis,
  syncProfileCustomEmojis,
  updateInteraction,
} from '../helpers'
import type { TableName } from '../protocol'
import { syncPostMedia, upsertMentionsInternal } from './handlers/postSync'

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

// ================================================================
// notification_types 定数マップ（DB シードと一致）
// ================================================================

const NOTIFICATION_TYPE_MAP = new Map<string, number>([
  ['follow', 1],
  ['favourite', 2],
  ['reblog', 3],
  ['mention', 4],
  ['emoji_reaction', 5],
  ['pleroma:emoji_reaction', 5],
  ['reaction', 5],
  ['follow_request', 6],
  ['status', 7],
  ['poll_vote', 8],
  ['poll_expired', 9],
  ['update', 10],
  ['move', 11],
  ['admin_signup', 12],
  ['admin_report', 13],
  ['follow_request_accepted', 14],
  ['login_bonus', 100],
  ['create_token', 101],
  ['export_completed', 102],
  ['login', 103],
  ['unknown', 199],
])

const UNKNOWN_TYPE_ID = 199

/** アクション名 → updateInteraction で使用するアクション名 */
const ACTION_NAME_MAP: Record<string, string> = {
  bookmarked: 'bookmark',
  favourited: 'favourite',
  reblogged: 'reblog',
}

// ================================================================
// ヘルパー
// ================================================================

/**
 * backendUrl からホスト名を抽出する。
 * 例: "https://mastodon.social" → "mastodon.social"
 */
function extractHost(backendUrl: string): string {
  try {
    return new URL(backendUrl).host
  } catch {
    return backendUrl
  }
}

/**
 * notification type 名から notification_types の id を解決する。
 * DBルックアップは行わず、インラインの定数マップを使用する。
 * 不明な type 名の場合は 199 (unknown) を返す。
 */
export function resolveNotificationTypeId(
  _db: DbExec,
  notificationType: string,
): number {
  return NOTIFICATION_TYPE_MAP.get(notificationType) ?? UNKNOWN_TYPE_ID
}

/**
 * 通知の関連投稿が DB に存在しない場合、Entity.Status から投稿を挿入して postId を返す。
 * 既に存在する場合も postId を返す。
 *
 * poll_expired 等で通知に付いてくる最新の poll（集計結果・期限）を、タイムライン上の同一投稿に反映するため、
 * 既存 post でも status.poll があれば polls / poll_options を上書き同期する。
 */
function ensurePostForNotification(
  db: DbExec,
  status: Entity.Status,
  backendUrl: string,
  serverId: number,
  localAccountId: number,
): { postId: number; updatedPollOnExistingPost: boolean } {
  // post_backend_ids で既存チェック
  const existing = resolvePostId(db, backendUrl, status.id)
  if (existing !== undefined) {
    if (status.poll) {
      syncPollData(db, existing, status.poll)
      return { postId: existing, updatedPollOnExistingPost: true }
    }
    return { postId: existing, updatedPollOnExistingPost: false }
  }

  // URI で既存チェック
  const normalizedUri = status.uri?.trim() || ''
  if (normalizedUri) {
    const uriRows = db.exec('SELECT id FROM posts WHERE object_uri = ?;', {
      bind: [normalizedUri],
      returnValue: 'resultRows',
    }) as number[][]
    if (uriRows.length > 0) {
      const postId = uriRows[0][0]
      // post_backend_ids マッピングを追加
      db.exec(
        `INSERT OR IGNORE INTO post_backend_ids (local_account_id, local_id, post_id)
         VALUES (?, ?, ?);`,
        { bind: [localAccountId, status.id, postId] },
      )
      if (status.poll) {
        syncPollData(db, postId, status.poll)
        return { postId, updatedPollOnExistingPost: true }
      }
      return { postId, updatedPollOnExistingPost: false }
    }
  }

  // 新規投稿を挿入
  const cols = extractPostColumns(status)
  const profileId = ensureProfile(db, status.account, serverId)

  if (status.account.emojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, status.account.emojis)
  }

  // Resolve FK references
  const repostOfPostId = status.reblog?.uri
    ? (() => {
        const rows = db.exec(
          "SELECT id FROM posts WHERE object_uri = ? AND object_uri != '' LIMIT 1;",
          { bind: [status.reblog.uri], returnValue: 'resultRows' },
        ) as number[][]
        return rows.length > 0 ? rows[0][0] : null
      })()
    : null

  db.exec(
    `INSERT INTO posts (
      object_uri, origin_server_id, created_at_ms,
      author_profile_id, visibility_id, language,
      content_html, spoiler_text, canonical_url,
      is_sensitive, in_reply_to_uri, in_reply_to_account_acct,
      is_local_only, edited_at_ms,
      reblog_of_post_id,
      plain_content, quote_state, application_name
    ) VALUES (?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?, ?, ?,?,?);`,
    {
      bind: [
        cols.object_uri,
        serverId,
        cols.created_at_ms,
        profileId,
        cols.visibility_id,
        cols.language,
        cols.content_html,
        cols.spoiler_text,
        cols.canonical_url,
        cols.is_sensitive,
        cols.in_reply_to_uri,
        cols.in_reply_to_account_acct,
        cols.is_local_only,
        cols.edited_at_ms,
        repostOfPostId,
        cols.plain_content,
        cols.quote_state,
        cols.application_name,
      ],
    },
  )

  const postId = (
    db.exec('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    }) as number[][]
  )[0][0]

  // post_backend_ids マッピング
  db.exec(
    `INSERT OR IGNORE INTO post_backend_ids (local_account_id, local_id, post_id)
     VALUES (?, ?, ?);`,
    { bind: [localAccountId, status.id, postId] },
  )

  // カスタム絵文字を同期
  if (status.emojis.length > 0) {
    syncPostCustomEmojis(db, postId, serverId, status.emojis)
  }

  // メディア添付ファイルを同期
  if (status.media_attachments?.length > 0) {
    syncPostMedia(db, postId, status.media_attachments)
  }

  // メンションを同期
  if (status.mentions?.length > 0) {
    upsertMentionsInternal(db, postId, status.mentions)
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
  localAccountId: number,
): boolean {
  if (!carrier.poll) return false
  const existing = resolvePostId(db, backendUrl, carrier.id)
  if (existing !== undefined) {
    syncPollData(db, existing, carrier.poll)
    return true
  }
  const r = ensurePostForNotification(
    db,
    carrier,
    backendUrl,
    serverId,
    localAccountId,
  )
  return r.updatedPollOnExistingPost
}

/**
 * 単一通知を解決して notifications テーブルに upsert する。
 * handleAddNotification と handleBulkAddNotifications の共通処理を集約。
 *
 * @returns 既存タイムライン投稿の poll を同期した場合 true（posts 購読の再取得用）
 */
export function upsertNotification(
  db: DbExec,
  notification: Entity.Notification,
  backendUrl: string,
): boolean {
  const host = extractHost(backendUrl)
  const serverId = ensureServer(db, host)
  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) {
    // local_accounts に未登録の backendUrl → NOT NULL 制約違反を回避
    return false
  }

  const created_at_ms = new Date(notification.created_at).getTime()
  const notificationTypeId = resolveNotificationTypeId(db, notification.type)
  const actorProfileId = notification.account
    ? ensureProfile(db, notification.account, serverId)
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

  let relatedPostId: number | null = null
  let touchPosts = false
  if (notification.status && localAccountId !== null) {
    const r = ensurePostForNotification(
      db,
      notification.status,
      backendUrl,
      serverId,
      localAccountId,
    )
    relatedPostId = r.postId
    touchPosts = r.updatedPollOnExistingPost
    const rb = notification.status.reblog
    if (rb?.poll) {
      touchPosts =
        touchPosts ||
        syncPollOntoStoredPost(db, rb, backendUrl, serverId, localAccountId)
    }
  }

  // リアクション名・URL を解決（カスタム絵文字の URL が欠落している場合は DB / Misskey フォールバックで補完）
  const reactionName = notification.reaction?.name ?? null
  let reactionUrl =
    notification.reaction?.url ?? notification.reaction?.static_url ?? null

  if (
    reactionUrl == null &&
    reactionName != null &&
    reactionName.startsWith(':') &&
    reactionName.endsWith(':') &&
    reactionName.length > 2
  ) {
    const shortcode = reactionName.slice(1, -1)
    const emojiRows = db.exec(
      'SELECT url, static_url FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
      { bind: [serverId, shortcode], returnValue: 'resultRows' },
    ) as (string | null)[][]
    if (emojiRows.length > 0) {
      reactionUrl = (emojiRows[0][1] ?? emojiRows[0][0]) as string
    } else {
      // Misskey URL パターンフォールバック
      reactionUrl = `${backendUrl}/emoji/${encodeURIComponent(shortcode)}.webp`
    }
  }

  // UPSERT: ON CONFLICT(local_account_id, local_id) DO UPDATE
  db.exec(
    `INSERT INTO notifications (
      local_account_id, local_id, notification_type_id, created_at_ms,
      actor_profile_id, related_post_id, reaction_name, reaction_url, is_read
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(local_account_id, local_id) DO UPDATE SET
      notification_type_id = excluded.notification_type_id,
      actor_profile_id     = excluded.actor_profile_id,
      related_post_id      = excluded.related_post_id,
      reaction_name        = excluded.reaction_name,
      reaction_url         = excluded.reaction_url;`,
    {
      bind: [
        localAccountId,
        notification.id,
        notificationTypeId,
        created_at_ms,
        actorProfileId,
        relatedPostId,
        reactionName,
        reactionUrl,
        0, // is_read default
      ],
    },
  )

  return touchPosts
}

export function handleAddNotification(
  db: DbExec,
  notificationJson: string,
  backendUrl: string,
): HandlerResult {
  const notification = JSON.parse(notificationJson) as Entity.Notification
  const host = extractHost(backendUrl)
  ensureServer(db, host)
  const touchPosts = upsertNotification(db, notification, backendUrl)
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

  db.exec('BEGIN;')
  let touchPosts = false
  try {
    const host = extractHost(backendUrl)
    ensureServer(db, host)
    for (const nJson of notificationsJson) {
      const notification = JSON.parse(nJson) as Entity.Notification
      if (upsertNotification(db, notification, backendUrl)) {
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
  const postId = resolvePostId(db, backendUrl, statusId)
  if (postId === undefined) return { changedTables: [] }

  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  const normalizedAction = ACTION_NAME_MAP[action]
  if (!normalizedAction) return { changedTables: [] }

  updateInteraction(db, postId, localAccountId, normalizedAction, value)

  return { changedTables: ['notifications'] }
}
