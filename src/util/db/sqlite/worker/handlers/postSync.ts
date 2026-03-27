/**
 * 投稿データの同期処理ヘルパー群
 *
 * statusHelpers.ts から分割。ロジック変更なし。
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  ensureProfileAlias,
  extractStatusColumns,
  resolveEmojisFromDb,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncPostLinkCard,
  syncProfileCustomEmojis,
  toggleEngagement,
} from '../../shared'
import {
  getLastInsertRowId,
  resolveMediaTypeId,
  resolvePostIdInternal,
  resolveReplyToPostId,
  resolveRepostOfPostId,
  resolveVisibilityId,
} from './statusHelpers'
import type { DbExec } from './types'

// ================================================================
// メンション同期
// ================================================================

export function upsertMentionsInternal(
  db: DbExec,
  postId: number,
  mentions: Entity.Mention[],
  serverId: number,
): void {
  const keepAccts: string[] = []

  for (const mention of mentions) {
    // Try to resolve profile_id from acct
    let profileId: number | null = null

    // First try: look up by remote_account_id in profile_aliases
    if (mention.id) {
      const aliasRows = db.exec(
        `SELECT pa.profile_id FROM profile_aliases pa
         WHERE pa.server_id = ? AND pa.remote_account_id = ?
         LIMIT 1;`,
        { bind: [serverId, mention.id], returnValue: 'resultRows' },
      ) as number[][]
      if (aliasRows.length > 0) {
        profileId = aliasRows[0][0]
      }
    }

    // Second try: look up by acct in profiles
    if (profileId === null && mention.acct) {
      const profileRows = db.exec(
        'SELECT profile_id FROM profiles WHERE acct = ? LIMIT 1;',
        { bind: [mention.acct], returnValue: 'resultRows' },
      ) as number[][]
      if (profileRows.length > 0) {
        profileId = profileRows[0][0]
      }
    }

    db.exec(
      `INSERT INTO posts_mentions (post_id, acct, profile_id)
       VALUES (?, ?, ?)
       ON CONFLICT(post_id, acct) DO UPDATE SET
         profile_id = COALESCE(excluded.profile_id, posts_mentions.profile_id);`,
      { bind: [postId, mention.acct, profileId] },
    )
    keepAccts.push(mention.acct)
  }

  // Remove stale mentions
  if (keepAccts.length === 0) {
    db.exec('DELETE FROM posts_mentions WHERE post_id = ?;', {
      bind: [postId],
    })
  } else {
    const ph = keepAccts.map(() => '?').join(',')
    db.exec(
      `DELETE FROM posts_mentions WHERE post_id = ? AND acct NOT IN (${ph});`,
      { bind: [postId, ...keepAccts] },
    )
  }
}

// ================================================================
// メディア同期
// ================================================================

export function syncPostMedia(
  db: DbExec,
  postId: number,
  mediaAttachments: Entity.Attachment[],
  isSensitive: boolean,
): void {
  for (let i = 0; i < mediaAttachments.length; i++) {
    const media = mediaAttachments[i]
    const mediaTypeId = resolveMediaTypeId(db, media.type)
    db.exec(
      `INSERT INTO post_media (
        post_id, media_type_id, remote_media_id, url, preview_url,
        description, blurhash, sort_order, is_sensitive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(post_id, sort_order) DO UPDATE SET
        media_type_id  = excluded.media_type_id,
        remote_media_id = excluded.remote_media_id,
        url            = excluded.url,
        preview_url    = excluded.preview_url,
        description    = excluded.description,
        blurhash       = excluded.blurhash,
        is_sensitive   = excluded.is_sensitive;`,
      {
        bind: [
          postId,
          mediaTypeId,
          media.id,
          media.url,
          media.preview_url ?? null,
          media.description ?? null,
          media.blurhash ?? null,
          i,
          isSensitive ? 1 : 0,
        ],
      },
    )
  }

  // Remove excess media (in case attachments decreased)
  db.exec('DELETE FROM post_media WHERE post_id = ? AND sort_order >= ?;', {
    bind: [postId, mediaAttachments.length],
  })
}

// ================================================================
// 遅延参照解決
// ================================================================

/**
 * 新しい投稿が到着した時、この投稿を in_reply_to_id で参照している
 * 既存投稿の reply_to_post_id を遅延解決で更新する。
 */
