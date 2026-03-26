/**
 * Worker / メインスレッド共有の純粋関数
 *
 * DB アクセス不要な純粋関数をここに配置し、
 * Worker 側とメインスレッド側の両方から import できるようにする。
 */

import type { Entity } from 'megalodon'

// ================================================================
// セッション中不変のマスターデータキャッシュ
// Worker / メインスレッド両方で使用。一度 DB から取得した値を保持する。
// ================================================================

const channelKindCache = new Map<string, number>()
const serverCache = new Map<string, number>()
const timelineCache = new Map<string, number>()
const localAccountCache = new Map<string, number | null>()
const profileIdCache = new Map<string, number>()
const customEmojiIdCache = new Map<string, number>()

/**
 * compositeKey を生成する
 *
 * @deprecated v7 以降は post_id (INTEGER PK) を使用。Dexie 互換用に残す。
 */
export function createCompositeKey(backendUrl: string, id: string): string {
  return `${backendUrl}:${id}`
}

/**
 * posts_backends から post_id を解決する
 *
 * backendUrl + localId から post_id を逆引きする。
 * 見つからない場合は null を返す。
 */
export function resolvePostId(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  backendUrl: string,
  localId: string,
): number | null {
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * Entity.Status から正規化カラムの値を抽出する
 */
export function extractStatusColumns(status: Entity.Status) {
  return {
    canonical_url: status.url ?? null,
    content_html: status.content ?? null,
    edited_at: status.edited_at ?? null,
    has_media: status.media_attachments.length > 0 ? 1 : 0,
    has_spoiler: (status.spoiler_text ?? '') !== '' ? 1 : 0,
    in_reply_to_id: status.in_reply_to_id ?? null,
    is_reblog: status.reblog != null ? 1 : 0,
    is_sensitive: status.sensitive ? 1 : 0,
    language: status.language ?? null,
    media_count: status.media_attachments.length,
    reblog_of_uri: status.reblog?.uri ?? null,
    spoiler_text: status.spoiler_text ?? null,
    uri: status.uri,
    visibility: status.visibility,
  }
}

// ================================================================
// エンゲージメント操作ヘルパー（Worker 共通）
// ================================================================

type DbExecCompat = {
  exec: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => unknown
}

/** action コード ('favourited' → 'favourite' 等) をエンゲージメントコードに変換 */
export const ACTION_TO_ENGAGEMENT: Record<string, string> = {
  bookmarked: 'bookmark',
  favourited: 'favourite',
  reblogged: 'reblog',
}

export function resolveLocalAccountId(
  db: DbExecCompat,
  backendUrl: string,
): number | null {
  const cached = localAccountCache.get(backendUrl)
  if (cached !== undefined) return cached

  const rows = db.exec(
    `SELECT la.local_account_id
     FROM local_accounts la
     INNER JOIN servers sv ON la.server_id = sv.server_id
     WHERE sv.base_url = ?
     LIMIT 1;`,
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  localAccountCache.set(backendUrl, result)
  return result
}

/**
 * channel_kind_id を code から解決する
 */
export function resolveChannelKindId(
  db: DbExecCompat,
  code: string,
): number | null {
  const cached = channelKindCache.get(code)
  if (cached !== undefined) return cached

  const rows = db.exec(
    'SELECT channel_kind_id FROM channel_kinds WHERE code = ?;',
    { bind: [code], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  // null 結果はキャッシュしない（コードが不正な場合）
  if (result !== null) channelKindCache.set(code, result)
  return result
}

/**
 * timeline_item_kinds の 'post' の ID を解決する
 */
export function resolvePostItemKindId(db: DbExecCompat): number {
  const rows = db.exec(
    "SELECT timeline_item_kind_id FROM timeline_item_kinds WHERE code = 'post';",
    { returnValue: 'resultRows' },
  ) as number[][]
  return rows[0][0]
}

/**
 * 指定条件の timeline_id を返す。未登録の場合は timelines テーブルに INSERT してから返す。
 */
export function ensureTimeline(
  db: DbExecCompat,
  serverId: number,
  channelKindCode: string,
  tag?: string | null,
): number {
  const cacheKey = `${serverId}\0${channelKindCode}\0${tag ?? ''}`
  const cached = timelineCache.get(cacheKey)
  if (cached !== undefined) return cached

  const channelKindId = resolveChannelKindId(db, channelKindCode)
  if (channelKindId === null) {
    throw new Error(`Unknown channel_kind code: ${channelKindCode}`)
  }

  const tagValue = tag ?? null

  // COALESCE(tag, '') でユニーク制約に合わせて検索
  const existing = db.exec(
    `SELECT timeline_id FROM timelines
     WHERE server_id = ? AND channel_kind_id = ? AND COALESCE(tag, '') = ?;`,
    {
      bind: [serverId, channelKindId, tagValue ?? ''],
      returnValue: 'resultRows',
    },
  ) as number[][]

  if (existing.length > 0) {
    timelineCache.set(cacheKey, existing[0][0])
    return existing[0][0]
  }

  db.exec(
    `INSERT INTO timelines (server_id, channel_kind_id, tag, created_at)
     VALUES (?, ?, ?, datetime('now'));`,
    { bind: [serverId, channelKindId, tagValue] },
  )

  const rows = db.exec(
    `SELECT timeline_id FROM timelines
     WHERE server_id = ? AND channel_kind_id = ? AND COALESCE(tag, '') = ?;`,
    {
      bind: [serverId, channelKindId, tagValue ?? ''],
      returnValue: 'resultRows',
    },
  ) as number[][]

  timelineCache.set(cacheKey, rows[0][0])
  return rows[0][0]
}

export function toggleEngagement(
  db: DbExecCompat,
  localAccountId: number,
  postId: number,
  engagementCode: string,
  value: boolean,
): void {
  if (value) {
    db.exec(
      `INSERT OR IGNORE INTO post_engagements (
        local_account_id, post_id, engagement_type_id, created_at
      ) VALUES (
        ?, ?,
        (SELECT engagement_type_id FROM engagement_types WHERE code = ?),
        datetime('now')
      );`,
      { bind: [localAccountId, postId, engagementCode] },
    )
  } else {
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ?
         AND engagement_type_id = (SELECT engagement_type_id FROM engagement_types WHERE code = ?)
         AND emoji_id IS NULL;`,
      { bind: [localAccountId, postId, engagementCode] },
    )
  }
}

/**
 * リアクションのトグル。
 * 「投稿に1件」: 既存リアクションがあれば置き換え、なければ追加。
 */
export function toggleReaction(
  db: DbExecCompat,
  localAccountId: number,
  postId: number,
  value: boolean,
  emojiId: number | null,
  emojiText: string | null,
): void {
  const reactionTypeId = (
    db.exec(
      "SELECT engagement_type_id FROM engagement_types WHERE code = 'reaction';",
      { returnValue: 'resultRows' },
    ) as number[][]
  )[0][0]

  if (value) {
    // 既存のリアクションを削除してから新しいものを挿入（投稿に1件の制約）
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ? AND engagement_type_id = ?;`,
      { bind: [localAccountId, postId, reactionTypeId] },
    )
    db.exec(
      `INSERT INTO post_engagements (
        local_account_id, post_id, engagement_type_id, emoji_id, emoji_text, created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'));`,
      { bind: [localAccountId, postId, reactionTypeId, emojiId, emojiText] },
    )
  } else {
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ? AND engagement_type_id = ?;`,
      { bind: [localAccountId, postId, reactionTypeId] },
    )
  }
}

/**
 * backendUrl に対応する server_id を返す。
 * 未登録の場合は servers テーブルに INSERT してから返す。
 */
export function ensureServer(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  backendUrl: string,
): number {
  const cached = serverCache.get(backendUrl)
  if (cached !== undefined) return cached

  const host = new URL(backendUrl).host

  db.exec('INSERT OR IGNORE INTO servers (host, base_url) VALUES (?, ?);', {
    bind: [host, backendUrl],
  })

  const rows = db.exec('SELECT server_id FROM servers WHERE base_url = ?;', {
    bind: [backendUrl],
    returnValue: 'resultRows',
  }) as number[][]

  serverCache.set(backendUrl, rows[0][0])
  return rows[0][0]
}

/**
 * account に対応する profile_id を返す。
 * 未登録の場合は profiles テーブルに INSERT し、既存の場合は表示名等を更新する。
 */
export function ensureProfile(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  account: Entity.Account,
): number {
  const actorUri = account.url
  const acct = account.acct
  const domain = acct.includes('@') ? acct.split('@')[1] : null

  // UPSERT は常に実行（display_name 等の更新のため）
  db.exec(
    `INSERT INTO profiles (
      actor_uri, acct, username, domain, display_name,
      avatar_url, header_url, locked, bot, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(actor_uri) DO UPDATE SET
      display_name = excluded.display_name,
      avatar_url   = excluded.avatar_url,
      header_url   = excluded.header_url,
      locked       = excluded.locked,
      bot          = excluded.bot,
      updated_at   = excluded.updated_at;`,
    {
      bind: [
        actorUri,
        acct,
        account.username,
        domain,
        account.display_name ?? null,
        account.avatar ?? null,
        account.header ?? null,
        account.locked ? 1 : 0,
        account.bot ? 1 : 0,
      ],
    },
  )

  // キャッシュヒット時は SELECT をスキップ
  const cached = profileIdCache.get(actorUri)
  if (cached !== undefined) return cached

  const rows = db.exec('SELECT profile_id FROM profiles WHERE actor_uri = ?;', {
    bind: [actorUri],
    returnValue: 'resultRows',
  }) as number[][]

  profileIdCache.set(actorUri, rows[0][0])
  return rows[0][0]
}

/**
 * profile_aliases テーブルにリモートアカウント ID のマッピングを UPSERT する。
 *
 * Mastodon / Pleroma 等の API では、アカウント ID はサーバーごとに異なる。
 * この関数で (server_id, remote_account_id) → profile_id のマッピングを記録し、
 * 読み取りクエリ時にバックエンド固有のアカウント ID を復元できるようにする。
 */
export function ensureProfileAlias(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  profileId: number,
  serverId: number,
  remoteAccountId: string,
): void {
  if (!remoteAccountId) return
  db.exec(
    `INSERT INTO profile_aliases (server_id, remote_account_id, profile_id, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(server_id, remote_account_id) DO UPDATE SET
       profile_id = excluded.profile_id,
       fetched_at = excluded.fetched_at;`,
    { bind: [serverId, remoteAccountId, profileId] },
  )
}

/**
 * カスタム絵文字を custom_emojis に UPSERT し、emoji_id を返す。
 */
export function ensureCustomEmoji(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  serverId: number,
  emoji: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  },
): number {
  const cacheKey = `${serverId}\0${emoji.shortcode}`

  // UPSERT は常に実行（image_url 等の更新のため）
  db.exec(
    `INSERT INTO custom_emojis (server_id, shortcode, image_url, static_url, visible_in_picker)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id, shortcode) DO UPDATE SET
       image_url  = excluded.image_url,
       static_url = excluded.static_url;`,
    {
      bind: [
        serverId,
        emoji.shortcode,
        emoji.url,
        emoji.static_url ?? null,
        emoji.visible_in_picker === false ? 0 : 1,
      ],
    },
  )

  // キャッシュヒット時は SELECT をスキップ
  const cached = customEmojiIdCache.get(cacheKey)
  if (cached !== undefined) return cached

  const emojiRows = db.exec(
    'SELECT emoji_id FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
    { bind: [serverId, emoji.shortcode], returnValue: 'resultRows' },
  ) as number[][]

  customEmojiIdCache.set(cacheKey, emojiRows[0][0])
  return emojiRows[0][0]
}

/**
 * 投稿のカスタム絵文字を post_custom_emojis に同期する。
 */
export function syncPostCustomEmojis(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  serverId: number,
  statusEmojis: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[],
  accountEmojis: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[],
): void {
  db.exec('DELETE FROM post_custom_emojis WHERE post_id = ?;', {
    bind: [postId],
  })

  for (const emoji of statusEmojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji)
    db.exec(
      `INSERT OR IGNORE INTO post_custom_emojis (post_id, emoji_id, usage_context)
       VALUES (?, ?, 'status');`,
      { bind: [postId, emojiId] },
    )
  }

  for (const emoji of accountEmojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji)
    db.exec(
      `INSERT OR IGNORE INTO post_custom_emojis (post_id, emoji_id, usage_context)
       VALUES (?, ?, 'account');`,
      { bind: [postId, emojiId] },
    )
  }
}

/**
 * プロフィールのカスタム絵文字を profile_custom_emojis に同期する。
 */
export function syncProfileCustomEmojis(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  profileId: number,
  serverId: number,
  emojis: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[],
): void {
  db.exec('DELETE FROM profile_custom_emojis WHERE profile_id = ?;', {
    bind: [profileId],
  })

  for (const emoji of emojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji)
    db.exec(
      `INSERT OR IGNORE INTO profile_custom_emojis (profile_id, emoji_id)
       VALUES (?, ?);`,
      { bind: [profileId, emojiId] },
    )
  }
}

// ================================================================
// 絵文字フォールバック解決（Misskey ストリーミング対応）
// ================================================================

/** :shortcode: または :shortcode@host: パターンを抽出する正規表現 */
const CUSTOM_EMOJI_RE = /:([a-zA-Z0-9_]+)(?:@[\w.-]+)?:/g

/**
 * テキスト中の :shortcode: パターンから DB 上のカスタム絵文字を解決する。
 *
 * Misskey 系ストリーミングで note.emojis が空の場合のフォールバックとして使用。
 * DB にヒットしなかった shortcode は Misskey URL パターン
 * (`${backendUrl}/emoji/${shortcode}.webp`) で推定する。
 */
export function resolveEmojisFromDb(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  serverId: number,
  text: string | null | undefined,
  backendUrl: string,
): {
  shortcode: string
  url: string
  static_url: string | null
  visible_in_picker: boolean
}[] {
  if (!text) return []

  const matches = [...text.matchAll(CUSTOM_EMOJI_RE)]
  const shortcodes = [...new Set(matches.map((m) => m[1]))]
  if (shortcodes.length === 0) return []

  const result: {
    shortcode: string
    url: string
    static_url: string | null
    visible_in_picker: boolean
  }[] = []

  for (const shortcode of shortcodes) {
    // DB から検索（custom_emojis テーブル）
    const rows = db.exec(
      'SELECT image_url, static_url, visible_in_picker FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
      { bind: [serverId, shortcode], returnValue: 'resultRows' },
    ) as (string | number | null)[][]

    if (rows.length > 0) {
      result.push({
        shortcode,
        static_url: rows[0][1] as string | null,
        url: rows[0][0] as string,
        visible_in_picker: rows[0][2] === 1,
      })
    } else {
      // Misskey URL パターンでフォールバック
      const fallbackUrl = `${backendUrl}/emoji/${encodeURIComponent(shortcode)}.webp`
      result.push({
        shortcode,
        static_url: fallbackUrl,
        url: fallbackUrl,
        visible_in_picker: true,
      })
    }
  }

  return result
}

/**
 * 投稿のハッシュタグを hashtags / post_hashtags に同期する。
 *
 * hashtags テーブルに正規化名（小文字）で UPSERT し、
 * post_hashtags テーブルを洗い替え（DELETE → INSERT）する。
 */
export function syncPostHashtags(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  tags: { name: string; url?: string }[],
): void {
  db.exec('DELETE FROM post_hashtags WHERE post_id = ?;', {
    bind: [postId],
  })

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]
    const normalizedName = tag.name.toLowerCase()
    const displayName = tag.name

    // hashtags テーブルに UPSERT（display_name は最新の表記で更新）
    db.exec(
      `INSERT INTO hashtags (normalized_name, display_name)
       VALUES (?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         display_name = excluded.display_name;`,
      { bind: [normalizedName, displayName] },
    )

    // hashtag_id を取得
    const rows = db.exec(
      'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
      { bind: [normalizedName], returnValue: 'resultRows' },
    ) as number[][]
    const hashtagId = rows[0][0]

    // post_hashtags に INSERT
    db.exec(
      `INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id, sort_order)
       VALUES (?, ?, ?);`,
      { bind: [postId, hashtagId, i] },
    )
  }
}

/**
 * 投稿のリンクカードを link_cards / post_links に同期する。
 *
 * link_cards テーブルに canonical_url で UPSERT し、
 * post_links テーブルを洗い替え（DELETE → INSERT）する。
 * card が null の場合は post_links のみ削除する。
 */
export function syncPostLinkCard(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  card: {
    url: string
    title: string
    description: string
    image: string | null
    provider_name: string | null
  } | null,
): void {
  db.exec('DELETE FROM post_links WHERE post_id = ?;', {
    bind: [postId],
  })

  if (!card || !card.url) return

  // link_cards テーブルに UPSERT（title / description / image は最新で更新）
  db.exec(
    `INSERT INTO link_cards (canonical_url, title, description, image_url, provider_name, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(canonical_url) DO UPDATE SET
       title         = excluded.title,
       description   = excluded.description,
       image_url     = excluded.image_url,
       provider_name = excluded.provider_name,
       fetched_at    = excluded.fetched_at;`,
    {
      bind: [
        card.url,
        card.title ?? null,
        card.description ?? null,
        card.image ?? null,
        card.provider_name ?? null,
      ],
    },
  )

  // link_card_id を取得
  const rows = db.exec(
    'SELECT link_card_id FROM link_cards WHERE canonical_url = ?;',
    { bind: [card.url], returnValue: 'resultRows' },
  ) as number[][]
  const linkCardId = rows[0][0]

  // post_links に INSERT
  db.exec(
    `INSERT OR IGNORE INTO post_links (post_id, link_card_id, url_in_post, sort_order)
     VALUES (?, ?, ?, 0);`,
    { bind: [postId, linkCardId, card.url] },
  )
}

/**
 * 投稿の投票データを polls / poll_options に同期する。
 */
export function syncPollData(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  poll: {
    expires_at: string | null
    multiple: boolean
    votes_count: number
    options: { title: string; votes_count: number | null }[]
    voted: boolean
  } | null,
): void {
  if (!poll) {
    db.exec('DELETE FROM polls WHERE post_id = ?;', { bind: [postId] })
    return
  }

  db.exec(
    `INSERT INTO polls (post_id, expires_at, multiple, votes_count, voters_count)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(post_id) DO UPDATE SET
       expires_at   = excluded.expires_at,
       multiple     = excluded.multiple,
       votes_count  = excluded.votes_count;`,
    {
      bind: [postId, poll.expires_at, poll.multiple ? 1 : 0, poll.votes_count],
    },
  )

  const pollRows = db.exec('SELECT poll_id FROM polls WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]
  const pollId = pollRows[0][0]

  db.exec('DELETE FROM poll_options WHERE poll_id = ?;', { bind: [pollId] })
  for (let i = 0; i < poll.options.length; i++) {
    const opt = poll.options[i]
    db.exec(
      `INSERT INTO poll_options (poll_id, option_index, title, votes_count)
       VALUES (?, ?, ?, ?);`,
      { bind: [pollId, i, opt.title, opt.votes_count] },
    )
  }
}
