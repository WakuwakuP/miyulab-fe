/**
 * Worker 側: Status 関連のトランザクション処理
 *
 * 現行 statusStore.ts のビジネスロジックを Worker 内で実行する純粋関数群。
 * 生の Database オブジェクトを引数に取り、フォールバックモードからも直接呼べる。
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import {
  ACTION_TO_ENGAGEMENT,
  ensureCustomEmoji,
  ensureProfile,
  ensureProfileAlias,
  ensureServer,
  ensureTimeline,
  extractStatusColumns,
  resolveEmojisFromDb,
  resolveLocalAccountId,
  resolvePostItemKindId,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncPostLinkCard,
  syncProfileCustomEmojis,
  toggleEngagement,
  toggleReaction,
} from '../shared'

// ================================================================
// 内部型（Worker / フォールバック共通）
// ================================================================

/** db.exec 互換の最小インターフェース */
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

// マスターデータキャッシュ（セッション中不変）
const visibilityCache = new Map<string, number | null>()
const mediaTypeCache = new Map<string, number>()
let cachedPostItemKindId: number | null = null

// ================================================================
// 内部ヘルパー
// ================================================================

/**
 * アカウントのドメインを統一的に取得する。
 * - acct に @ が含まれる場合（リモートユーザー）: @ 以降を使用
 * - acct に @ がない場合（ローカルユーザー）: account.url からホスト名を抽出
 *
 * Pleroma はローカルユーザーの acct にドメインを含めないが、
 * Misskey マッパーは常に `username@host` 形式を返す。
 * この関数で両者を統一的に扱う。
 */
function deriveAccountDomain(account: Entity.Account): string {
  if (account.acct.includes('@')) {
    return account.acct.split('@')[1]
  }
  try {
    return new URL(account.url).hostname
  } catch {
    return ''
  }
}