export function resolveDelayedReplyReferences(
  db: DbExec,
  postId: number,
  localId: string,
  serverId: number,
): void {
  // この投稿の local_id を in_reply_to_id として持つ既存投稿を更新
  db.exec(
    `UPDATE posts SET reply_to_post_id = ?
     WHERE reply_to_post_id IS NULL
       AND in_reply_to_id = ?
       AND post_id IN (
         SELECT pb.post_id FROM posts_backends pb WHERE pb.server_id = ?
       );`,
    { bind: [postId, localId, serverId] },
  )
}

/**
 * 新しい投稿が到着した時、この投稿の object_uri を reblog_of_uri で参照している
 * 既存投稿の repost_of_post_id を遅延解決で更新する。
 */
export function resolveDelayedRepostReferences(
  db: DbExec,
  postId: number,
  objectUri: string,
): void {
  if (!objectUri) return
  db.exec(
    `UPDATE posts SET repost_of_post_id = ?
     WHERE repost_of_post_id IS NULL
       AND reblog_of_uri = ?;`,
    { bind: [postId, objectUri] },
  )
}

// ================================================================
// 投稿統計同期
// ================================================================

export function syncPostStats(
  db: DbExec,
  postId: number,
  status: Entity.Status,
): void {
  // emoji_reactions を JSON 文字列に変換（account_ids のみ保持、accounts は省略）
  const emojiReactionsJson =
    status.emoji_reactions && status.emoji_reactions.length > 0
      ? JSON.stringify(
          status.emoji_reactions.map((r) => ({
            account_ids: r.account_ids,
            count: r.count,
            me: r.me,
            name: r.name,
            static_url: r.static_url,
            url: r.url,
          })),
        )
      : null

  db.exec(
    `INSERT INTO post_stats (
      post_id, replies_count, reblogs_count, favourites_count, emoji_reactions_json, fetched_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_id) DO UPDATE SET
      replies_count        = excluded.replies_count,
      reblogs_count        = excluded.reblogs_count,
      favourites_count     = excluded.favourites_count,
      emoji_reactions_json = excluded.emoji_reactions_json,
      fetched_at           = excluded.fetched_at;`,
    {
      bind: [
        postId,
        status.replies_count,
        status.reblogs_count,
        status.favourites_count,
        emojiReactionsJson,
      ],
    },
  )
}

// ================================================================
// リブログ元投稿の保存ヘルパー
// ================================================================

/**
 * リブログ元投稿（status.reblog）を posts テーブルに保存する。
 * タイムラインへの紐付けは行わない（元投稿は直接タイムラインに属さないため）。
 */
