/**
 * 投稿データの同期処理ヘルパー群
 *
 * 新スキーマ (v2) 対応版:
 *   - posts_mentions → post_mentions (username, url 追加)
 *   - post_media: remote_media_id → media_local_id, duration_ms/is_sensitive 削除, width/height 追加
 *   - post_stats: fetched_at/reactions_count/quotes_count 削除, updated_at 追加
 *   - posts_backends → post_backend_ids
 *   - resolveDelayedReplyReferences / resolveDelayedRepostReferences 削除
 *   - ensureProfileAlias 削除
 *   - toggleEngagement → updateInteraction
 *   - extractStatusColumns → extractPostColumns
 *   - ensureServer(db, host) / ensureProfile(db, account, serverId)
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  extractPostColumns,
  lastChangeCount,
  resolveEmojisFromDb,
  syncLinkCard,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncProfileCustomEmojis,
  updateInteraction,
} from '../../helpers'
import {
  deriveAccountDomain,
  getLastInsertRowId,
  resolveMediaTypeId,
  resolvePostIdInternal,
  resolveRepostOfPostId,
  resolveVisibilityId,
} from './statusHelpers'
import type { DbExec, WrittenTableCollector } from './types'

const STALE_INTERACTION_FALSE_PROTECTION_MS = 60_000

// ================================================================
// メンション同期
// ================================================================

export function upsertMentionsInternal(
  db: DbExec,
  postId: number,
  mentions: Entity.Mention[],
  collector?: WrittenTableCollector,
): void {
  const expectedByAcct = new Map<
    string,
    [string, string | null, number | null]
  >()
  for (const mention of mentions) {
    // profile_id を acct で profiles テーブルから検索
    let profileId: number | null = null
    if (mention.acct) {
      const profileRows = db.exec(
        'SELECT id FROM profiles WHERE acct = ? LIMIT 1;',
        { bind: [mention.acct], returnValue: 'resultRows' },
      ) as number[][]
      if (profileRows.length > 0) {
        profileId = profileRows[0][0]
      }
    }
    expectedByAcct.set(mention.acct, [mention.username, mention.url, profileId])
  }
  const currentRows = db.exec(
    'SELECT acct, username, url, profile_id FROM post_mentions WHERE post_id = ? ORDER BY acct;',
    { bind: [postId], returnValue: 'resultRows' },
  ) as (string | number | null)[][]
  const expectedRows = [...expectedByAcct.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([acct, [username, url, profileId]]) => [
      acct,
      username,
      url,
      profileId,
    ])
  const identical =
    currentRows.length === expectedRows.length &&
    currentRows.every(
      (row, i) =>
        row[0] === expectedRows[i][0] &&
        row[1] === expectedRows[i][1] &&
        row[2] === expectedRows[i][2] &&
        (expectedRows[i][3] === null || row[3] === expectedRows[i][3]),
    )
  if (identical) return

  const keepAccts: string[] = []
  let changed = false

  for (const mention of mentions) {
    const profileId = expectedByAcct.get(mention.acct)?.[2] ?? null

    db.exec(
      `INSERT INTO post_mentions (post_id, acct, username, url, profile_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(post_id, acct) DO UPDATE SET
         username   = excluded.username,
         url        = excluded.url,
         profile_id = COALESCE(excluded.profile_id, post_mentions.profile_id)
       WHERE post_mentions.username   IS NOT excluded.username
          OR post_mentions.url        IS NOT excluded.url
          OR post_mentions.profile_id IS NOT COALESCE(excluded.profile_id, post_mentions.profile_id);`,
      {
        bind: [postId, mention.acct, mention.username, mention.url, profileId],
      },
    )
    if (lastChangeCount(db) > 0) changed = true
    keepAccts.push(mention.acct)
  }

  // Remove stale mentions
  if (keepAccts.length === 0) {
    db.exec('DELETE FROM post_mentions WHERE post_id = ?;', {
      bind: [postId],
    })
  } else {
    const ph = keepAccts.map(() => '?').join(',')
    db.exec(
      `DELETE FROM post_mentions WHERE post_id = ? AND acct NOT IN (${ph});`,
      { bind: [postId, ...keepAccts] },
    )
  }
  if (lastChangeCount(db) > 0) changed = true
  if (changed) collector?.add('post_mentions')
}

export function syncPostMedia(
  db: DbExec,
  postId: number,
  mediaAttachments: Entity.Attachment[],
  collector?: WrittenTableCollector,
): void {
  const currentRows = db.exec(
    `SELECT sort_order, media_type_id, url, width, height, remote_url,
            preview_url, description, blurhash, media_local_id
     FROM post_media WHERE post_id = ? ORDER BY sort_order;`,
    { bind: [postId], returnValue: 'resultRows' },
  ) as (string | number | null)[][]

  const expectedRows = mediaAttachments.map((media, i) => {
    const meta = media.meta as
      | { original?: { width?: number; height?: number } }
      | null
      | undefined
    return [
      i,
      resolveMediaTypeId(db, media.type),
      media.url,
      meta?.original?.width ?? null,
      meta?.original?.height ?? null,
      media.remote_url ?? null,
      media.preview_url ?? null,
      media.description ?? null,
      media.blurhash ?? null,
      media.id ?? null,
    ]
  })
  const identical =
    currentRows.length === expectedRows.length &&
    currentRows.every((row, i) => row.every((v, j) => v === expectedRows[i][j]))
  if (identical) return

  // DELETE + INSERT 方式
  db.exec('DELETE FROM post_media WHERE post_id = ?;', {
    bind: [postId],
  })
  collector?.add('post_media')

  if (mediaAttachments.length === 0) return

  // multi-value INSERT で一括挿入
  const placeholders: string[] = []
  const binds: (string | number | null)[] = []

  for (let i = 0; i < mediaAttachments.length; i++) {
    const media = mediaAttachments[i]
    const mediaTypeId = resolveMediaTypeId(db, media.type)

    const meta = media.meta as
      | { original?: { width?: number; height?: number } }
      | null
      | undefined
    const width = meta?.original?.width ?? null
    const height = meta?.original?.height ?? null

    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    binds.push(
      postId,
      i,
      mediaTypeId,
      media.url,
      width,
      height,
      media.remote_url ?? null,
      media.preview_url ?? null,
      media.description ?? null,
      media.blurhash ?? null,
      media.id ?? null,
    )
  }

  db.exec(
    `INSERT INTO post_media (
      post_id, sort_order, media_type_id, url,
      width, height, remote_url, preview_url,
      description, blurhash, media_local_id
    ) VALUES ${placeholders.join(',')};`,
    { bind: binds },
  )
}

// ================================================================
// 投稿統計同期
// ================================================================

export function syncPostStats(
  db: DbExec,
  postId: number,
  status: Entity.Status,
  collector?: WrittenTableCollector,
  now?: number,
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
      : '[]'

  const nowTs = now ?? Date.now()

  db.exec(
    `INSERT INTO post_stats (
      post_id, replies_count, reblogs_count, favourites_count, emoji_reactions_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      replies_count        = excluded.replies_count,
      reblogs_count        = excluded.reblogs_count,
      favourites_count     = excluded.favourites_count,
      emoji_reactions_json = excluded.emoji_reactions_json,
      updated_at           = excluded.updated_at
    WHERE post_stats.replies_count        IS NOT excluded.replies_count
       OR post_stats.reblogs_count        IS NOT excluded.reblogs_count
       OR post_stats.favourites_count     IS NOT excluded.favourites_count
       OR post_stats.emoji_reactions_json IS NOT excluded.emoji_reactions_json
       OR post_stats.updated_at           IS NOT excluded.updated_at;`,
    {
      bind: [
        postId,
        status.replies_count,
        status.reblogs_count,
        status.favourites_count,
        emojiReactionsJson,
        nowTs,
      ],
    },
  )
  if (lastChangeCount(db) > 0) collector?.add('post_stats')
}

// ================================================================
// リブログ元投稿の保存ヘルパー
// ================================================================

type PostColumns = ReturnType<typeof extractPostColumns>

type ReblogOriginalPostRowInput = {
  cols: PostColumns
  existingPostId: number | undefined
  normalizedUri: string
  now: number
  profileId: number
  repostOfPostId: number | null
  serverId: number
  visibilityId: number | null
}

function syncReblogOriginalProfileEmojis(
  db: DbExec,
  originalStatus: Entity.Status,
  profileId: number,
  serverId: number,
  accountDomain: string,
  collector?: WrittenTableCollector,
): void {
  const accountEmojis =
    originalStatus.account.emojis.length > 0
      ? originalStatus.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.account.display_name,
          accountDomain,
        )
  if (accountEmojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, accountEmojis, collector)
  }
}

function resolveReblogOriginalPostId(
  db: DbExec,
  normalizedUri: string,
  localAccountId: number | null,
  remotePostId: string,
): number | undefined {
  const existingRows = db.exec(
    "SELECT id, is_reblog FROM posts WHERE object_uri = ? AND object_uri != '';",
    { bind: [normalizedUri], returnValue: 'resultRows' },
  ) as number[][]
  if (existingRows.length > 0 && existingRows[0][1] === 0) {
    return existingRows[0][0]
  }

  if (localAccountId !== null) {
    return resolvePostIdInternal(db, localAccountId, remotePostId) ?? undefined
  }
  return undefined
}

function upsertReblogOriginalPostRow(
  db: DbExec,
  {
    cols,
    existingPostId,
    normalizedUri,
    now,
    profileId,
    repostOfPostId,
    serverId,
    visibilityId,
  }: ReblogOriginalPostRowInput,
): number {
  if (existingPostId !== undefined) {
    // author_profile_id は更新しない（handleUpsertStatus と同一方針）
    const setValues = [
      now,
      visibilityId ?? cols.visibility_id,
      cols.language,
      cols.content_html,
      cols.spoiler_text,
      cols.canonical_url,
      0,
      cols.is_sensitive,
      cols.in_reply_to_uri,
      cols.in_reply_to_account_acct,
      cols.edited_at_ms,
      cols.plain_content,
      cols.quote_state,
      cols.is_local_only,
      cols.application_name,
      repostOfPostId,
      null, // quote_of_post_id: 将来拡張用
    ]
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
      WHERE id = ? AND (
        last_fetched_at        IS NOT ? OR
        visibility_id          IS NOT ? OR
        language               IS NOT ? OR
        content_html           IS NOT ? OR
        spoiler_text           IS NOT ? OR
        canonical_url          IS NOT ? OR
        is_reblog              IS NOT ? OR
        is_sensitive           IS NOT ? OR
        in_reply_to_uri        IS NOT ? OR
        in_reply_to_account_acct IS NOT ? OR
        edited_at_ms           IS NOT ? OR
        plain_content          IS NOT ? OR
        quote_state            IS NOT ? OR
        is_local_only          IS NOT ? OR
        application_name       IS NOT ? OR
        reblog_of_post_id      IS NOT ? OR
        quote_of_post_id       IS NOT ?
      );`,
      {
        bind: [
          ...(setValues as (string | number | null)[]),
          existingPostId,
          ...(setValues as (string | number | null)[]),
        ],
      },
    )
    return existingPostId
  }

  db.exec(
    `INSERT INTO posts (
      object_uri, origin_server_id, created_at_ms, last_fetched_at,
      author_profile_id, visibility_id, language,
      content_html, spoiler_text, canonical_url,
      is_reblog, is_sensitive,
      in_reply_to_uri, in_reply_to_account_acct,
      is_local_only, edited_at_ms,
      plain_content, quote_state, application_name,
      reblog_of_post_id, quote_of_post_id
    ) VALUES (?,?,?,?, ?,?,?, ?,?,?, 0,?, ?,?, ?,?, ?,?,?, ?,?);`,
    {
      bind: [
        normalizedUri,
        serverId,
        cols.created_at_ms,
        now,
        profileId,
        visibilityId ?? cols.visibility_id,
        cols.language,
        cols.content_html,
        cols.spoiler_text,
        cols.canonical_url,
        cols.is_sensitive,
        cols.in_reply_to_uri,
        cols.in_reply_to_account_acct,
        cols.is_local_only,
        cols.edited_at_ms,
        cols.plain_content,
        cols.quote_state,
        cols.application_name,
        repostOfPostId,
        null, // quote_of_post_id
      ],
    },
  )
  return getLastInsertRowId(db)
}

function registerReblogOriginalBackendId(
  db: DbExec,
  postId: number,
  localAccountId: number | null,
  remotePostId: string,
  serverId: number,
  collector?: WrittenTableCollector,
): void {
  if (localAccountId === null) return

  db.exec(
    `INSERT OR IGNORE INTO post_backend_ids (post_id, local_account_id, local_id, server_id)
     VALUES (?, ?, ?, ?);`,
    { bind: [postId, localAccountId, remotePostId, serverId] },
  )
  if (lastChangeCount(db) > 0) collector?.add('post_backend_ids')
}

function syncReblogOriginalRelatedData(
  db: DbExec,
  postId: number,
  originalStatus: Entity.Status,
  serverId: number,
  accountDomain: string,
  collector?: WrittenTableCollector,
  now?: number,
): void {
  upsertMentionsInternal(db, postId, originalStatus.mentions, collector)
  syncPostMedia(db, postId, originalStatus.media_attachments, collector)
  syncPostStats(db, postId, originalStatus, collector, now)

  const resolvedStatusEmojis =
    originalStatus.emojis?.length > 0
      ? originalStatus.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.plain_content ?? null,
          accountDomain,
        )
  const resolvedAccountEmojis =
    originalStatus.account?.emojis?.length > 0
      ? originalStatus.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          originalStatus.account?.display_name ?? null,
          accountDomain,
        )
  syncPostCustomEmojis(
    db,
    postId,
    serverId,
    [...resolvedStatusEmojis, ...resolvedAccountEmojis],
    collector,
  )
  syncPostHashtags(db, postId, originalStatus.tags, collector)
  syncPollData(db, postId, originalStatus.poll, collector)
  syncLinkCard(db, postId, originalStatus.card, collector)
}

/** サーバーから返されたフラグをDBに反映する。 */
function syncReblogOriginalInteractions(
  db: DbExec,
  postId: number,
  localAccountId: number | null,
  originalStatus: Entity.Status,
  collector?: WrittenTableCollector,
  now?: number,
): void {
  if (localAccountId === null) return

  if (originalStatus.favourited === true) {
    updateInteraction(
      db,
      postId,
      localAccountId,
      'favourite',
      true,
      collector,
      {
        now,
      },
    )
  } else if (originalStatus.favourited === false) {
    updateInteraction(
      db,
      postId,
      localAccountId,
      'favourite',
      false,
      collector,
      {
        now,
        preserveRecentLocalTrueMs: STALE_INTERACTION_FALSE_PROTECTION_MS,
      },
    )
  }
  if (originalStatus.reblogged === true) {
    updateInteraction(db, postId, localAccountId, 'reblog', true, collector, {
      now,
    })
  } else if (originalStatus.reblogged === false) {
    updateInteraction(db, postId, localAccountId, 'reblog', false, collector, {
      now,
      preserveRecentLocalTrueMs: STALE_INTERACTION_FALSE_PROTECTION_MS,
    })
  }
  if (originalStatus.bookmarked === true) {
    updateInteraction(db, postId, localAccountId, 'bookmark', true, collector, {
      now,
    })
  } else if (originalStatus.bookmarked === false) {
    updateInteraction(
      db,
      postId,
      localAccountId,
      'bookmark',
      false,
      collector,
      {
        now,
        preserveRecentLocalTrueMs: STALE_INTERACTION_FALSE_PROTECTION_MS,
      },
    )
  }
}