function resolvePostIdInternal(
  db: DbExec,
  backendUrl: string,
  localId: string,
): number | null {
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE server_id = (SELECT server_id FROM servers WHERE base_url = ?) AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

function getLastInsertRowId(db: DbExec): number {
  return (
    db.exec('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    }) as number[][]
  )[0][0]
}

function resolveVisibilityId(db: DbExec, visibility: string): number | null {
  const cached = visibilityCache.get(visibility)
  if (cached !== undefined) return cached
  const rows = db.exec(
    'SELECT visibility_id FROM visibility_types WHERE code = ?;',
    { bind: [visibility], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  if (result !== null) visibilityCache.set(visibility, result)
  return result
}

function upsertMentionsInternal(
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

function resolveMediaTypeId(db: DbExec, mediaType: string): number {
  const cached = mediaTypeCache.get(mediaType)
  if (cached !== undefined) return cached
  const rows = db.exec(
    'SELECT media_type_id FROM media_types WHERE code = ?;',
    { bind: [mediaType], returnValue: 'resultRows' },
  ) as number[][]
  if (rows.length > 0) {
    mediaTypeCache.set(mediaType, rows[0][0])
    return rows[0][0]
  }
  const fallback = db.exec(
    "SELECT media_type_id FROM media_types WHERE code = 'unknown';",
    { returnValue: 'resultRows' },
  ) as number[][]
  mediaTypeCache.set(mediaType, fallback[0][0])
  return fallback[0][0]
}

function syncPostMedia(
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

/**
 * in_reply_to_id (server-local ID) から reply_to_post_id (internal FK) を解決する。
 * posts_backends 経由で post_id を逆引きする。
 */
function resolveReplyToPostId(
  db: DbExec,
  inReplyToId: string | null,
  serverId: number,
): number | null {
  if (!inReplyToId) return null
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE server_id = ? AND local_id = ? LIMIT 1;',
    { bind: [serverId, inReplyToId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * reblog_of_uri (ActivityPub URI) から repost_of_post_id (internal FK) を解決する。
 * posts.object_uri 経由で post_id を逆引きする。
 */
function resolveRepostOfPostId(
  db: DbExec,
  reblogOfUri: string | null,
): number | null {
  if (!reblogOfUri) return null
  const rows = db.exec(
    "SELECT post_id FROM posts WHERE object_uri = ? AND object_uri != '' LIMIT 1;",
    { bind: [reblogOfUri], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * 新しい投稿が到着した時、この投稿を in_reply_to_id で参照している
 * 既存投稿の reply_to_post_id を遅延解決で更新する。
 */
function resolveDelayedReplyReferences(
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
function resolveDelayedRepostReferences(
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

function syncPostStats(
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
function ensureReblogOriginalPost(
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

// ================================================================
// 公開ハンドラ
// ================================================================

export function handleUpsertStatus(
  db: DbExec,
  statusJson: string,
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const status = JSON.parse(statusJson) as Entity.Status
  const normalizedUri = status.uri?.trim() || ''
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()
  const cols = extractStatusColumns(status)

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    const visibilityId = resolveVisibilityId(db, cols.visibility)
    const profileId = ensureProfile(db, status.account)
    ensureProfileAlias(db, profileId, serverId, status.account.id)
    const acctEmojis =
      status.account.emojis.length > 0
        ? status.account.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.account.display_name,
            backendUrl,
          )
    if (acctEmojis.length > 0) {
      syncProfileCustomEmojis(db, profileId, serverId, acctEmojis)
    }

    let postId: number | undefined
    let existingIsOriginal = false

    // URI で既存投稿を検索
    if (normalizedUri) {
      const existingRows = db.exec(
        'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
        { bind: [normalizedUri], returnValue: 'resultRows' },
      ) as number[][]
      if (existingRows.length > 0) {
        if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
          existingIsOriginal = true
        } else {
          postId = existingRows[0][0]
        }
      }
    }

    // URI で見つからない場合、posts_backends で検索
    if (postId === undefined && !existingIsOriginal) {
      postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
    }

    // Pleroma/Misskey: リブログの URI が元投稿と同一の場合、
    // リブログ行に元投稿の URI を割り当てない（元投稿側が URI を保持する）
    if (
      postId === undefined &&
      !existingIsOriginal &&
      cols.is_reblog === 1 &&
      normalizedUri !== '' &&
      normalizedUri === cols.reblog_of_uri
    ) {
      existingIsOriginal = true
    }

    // クロスサーバーリブログの重複検出:
    // 異なるバックエンドから同一リブログが届いた場合（例: Pleroma では URI が
    // 元投稿と同一になり空で保存される一方、Misskey では Announce URI が付与される）、
    // 同一の元投稿URI＋同一投稿者の既存リブログを検索してマージする。
    // author_profile_id はバックエンドごとに URL 形式が異なるため一致しない
    // ことがある（例: Pleroma /users/X vs Misskey /@X）ため、
    // username + domain で照合する。
    let foundViaReblogDedup = false
    if (postId === undefined && cols.is_reblog === 1 && cols.reblog_of_uri) {
      const rebloggerDomain = deriveAccountDomain(status.account)
      if (rebloggerDomain) {
        const existingReblog = db.exec(
          `SELECT p.post_id FROM posts p
           JOIN profiles pr ON pr.profile_id = p.author_profile_id
           WHERE p.is_reblog = 1 AND p.reblog_of_uri = ?
             AND pr.username = ?
             AND (pr.domain = ? OR pr.actor_uri LIKE ?)
           LIMIT 1;`,
          {
            bind: [
              cols.reblog_of_uri,
              status.account.username,
              rebloggerDomain,
              `https://${rebloggerDomain}/%`,
            ],
            returnValue: 'resultRows',
          },
        ) as number[][]
        if (existingReblog.length > 0) {
          postId = existingReblog[0][0]
          existingIsOriginal = false
          foundViaReblogDedup = true
        }
      }
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

    if (postId !== undefined) {
      // author_profile_id は更新しない:
      // ActivityPub では投稿の著者は不変であり、同一バックエンドからの
      // 再取得では同じ profile_id が返るため no-op。
      // 異なるバックエンドからの到着時は actor_uri の URL 形式差異
      // (例: /users/X vs /@X) により別プロファイルが生成されるため、
      // 上書きすると spb が選択するバックエンドの profile_aliases が
      // 存在しなくなる。INSERT 時にのみ設定する。
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
    } else {
      const insertUri = existingIsOriginal ? '' : cols.uri
      db.exec(
        `INSERT INTO posts (
          object_uri, origin_server_id, created_at_ms, stored_at,
          author_profile_id, visibility_id, language,
          content_html, spoiler_text, canonical_url,
          has_media, media_count, is_reblog, reblog_of_uri,
          is_sensitive, has_spoiler, in_reply_to_id,
          is_local_only, edited_at,
          reply_to_post_id, repost_of_post_id
        ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?);`,
        {
          bind: [
            insertUri,
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
            replyToPostId,
            repostOfPostId,
          ],
        },
      )
      postId = getLastInsertRowId(db)
    }

    // リブログマージ時: 既存行の object_uri が空で、新しい URI が
    // 有効な Announce URI の場合は補完する
    if (
      foundViaReblogDedup &&
      normalizedUri &&
      normalizedUri !== cols.reblog_of_uri
    ) {
      db.exec(
        `UPDATE posts SET object_uri = ? WHERE post_id = ? AND object_uri = '';`,
        { bind: [normalizedUri, postId] },
      )
    }

    db.exec(
      `INSERT OR IGNORE INTO posts_backends (server_id, local_id, post_id, backendUrl)
       VALUES (?, ?, ?, ?);`,
      { bind: [serverId, status.id, postId, backendUrl] },
    )

    // Delayed resolution: update other posts that reference this post
    resolveDelayedReplyReferences(db, postId, status.id, serverId)
    if (normalizedUri) {
      resolveDelayedRepostReferences(db, postId, normalizedUri)
    }

    // timeline_items に登録（timelines が未作成なら自動作成）
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const isAccountSpecificTimeline =
      timelineType === 'home' || timelineType === 'notification'
    const timelineId = ensureTimeline(
      db,
      serverId,
      timelineType,
      tag,
      isAccountSpecificTimeline ? localAccountId : null,
    )
    if (cachedPostItemKindId === null) {
      cachedPostItemKindId = resolvePostItemKindId(db)
    }
    const postItemKindId = cachedPostItemKindId
    db.exec(
      `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
       VALUES (?, ?, ?, ?, ?);`,
      { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
    )

    upsertMentionsInternal(db, postId, status.mentions, serverId)
    syncPostMedia(db, postId, status.media_attachments, status.sensitive)
    syncPostStats(db, postId, status)

    // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
    // === true で設定、=== false で解除、null/undefined はスキップ（データなし）
    if (localAccountId !== null) {
      if (status.favourited === true) {
        toggleEngagement(db, localAccountId, postId, 'favourite', true)
      } else if (status.favourited === false) {
        toggleEngagement(db, localAccountId, postId, 'favourite', false)
      }
      if (status.reblogged === true) {
        toggleEngagement(db, localAccountId, postId, 'reblog', true)
      } else if (status.reblogged === false) {
        toggleEngagement(db, localAccountId, postId, 'reblog', false)
      }
      if (status.bookmarked === true) {
        toggleEngagement(db, localAccountId, postId, 'bookmark', true)
      } else if (status.bookmarked === false) {
        toggleEngagement(db, localAccountId, postId, 'bookmark', false)
      }
    }

    const statusEmojisResolved =
      status.emojis?.length > 0
        ? status.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.plain_content ?? null,
            backendUrl,
          )
    const accountEmojisResolved =
      status.account?.emojis?.length > 0
        ? status.account.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.account?.display_name ?? null,
            backendUrl,
          )
    syncPostCustomEmojis(
      db,
      postId,
      serverId,
      statusEmojisResolved,
      accountEmojisResolved,
    )
    syncPostHashtags(db, postId, status.tags)

    // If a specific tag was provided (e.g. from tag timeline), ensure it's in post_hashtags too
    if (tag) {
      const normalizedTag = tag.toLowerCase()
      db.exec(
        `INSERT OR IGNORE INTO hashtags (normalized_name, display_name) VALUES (?, ?);`,
        { bind: [normalizedTag, tag] },
      )
      const tagRows = db.exec(
        'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
        { bind: [normalizedTag], returnValue: 'resultRows' },
      ) as number[][]
      if (tagRows.length > 0) {
        db.exec(
          'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
          { bind: [postId, tagRows[0][0]] },
        )
      }
    }
    syncPollData(db, postId, status.poll)
    syncPostLinkCard(db, postId, status.card)

    if (cols.is_reblog === 1 && cols.reblog_of_uri) {
      db.exec(
        `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
         VALUES (?, ?, ?, ?);`,
        {
          bind: [
            postId,
            cols.reblog_of_uri,
            status.account.acct,
            created_at_ms,
          ],
        },
      )

      // リブログ元投稿も保存（reblog フィールド復元用）
      if (status.reblog) {
        ensureReblogOriginalPost(
          db,
          status.reblog,
          backendUrl,
          serverId,
          now,
          localAccountId,
        )
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleBulkUpsertStatuses(
  db: DbExec,
  statusesJson: string[],
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  if (statusesJson.length === 0) return { changedTables: [] }

  const now = Date.now()
  const uriCache = new Map<string, number>()

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const isAccountSpecificTimeline =
      timelineType === 'home' || timelineType === 'notification'
    const timelineId = ensureTimeline(
      db,
      serverId,
      timelineType,
      tag,
      isAccountSpecificTimeline ? localAccountId : null,
    )
    if (cachedPostItemKindId === null) {
      cachedPostItemKindId = resolvePostItemKindId(db)
    }
    const postItemKindId = cachedPostItemKindId

    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status
      const normalizedUri = status.uri?.trim() || ''
      const created_at_ms = new Date(status.created_at).getTime()
      const cols = extractStatusColumns(status)
      const visibilityId = resolveVisibilityId(db, cols.visibility)
      const profileId = ensureProfile(db, status.account)
      ensureProfileAlias(db, profileId, serverId, status.account.id)
      const bulkAcctEmojis =
        status.account.emojis.length > 0
          ? status.account.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.account.display_name,
              backendUrl,
            )
      if (bulkAcctEmojis.length > 0) {
        syncProfileCustomEmojis(db, profileId, serverId, bulkAcctEmojis)
      }

      let postId: number | undefined = normalizedUri
        ? uriCache.get(normalizedUri)
        : undefined

      // リブログが元投稿を上書きしないようにする
      let existingIsOriginal = false

      if (postId === undefined && normalizedUri) {
        const existingRows = db.exec(
          'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
          { bind: [normalizedUri], returnValue: 'resultRows' },
        ) as number[][]
        if (existingRows.length > 0) {
          if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
            existingIsOriginal = true
          } else {
            postId = existingRows[0][0]
          }
        }
      }

      // URI で見つからない場合、posts_backends で検索
      if (postId === undefined && !existingIsOriginal) {
        postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
      }

      // Pleroma/Misskey: リブログの URI が元投稿と同一の場合、
      // リブログ行に元投稿の URI を割り当てない
      if (
        postId === undefined &&
        !existingIsOriginal &&
        cols.is_reblog === 1 &&
        normalizedUri !== '' &&
        normalizedUri === cols.reblog_of_uri
      ) {
        existingIsOriginal = true
      }

      // クロスサーバーリブログの重複検出（handleUpsertStatus と同一ロジック）
      let foundViaReblogDedup = false
      if (postId === undefined && cols.is_reblog === 1 && cols.reblog_of_uri) {
        const rebloggerDomain = deriveAccountDomain(status.account)
        if (rebloggerDomain) {
          const existingReblog = db.exec(
            `SELECT p.post_id FROM posts p
             JOIN profiles pr ON pr.profile_id = p.author_profile_id
             WHERE p.is_reblog = 1 AND p.reblog_of_uri = ?
               AND pr.username = ?
               AND (pr.domain = ? OR pr.actor_uri LIKE ?)
             LIMIT 1;`,
            {
              bind: [
                cols.reblog_of_uri,
                status.account.username,
                rebloggerDomain,
                `https://${rebloggerDomain}/%`,
              ],
              returnValue: 'resultRows',
            },
          ) as number[][]
          if (existingReblog.length > 0) {
            postId = existingReblog[0][0]
            existingIsOriginal = false
            foundViaReblogDedup = true
          }
        }
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
      } else {
        const insertUri = existingIsOriginal ? '' : cols.uri
        db.exec(
          `INSERT INTO posts (
            object_uri, origin_server_id, created_at_ms, stored_at,
            author_profile_id, visibility_id, language,
            content_html, spoiler_text, canonical_url,
            has_media, media_count, is_reblog, reblog_of_uri,
            is_sensitive, has_spoiler, in_reply_to_id,
            is_local_only, edited_at,
            reply_to_post_id, repost_of_post_id
          ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?);`,
          {
            bind: [
              insertUri,
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
              replyToPostId,
              repostOfPostId,
            ],
          },
        )
        postId = getLastInsertRowId(db)
      }

      // リブログマージ時: 既存行の object_uri が空の場合、実 Announce URI を補完する
      if (
        foundViaReblogDedup &&
        normalizedUri &&
        normalizedUri !== cols.reblog_of_uri
      ) {
        db.exec(
          `UPDATE posts SET object_uri = ? WHERE post_id = ? AND object_uri = '';`,
          { bind: [normalizedUri, postId] },
        )
        uriCache.set(normalizedUri, postId)
      }

      // 同一 URI リブログの場合はキャッシュしない（元投稿が URI を使えるようにする）
      if (
        normalizedUri &&
        !(cols.is_reblog === 1 && normalizedUri === cols.reblog_of_uri)
      ) {
        uriCache.set(normalizedUri, postId)
      }

      db.exec(
        `INSERT OR IGNORE INTO posts_backends (server_id, local_id, post_id, backendUrl)
         VALUES (?, ?, ?, ?);`,
        { bind: [serverId, status.id, postId, backendUrl] },
      )

      // Delayed resolution: update other posts that reference this post
      resolveDelayedReplyReferences(db, postId, status.id, serverId)
      if (normalizedUri) {
        resolveDelayedRepostReferences(db, postId, normalizedUri)
      }

      // timeline_items に登録
      db.exec(
        `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
         VALUES (?, ?, ?, ?, ?);`,
        { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
      )

      upsertMentionsInternal(db, postId, status.mentions, serverId)
      syncPostMedia(db, postId, status.media_attachments, status.sensitive)
      syncPostStats(db, postId, status)

      // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
      // === true で設定、=== false で解除、null/undefined はスキップ（データなし）
      if (localAccountId !== null) {
        if (status.favourited === true) {
          toggleEngagement(db, localAccountId, postId, 'favourite', true)
        } else if (status.favourited === false) {
          toggleEngagement(db, localAccountId, postId, 'favourite', false)
        }
        if (status.reblogged === true) {
          toggleEngagement(db, localAccountId, postId, 'reblog', true)
        } else if (status.reblogged === false) {
          toggleEngagement(db, localAccountId, postId, 'reblog', false)
        }
        if (status.bookmarked === true) {
          toggleEngagement(db, localAccountId, postId, 'bookmark', true)
        } else if (status.bookmarked === false) {
          toggleEngagement(db, localAccountId, postId, 'bookmark', false)
        }
      }

      const bulkStatusEmojis =
        status.emojis?.length > 0
          ? status.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.plain_content ?? null,
              backendUrl,
            )
      const bulkAccountEmojis =
        status.account?.emojis?.length > 0
          ? status.account.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.account?.display_name ?? null,
              backendUrl,
            )
      syncPostCustomEmojis(
        db,
        postId,
        serverId,
        bulkStatusEmojis,
        bulkAccountEmojis,
      )
      syncPostHashtags(db, postId, status.tags)

      // If a specific tag was provided (e.g. from tag timeline), ensure it's in post_hashtags too
      if (tag) {
        const normalizedTag = tag.toLowerCase()
        db.exec(
          `INSERT OR IGNORE INTO hashtags (normalized_name, display_name) VALUES (?, ?);`,
          { bind: [normalizedTag, tag] },
        )
        const tagRows = db.exec(
          'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
          { bind: [normalizedTag], returnValue: 'resultRows' },
        ) as number[][]
        if (tagRows.length > 0) {
          db.exec(
            'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
            { bind: [postId, tagRows[0][0]] },
          )
        }
      }
      syncPollData(db, postId, status.poll)
      syncPostLinkCard(db, postId, status.card)

      // リブログ関係を posts_reblogs に記録（元投稿の URI が存在する場合のみ）
      if (cols.is_reblog === 1 && cols.reblog_of_uri) {
        db.exec(
          `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
           VALUES (?, ?, ?, ?);`,
          {
            bind: [
              postId,
              cols.reblog_of_uri,
              status.account.acct,
              created_at_ms,
            ],
          },
        )

        // リブログ元投稿も保存（reblog フィールド復元用）
        if (status.reblog) {
          ensureReblogOriginalPost(
            db,
            status.reblog,
            backendUrl,
            serverId,
            now,
            localAccountId,
          )
        }
      }
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleRemoveFromTimeline(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const serverId = ensureServer(db, backendUrl)

  db.exec('BEGIN;')
  try {
    // 該当タイムラインから timeline_items を削除
    const timelineRows = db.exec(
      `SELECT t.timeline_id FROM timelines t
       INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
       WHERE t.server_id = ? AND ck.code = ? AND COALESCE(t.tag, '') = ?;`,
      { bind: [serverId, timelineType, tag ?? ''], returnValue: 'resultRows' },
    ) as number[][]

    for (const [timelineId] of timelineRows) {
      db.exec(
        'DELETE FROM timeline_items WHERE timeline_id = ? AND post_id = ?;',
        { bind: [timelineId, postId] },
      )
    }

    if (timelineType === 'tag' && tag) {
      const normalizedTag = tag.toLowerCase()
      db.exec(
        `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id = (
          SELECT hashtag_id FROM hashtags WHERE normalized_name = ?
        );`,
        { bind: [postId, normalizedTag] },
      )
    }

    // どのタイムラインにも属さなくなった投稿を削除
    const remaining = (
      db.exec('SELECT COUNT(*) FROM timeline_items WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (remaining === 0) {
      db.exec('DELETE FROM posts WHERE post_id = ?;', {
        bind: [postId],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleDeleteEvent(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  sourceTimelineType: string,
  tag?: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const serverId = ensureServer(db, backendUrl)

  db.exec('BEGIN;')
  try {
    db.exec(
      'DELETE FROM posts_backends WHERE server_id = (SELECT server_id FROM servers WHERE base_url = ?) AND local_id = ?;',
      { bind: [backendUrl, statusId] },
    )

    const remainingBackends = (
      db.exec('SELECT COUNT(*) FROM posts_backends WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (remainingBackends === 0) {
      db.exec('DELETE FROM posts WHERE post_id = ?;', {
        bind: [postId],
      })
    } else {
      // 該当タイムラインから timeline_items を削除
      const timelineRows = db.exec(
        `SELECT t.timeline_id FROM timelines t
         INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
         WHERE t.server_id = ? AND ck.code = ? AND COALESCE(t.tag, '') = ?;`,
        {
          bind: [serverId, sourceTimelineType, tag ?? ''],
          returnValue: 'resultRows',
        },
      ) as number[][]

      for (const [timelineId] of timelineRows) {
        db.exec(
          'DELETE FROM timeline_items WHERE timeline_id = ? AND post_id = ?;',
          { bind: [timelineId, postId] },
        )
      }

      if (sourceTimelineType === 'tag' && tag) {
        const normalizedTag = tag.toLowerCase()
        db.exec(
          `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id = (
            SELECT hashtag_id FROM hashtags WHERE normalized_name = ?
          );`,
          { bind: [postId, normalizedTag] },
        )
      }

      // どのタイムラインにも属さなくなった投稿を削除
      const remainingTimelines = (
        db.exec('SELECT COUNT(*) FROM timeline_items WHERE post_id = ?;', {
          bind: [postId],
          returnValue: 'resultRows',
        }) as number[][]
      )[0][0]

      if (remainingTimelines === 0) {
        db.exec('DELETE FROM posts WHERE post_id = ?;', {
          bind: [postId],
        })
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleUpdateStatusAction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    if (localAccountId !== null) {
      const engagementCode = ACTION_TO_ENGAGEMENT[action]
      if (engagementCode) {
        // 自分自身のエンゲージメントをトグル
        toggleEngagement(db, localAccountId, postId, engagementCode, value)

        // reblog チェーン: object_uri と reblog_of_uri から関連投稿を更新
        const postInfo = db.exec(
          'SELECT object_uri, reblog_of_uri FROM posts WHERE post_id = ?;',
          { bind: [postId], returnValue: 'resultRows' },
        ) as (string | null)[][]

        if (postInfo.length > 0) {
          const objectUri = postInfo[0][0] as string
          const reblogOfUri = postInfo[0][1] as string | null

          // reblog 元の投稿もトグル
          if (reblogOfUri) {
            const originalRows = db.exec(
              'SELECT post_id FROM posts WHERE object_uri = ?;',
              { bind: [reblogOfUri], returnValue: 'resultRows' },
            ) as number[][]
            if (originalRows.length > 0) {
              toggleEngagement(
                db,
                localAccountId,
                originalRows[0][0],
                engagementCode,
                value,
              )
            }
          }

          // この投稿を reblog として持つ他の投稿もトグル
          if (objectUri) {
            const reblogRows = db.exec(
              `SELECT pr.post_id FROM posts_reblogs pr WHERE pr.original_uri = ?;`,
              { bind: [objectUri], returnValue: 'resultRows' },
            ) as number[][]
            for (const row of reblogRows) {
              toggleEngagement(
                db,
                localAccountId,
                row[0],
                engagementCode,
                value,
              )
            }
          }
        }
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

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

// ================================================================
// フォロー関係同期
// ================================================================

export function handleSyncFollows(
  db: DbExec,
  backendUrl: string,
  accountsJson: string[],
): HandlerResult {
  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    // 現在のフォローを全削除して再構築
    db.exec('DELETE FROM follows WHERE local_account_id = ?;', {
      bind: [localAccountId],
    })

    for (const json of accountsJson) {
      const account = JSON.parse(json) as Entity.Account
      const profileId = ensureProfile(db, account)
      ensureProfileAlias(db, profileId, serverId, account.id)
      if (account.emojis.length > 0) {
        syncProfileCustomEmojis(db, profileId, serverId, account.emojis)
      }
      db.exec(
        `INSERT OR IGNORE INTO follows (local_account_id, target_profile_id, created_at)
         VALUES (?, ?, datetime('now'));`,
        { bind: [localAccountId, profileId] },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [] }
}

// ================================================================
// ローカルアカウント登録
// ================================================================

export function handleEnsureLocalAccount(
  db: DbExec,
  backendUrl: string,
  accountJson: string,
): HandlerResult {
  const account = JSON.parse(accountJson) as Entity.Account
  const serverId = ensureServer(db, backendUrl)
  const profileId = ensureProfile(db, account)
  ensureProfileAlias(db, profileId, serverId, account.id)
  if (account.emojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, account.emojis)
  }
  db.exec(
    `INSERT INTO local_accounts (server_id, profile_id, last_authenticated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(server_id, profile_id) DO UPDATE SET
       last_authenticated_at = datetime('now');`,
    { bind: [serverId, profileId] },
  )
  return { changedTables: [] }
}

// ================================================================
// カスタム絵文字カタログの一括登録
// ================================================================

export function handleBulkUpsertCustomEmojis(
  db: DbExec,
  backendUrl: string,
  emojisJson: string,
): HandlerResult {
  const emojis = JSON.parse(emojisJson) as {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[]
  if (emojis.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    for (const emoji of emojis) {
      ensureCustomEmoji(db, serverId, emoji)
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [] }
}

// ================================================================
// リアクション保存
// ================================================================

export function handleToggleReaction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  value: boolean,
  emoji: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  const isCustom = emoji.startsWith(':') && emoji.endsWith(':')

  let emojiId: number | null = null
  let emojiText: string | null = null

  if (isCustom) {
    // カスタム絵文字: shortcode から custom_emojis を検索
    const shortcode = emoji.slice(1, -1)
    const serverId = ensureServer(db, backendUrl)
    const rows = db.exec(
      'SELECT emoji_id FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
      { bind: [serverId, shortcode], returnValue: 'resultRows' },
    ) as number[][]
    if (rows.length > 0) {
      emojiId = rows[0][0]
    } else {
      // custom_emojis に見つからない場合は shortcode を emoji_text に保存
      emojiText = shortcode
    }
  } else {
    // Unicode 絵文字
    emojiText = emoji
  }

  toggleReaction(db, localAccountId, postId, value, emojiId, emojiText)

  return { changedTables: ['posts'] }
}
