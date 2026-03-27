/**
 * Status 更新ハンドラ
 *
 * 新スキーマ (v2) 対応版:
 *   - posts PK: post_id → id
 *   - posts カラム: stored_at/has_media/media_count/has_spoiler/reblog_of_uri 削除
 *   - 新カラム: last_fetched_at/edited_at_ms/plain_content/in_reply_to_account_acct/
 *     reblog_of_post_id/quote_of_post_id/quote_state/application_name
 *   - ensureProfileAlias 削除
 *   - toggleEngagement → updateInteraction
 *   - extractStatusColumns → extractPostColumns
 *   - ensureServer(db, host) / ensureProfile(db, account, serverId)
 *   - resolvePostIdInternal(db, localAccountId, localId)
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  ensureServer,
  extractPostColumns,
  resolveLocalAccountId,
  syncLinkCard,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncProfileCustomEmojis,
  updateInteraction,
} from '../../helpers'
import {
  ensureReblogOriginalPost,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
import {
  resolvePostIdInternal,
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
  const cols = extractPostColumns(status)

  // handleUpsertStatus と同様に URI → post_backend_ids の順で検索
  let postId: number | null = null
  const normalizedUri = status.uri?.trim() || ''
  if (normalizedUri) {
    const existingRows = db.exec('SELECT id FROM posts WHERE object_uri = ?;', {
      bind: [normalizedUri],
      returnValue: 'resultRows',
    }) as number[][]
    if (existingRows.length > 0) {
      postId = existingRows[0][0]
    }
  }
  if (postId === null) {
    const localAccountIdForLookup = resolveLocalAccountId(db, backendUrl)
    if (localAccountIdForLookup !== null) {
      postId =
        resolvePostIdInternal(db, localAccountIdForLookup, status.id) ?? null
    }
  }
  if (postId === null) return { changedTables: [] }

  const existing = db.exec('SELECT id FROM posts WHERE id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]

  if (existing.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const host = new URL(backendUrl).host
    const serverId = ensureServer(db, host)
    const visibilityId = resolveVisibilityId(db, cols.visibility_id.toString())
    const profileId = ensureProfile(db, status.account, serverId)
    if (status.account.emojis.length > 0) {
      syncProfileCustomEmojis(db, profileId, serverId, status.account.emojis)
    }

    const isReblog = status.reblog != null ? 1 : 0
    const reblogOfUri = status.reblog?.uri ?? null
    const reblogOfPostId =
      isReblog === 1 ? resolveRepostOfPostId(db, reblogOfUri) : null

    // object_uri / created_at_ms / author_profile_id は編集で変わらないため更新しない
    // author_profile_id: ActivityPub では著者は不変。クロスバックエンド到着時の
    // profile_id 不整合を防ぐため INSERT 時にのみ設定する。
    db.exec(
      `UPDATE posts SET
         last_fetched_at        = ?,
         visibility_id          = ?,
         language               = ?,
         content_html           = ?,
         spoiler_text           = ?,
         canonical_url          = ?,
         is_reblog              = ?,
         is_sensitive           = ?,
         in_reply_to_uri        = ?,
         in_reply_to_account_acct = ?,
         edited_at_ms           = ?,
         plain_content          = ?,
         quote_state            = ?,
         is_local_only          = ?,
         application_name       = ?,
         reblog_of_post_id      = ?,
         quote_of_post_id       = ?
       WHERE id = ?;`,
      {
        bind: [
          now,
          visibilityId ?? cols.visibility_id,
          cols.language,
          cols.content_html,
          cols.spoiler_text,
          cols.canonical_url,
          isReblog,
          cols.is_sensitive,
          cols.in_reply_to_uri,
          cols.in_reply_to_account_acct,
          cols.edited_at_ms,
          cols.plain_content,
          cols.quote_state,
          cols.is_local_only,
          cols.application_name,
          reblogOfPostId,
          null, // quote_of_post_id: 将来拡張用
          postId,
        ],
      },
    )

    upsertMentionsInternal(db, postId, status.mentions)
    syncPostMedia(db, postId, status.media_attachments)
    syncPostStats(db, postId, status)

    // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    if (localAccountId !== null) {
      if (status.favourited === true) {
        updateInteraction(db, postId, localAccountId, 'favourite', true)
      } else if (status.favourited === false) {
        updateInteraction(db, postId, localAccountId, 'favourite', false)
      }
      if (status.reblogged === true) {
        updateInteraction(db, postId, localAccountId, 'reblog', true)
      } else if (status.reblogged === false) {
        updateInteraction(db, postId, localAccountId, 'reblog', false)
      }
      if (status.bookmarked === true) {
        updateInteraction(db, postId, localAccountId, 'bookmark', true)
      } else if (status.bookmarked === false) {
        updateInteraction(db, postId, localAccountId, 'bookmark', false)
      }
    }

    syncPostCustomEmojis(db, postId, serverId, [
      ...(status.emojis ?? []),
      ...(status.account?.emojis ?? []),
    ])
    syncPostHashtags(db, postId, status.tags)
    syncPollData(db, postId, status.poll)
    syncLinkCard(db, postId, status.card)

    // リブログの場合、元投稿も更新する
    if (isReblog === 1 && status.reblog) {
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