/**
 * リブログ元投稿（status.reblog）を posts テーブルに保存する。
 * タイムラインへの紐付けは行わない（元投稿は直接タイムラインに属さないため）。
 */
export function ensureReblogOriginalPost(
  db: DbExec,
  originalStatus: Entity.Status,
  serverId: number,
  now: number,
  localAccountId: number | null,
  collector?: WrittenTableCollector,
  skipProfileUpdate?: boolean,
): void {
  const normalizedUri = originalStatus.uri?.trim() || ''
  if (!normalizedUri) return

  const cols = extractPostColumns(originalStatus)
  const accountDomain = deriveAccountDomain(originalStatus.account)
  const profileId = ensureProfile(
    db,
    originalStatus.account,
    serverId,
    collector,
    skipProfileUpdate,
    now,
  )
  if (!skipProfileUpdate) {
    syncReblogOriginalProfileEmojis(
      db,
      originalStatus,
      profileId,
      serverId,
      accountDomain,
      collector,
    )
  }

  const visibilityId = resolveVisibilityId(db, cols.visibility_id.toString())
  const repostOfPostId = resolveRepostOfPostId(
    db,
    ((originalStatus as Record<string, unknown>).reblog_of_uri as
      | string
      | null) ?? null,
  )
  const postId = upsertReblogOriginalPostRow(db, {
    cols,
    existingPostId: resolveReblogOriginalPostId(
      db,
      normalizedUri,
      localAccountId,
      originalStatus.id,
    ),
    normalizedUri,
    now,
    profileId,
    repostOfPostId,
    serverId,
    visibilityId,
  })
  if (lastChangeCount(db) > 0) collector?.add('posts')

  registerReblogOriginalBackendId(
    db,
    postId,
    localAccountId,
    originalStatus.id,
    serverId,
    collector,
  )
  syncReblogOriginalRelatedData(
    db,
    postId,
    originalStatus,
    serverId,
    accountDomain,
    collector,
    now,
  )
  syncReblogOriginalInteractions(
    db,
    postId,
    localAccountId,
    originalStatus,
    collector,
    now,
  )
}