export function ensureReblogOriginalPost(
  db: DbExec,
  originalStatus: Entity.Status,
  backendUrl: string,
  serverId: number,
  now: number,
  localAccountId: number | null,
): void {
  const normalizedUri = originalStatus.uri?.trim() || ''
  if (!normalizedUri) return

  const cols = extractStatusColumns(originalStatus)
  const created_at_ms = new Date(originalStatus.created_at).getTime()
  const visibilityId = resolveVisibilityId(db, cols.visibility)
  const profileId = ensureProfile(db, originalStatus.account)
  ensureProfileAlias(db, profileId, serverId, originalStatus.account.id)
  const accountEmojis =
    originalStatus.account.emojis.length > 0
      ? originalStatus.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.account.display_name,
          backendUrl,
        )
  if (accountEmojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, accountEmojis)
  }

  let postId: number | undefined

  // URI で既存投稿を検索（リブログ行は対象外 — 同一 URI のリブログを上書きしない）
  const existingRows = db.exec(
    'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
    { bind: [normalizedUri], returnValue: 'resultRows' },
  ) as number[][]
  if (existingRows.length > 0 && existingRows[0][1] === 0) {
    postId = existingRows[0][0]
  }

  // posts_backends で検索
  if (postId === undefined) {
    postId =
      resolvePostIdInternal(db, backendUrl, originalStatus.id) ?? undefined
  }

  const replyToPostId = resolveReplyToPostId(db, cols.in_reply_to_id, serverId)
  const repostOfPostId = resolveRepostOfPostId(db, cols.reblog_of_uri)

  if (postId !== undefined) {
    // author_profile_id は更新しない（handleUpsertStatus と同一方針）
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
        is_reblog          = 0,
        reblog_of_uri      = NULL,
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
  } else {
    db.exec(
      `INSERT INTO posts (
        object_uri, origin_server_id, created_at_ms, stored_at,
        author_profile_id, visibility_id, language,
        content_html, spoiler_text, canonical_url,
        has_media, media_count, is_reblog, reblog_of_uri,
        is_sensitive, has_spoiler, in_reply_to_id,
        is_local_only, edited_at,
        reply_to_post_id, repost_of_post_id
      ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,0,NULL, ?,?,?, ?,?, ?,?);`,
      {
        bind: [
          normalizedUri,
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
          cols.is_sensitive,
          cols.has_spoiler,
          cols.in_reply_to_id,
          0,
          cols.edited_at,
          replyToPostId,
          repostOfPostId,
        ],
      },
    )
    postId = getLastInsertRowId(db)
  }

  db.exec(
    `INSERT OR IGNORE INTO posts_backends (server_id, local_id, post_id, backendUrl)
     VALUES (?, ?, ?, ?);`,
    { bind: [serverId, originalStatus.id, postId, backendUrl] },
  )

  // Delayed resolution: update other posts that reference this post
  resolveDelayedReplyReferences(db, postId, originalStatus.id, serverId)
  if (normalizedUri) {
    resolveDelayedRepostReferences(db, postId, normalizedUri)
  }

  upsertMentionsInternal(db, postId, originalStatus.mentions, serverId)
  syncPostMedia(
    db,
    postId,
    originalStatus.media_attachments,
    originalStatus.sensitive,
  )
  syncPostStats(db, postId, originalStatus)
  const resolvedStatusEmojis =
    originalStatus.emojis?.length > 0
      ? originalStatus.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.plain_content ?? null,
          backendUrl,
        )
  const resolvedAccountEmojis =
    originalStatus.account?.emojis?.length > 0
      ? originalStatus.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.account?.display_name ?? null,
          backendUrl,
        )
  syncPostCustomEmojis(
    db,
    postId,
    serverId,
    resolvedStatusEmojis,
    resolvedAccountEmojis,
  )
  syncPostHashtags(db, postId, originalStatus.tags)
  syncPollData(db, postId, originalStatus.poll)
  syncPostLinkCard(db, postId, originalStatus.card)

  // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
  // === true で設定、=== false で解除、null/undefined はスキップ（データなし）
  if (localAccountId !== null) {
    if (originalStatus.favourited === true) {
      toggleEngagement(db, localAccountId, postId, 'favourite', true)
    } else if (originalStatus.favourited === false) {
      toggleEngagement(db, localAccountId, postId, 'favourite', false)
    }
    if (originalStatus.reblogged === true) {
      toggleEngagement(db, localAccountId, postId, 'reblog', true)
    } else if (originalStatus.reblogged === false) {
      toggleEngagement(db, localAccountId, postId, 'reblog', false)
    }
    if (originalStatus.bookmarked === true) {
      toggleEngagement(db, localAccountId, postId, 'bookmark', true)
    } else if (originalStatus.bookmarked === false) {
      toggleEngagement(db, localAccountId, postId, 'bookmark', false)
    }
  }
}
