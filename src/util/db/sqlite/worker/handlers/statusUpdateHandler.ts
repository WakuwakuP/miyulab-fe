/**
 * Status 更新ハンドラ
 *
 * statusHandlers.ts から分割。ロジック変更なし。
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  ensureProfileAlias,
  ensureServer,
  extractStatusColumns,
  resolveLocalAccountId,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncPostLinkCard,
  syncProfileCustomEmojis,
  toggleEngagement,
} from '../../shared'
import {
  ensureReblogOriginalPost,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
import {
  resolvePostIdInternal,
  resolveReplyToPostId,
  resolveRepostOfPostId,
  resolveVisibilityId,
} from './statusHelpers'
import type { DbExec, HandlerResult } from './types'

export function handleUpdateStatus(
  db: DbExec,
  statusJson: string,
  backendUrl: string,
): HandlerResult {
  const status = JSON.parse(statusJson) as Entity.Status
  const now = Date.now()
  const cols = extractStatusColumns(status)

  // handleUpsertStatus と同様に URI → posts_backends の順で検索
  let postId: number | null = null
  const normalizedUri = status.uri?.trim() || ''
  if (normalizedUri) {
    const existingRows = db.exec(
      'SELECT post_id FROM posts WHERE object_uri = ?;',
      { bind: [normalizedUri], returnValue: 'resultRows' },
    ) as number[][]
    if (existingRows.length > 0) {
      postId = existingRows[0][0]
    }
  }
  if (postId === null) {
    postId = resolvePostIdInternal(db, backendUrl, status.id)
  }
  if (postId === null) return { changedTables: [] }

  const existing = db.exec('SELECT post_id FROM posts WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]

  if (existing.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const visibilityId = resolveVisibilityId(db, cols.visibility)
    const profileId = ensureProfile(db, status.account)
    const serverId = ensureServer(db, backendUrl)
    ensureProfileAlias(db, profileId, serverId, status.account.id)
    if (status.account.emojis.length > 0) {
      syncProfileCustomEmojis(db, profileId, serverId, status.account.emojis)
    }

    const replyToPostId = resolveReplyToPostId(
      db,
      cols.in_reply_to_id,
      serverId,
    )
    const repostOfPostId =
      cols.is_reblog === 1
        ? resolveRepostOfPostId(db, cols.reblog_of_uri)
        : null

    // object_uri / created_at_ms / author_profile_id は編集で変わらないため更新しない
    // author_profile_id: ActivityPub では著者は不変。クロスバックエンド到着時の
    // profile_id 不整合を防ぐため INSERT 時にのみ設定する。
    db.exec(
      `UPDATE posts SET
         stored_at          = ?,
         visibility_id      = ?,
         language           = ?,
         content_html       = ?,
         spoiler_text       = ?,
         canonical_url      = ?,
         has_media          = ?,
         media_count        = ?,
         is_reblog          = ?,
         reblog_of_uri      = ?,
         is_sensitive       = ?,
         has_spoiler        = ?,
         in_reply_to_id     = ?,
         edited_at          = ?,
         reply_to_post_id   = ?,
         repost_of_post_id  = ?
       WHERE post_id = ?;`,
      {
        bind: [
          now,
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
          cols.edited_at,
          replyToPostId,
          repostOfPostId,
          postId,
        ],
      },
    )

    upsertMentionsInternal(db, postId, status.mentions, serverId)
    syncPostMedia(db, postId, status.media_attachments, status.sensitive)
    syncPostStats(db, postId, status)

    // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    if (localAccountId !== null) {
      if (status.favourited) {
        toggleEngagement(db, localAccountId, postId, 'favourite', true)
      }
      if (status.reblogged) {
        toggleEngagement(db, localAccountId, postId, 'reblog', true)
      }
      if (status.bookmarked) {
        toggleEngagement(db, localAccountId, postId, 'bookmark', true)
      }
    }

    syncPostCustomEmojis(
      db,
      postId,
      serverId,
      status.emojis ?? [],
      status.account?.emojis ?? [],
    )
    syncPostHashtags(db, postId, status.tags)
    syncPollData(db, postId, status.poll)
    syncPostLinkCard(db, postId, status.card)

    // リブログの場合、元投稿も更新する
    if (cols.is_reblog === 1 && status.reblog) {
      ensureReblogOriginalPost(
        db,
        status.reblog,
        backendUrl,
        serverId,
        now,
        localAccountId,
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}
