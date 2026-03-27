/**
 * Status の型定義とマッピング関数
 *
 * DB の行データを SqliteStoredStatus に変換するロジックを集約する。
 *
 * 新スキーマ対応:
 * - stored_at, reblog_of_uri 廃止 → row インデックス全面更新
 * - edited_at TEXT → edited_at_ms INTEGER（ms → ISO 文字列変換）
 * - visibility_types.code → .name
 * - servers.base_url → local_accounts.backend_url
 * - profile_aliases 廃止 → account.id は空文字列
 * - post_engagements CSV → post_interactions boolean フラグ（batch 側）
 * - statusEmojisMap + accountEmojisMap → customEmojisMap（batch 側）
 * - mentions に username, url 追加
 * - polls に voted, own_votes, expired 追加（batch 側）
 * - storedAt プロパティ削除
 */

import type { Entity } from 'megalodon'
import type { BatchMaps } from './statusBatch'

/** タイムラインの種類（DB層用。notification は notifications テーブルで管理するため含めない） */
export type TimelineType = 'home' | 'local' | 'public' | 'tag'

export interface SqliteStoredStatus extends Entity.Status {
  post_id: number
  backendUrl: string
  timelineTypes: TimelineType[]
  belongingTags: string[]
  created_at_ms: number
  edited_at_ms: number | null
}

// ================================================================
// 共通パーサー
// ================================================================

/**
 * emoji_reactions_json カラムの JSON 文字列を Entity.Reaction[] にパースする
 */
function parseEmojiReactions(json: string | null): Entity.Reaction[] {
  if (!json) return []
  try {
    return JSON.parse(json) as Entity.Reaction[]
  } catch {
    return []
  }
}

/** カスタム絵文字 JSON をパースする */
function parseEmojis(json: string | null): Entity.Emoji[] {
  if (!json) return []
  const parsed = JSON.parse(json) as ({
    shortcode: string
    url: string
    static_url: string | null
    visible_in_picker: number
  } | null)[]
  return parsed
    .filter(
      (e): e is NonNullable<typeof e> => e !== null && e.shortcode !== null,
    )
    .map((e) => ({
      shortcode: e.shortcode,
      static_url: e.static_url ?? e.url,
      url: e.url,
      visible_in_picker: e.visible_in_picker === 1,
    }))
}

/** メディア添付 JSON をパースする */
function parseMediaAttachments(json: string | null): Entity.Attachment[] {
  if (!json) return []
  return (JSON.parse(json) as (Entity.Attachment | null)[]).filter(
    (m): m is Entity.Attachment => m !== null,
  )
}

/**
 * メンション JSON をパースする
 *
 * 新スキーマでは post_mentions に username, url が格納されている。
 */
function parseMentions(json: string | null): Entity.Mention[] {
  if (!json) return []
  return (
    JSON.parse(json) as ({
      acct: string
      username?: string
      url?: string
    } | null)[]
  )
    .filter(
      (m): m is { acct: string; username?: string; url?: string } => m !== null,
    )
    .map((m) => ({
      acct: m.acct,
      id: '',
      url: m.url ?? '',
      username: m.username ?? m.acct.split('@')[0] ?? '',
    }))
}

/**
 * インラインクエリ用 poll パーサー（STATUS_SELECT から取得した poll_json 用）
 *
 * STATUS_SELECT の poll サブクエリには voted / own_votes が含まれないため、
 * voted は false 固定、own_votes は省略する。
 */
function parseInlinePoll(json: string): Entity.Poll {
  const p = JSON.parse(json) as {
    id: number
    expires_at: string | null
    multiple: number
    votes_count: number
    options: string | { title: string; votes_count: number | null }[]
  }
  const options =
    typeof p.options === 'string'
      ? (JSON.parse(p.options) as {
          title: string
          votes_count: number | null
        }[])
      : p.options
  return {
    expired: p.expires_at ? new Date(p.expires_at) < new Date() : false,
    expires_at: p.expires_at,
    id: String(p.id),
    multiple: p.multiple === 1,
    options: options.map((o) => ({
      title: o.title,
      votes_count: o.votes_count,
    })),
    voted: false,
    votes_count: p.votes_count,
  }
}

/**
 * バッチクエリ用 poll パーサー（BATCH_POLLS_SQL から取得した poll_json 用）
 *
 * バッチクエリでは poll_votes JOIN により voted / own_votes が含まれる。
 */
function parseBatchPoll(json: string): Entity.Poll {
  const p = JSON.parse(json) as {
    id: number
    expires_at: string | null
    expired: number | null
    multiple: number
    votes_count: number
    options: string | { title: string; votes_count: number | null }[]
    voted: number | null
    own_votes: string | number[] | null
  }
  const options =
    typeof p.options === 'string'
      ? (JSON.parse(p.options) as {
          title: string
          votes_count: number | null
        }[])
      : p.options

  let ownVotes: number[] | undefined
  if (p.own_votes != null) {
    try {
      ownVotes =
        typeof p.own_votes === 'string'
          ? (JSON.parse(p.own_votes) as number[])
          : p.own_votes
    } catch {
      ownVotes = undefined
    }
  }

  return {
    expired:
      p.expired != null
        ? p.expired === 1
        : p.expires_at
          ? new Date(p.expires_at) < new Date()
          : false,
    expires_at: p.expires_at,
    id: String(p.id),
    multiple: p.multiple === 1,
    options: options.map((o) => ({
      title: o.title,
      votes_count: o.votes_count,
    })),
    voted: p.voted === 1,
    votes_count: p.votes_count,
    ...(ownVotes ? { own_votes: ownVotes } : {}),
  }
}

/**
 * edited_at_ms (INTEGER | null) を ISO 文字列 | null に変換する
 */
function editedAtMsToIso(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null
}

// ================================================================
// インライン型の内部ヘルパー
// ================================================================

/** post_interactions の JSON オブジェクト型 */
interface InteractionsJson {
  is_favourited: number
  is_reblogged: number
  is_bookmarked: number
  is_muted: number
  is_pinned: number
  my_reaction_name: string | null
  my_reaction_url: string | null
}

/** interactions JSON をパースして返す（null なら null） */
function parseInteractions(json: string | null): InteractionsJson | null {
  if (!json) return null
  try {
    return JSON.parse(json) as InteractionsJson
  } catch {
    return null
  }
}

// ================================================================
// rowToStoredStatus
// ================================================================

/**
 * クエリ結果の1行を SqliteStoredStatus に変換する
 *
 * STATUS_SELECT の新カラム順序:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  object_uri
 *   [5]  content_html    [6]  spoiler_text     [7]  canonical_url
 *   [8]  language        [9]  visibility_code  [10] is_sensitive
 *   [11] is_reblog       [12] in_reply_to_id
 *   [13] edited_at_ms    [14] author_acct      [15] author_username
 *   [16] author_display  [17] author_avatar    [18] author_header
 *   [19] author_locked   [20] author_bot       [21] author_url
 *   [22] replies_count   [23] reblogs_count    [24] favourites_count
 *   [25] engagements_csv [26] media_json       [27] mentions_json
 *   [28] timelineTypes   [29] belongingTags
 *   [30] status_emojis_json [31] account_emojis_json
 *   [32] poll_json
 *
 * リブログ元 (is_reblog=1 の場合):
 *   [33] rb_post_id      [34] rb_content_html  [35] rb_spoiler_text
 *   [36] rb_canonical_url [37] rb_language     [38] rb_visibility_code
 *   [39] rb_is_sensitive  [40] rb_in_reply_to_id
 *   [41] rb_edited_at_ms  [42] rb_created_at_ms [43] rb_object_uri
 *   [44] rb_author_acct   [45] rb_author_username
 *   [46] rb_author_display [47] rb_author_avatar [48] rb_author_header
 *   [49] rb_author_locked [50] rb_author_bot    [51] rb_author_url
 *   [52] rb_replies_count [53] rb_reblogs_count [54] rb_favourites_count
 *   [55] rb_engagements_csv [56] rb_media_json  [57] rb_mentions_json
 *   [58] rb_status_emojis_json [59] rb_account_emojis_json
 *   [60] rb_poll_json     [61] rb_local_id
 *
 * 追加フィールド:
 *   [62] author_account_id [63] rb_author_account_id
 *   [64] emoji_reactions_json [65] rb_emoji_reactions_json
 */
export function rowToStoredStatus(
  row: (string | number | null)[],
): SqliteStoredStatus {
  // ── サブクエリ結果の取り出し ──
  const engagementsCsv = row[25] as string | null
  const engagements = engagementsCsv ? engagementsCsv.split(',') : []
  const mediaJson = row[26] as string | null
  const mentionsJson = row[27] as string | null
  const timelineTypesJson = row[28] as string | null
  const belongingTagsJson = row[29] as string | null
  const statusEmojisJson = row[30] as string | null
  const accountEmojisJson = row[31] as string | null
  const pollJson = row[32] as string | null
  const emojiReactionsJson = row[64] as string | null
  const rbEmojiReactionsJson = row[65] as string | null

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  // ── リブログ元投稿の復元 ──
  const isReblog = (row[11] as number) === 1
  const rbPostId = row[33] as number | null
  let reblog: Entity.Status | null = null

  if (isReblog && rbPostId !== null) {
    const rbEngagementsCsv = row[55] as string | null
    const rbEngagements = rbEngagementsCsv ? rbEngagementsCsv.split(',') : []
    const rbMediaJson = row[56] as string | null
    const rbMentionsJson = row[57] as string | null
    const rbStatusEmojisJson = row[58] as string | null
    const rbAccountEmojisJson = row[59] as string | null
    const rbPollJson = row[60] as string | null

    const rbEditedAtMs = row[41] as number | null

    reblog = {
      account: {
        acct: (row[44] as string) ?? '',
        avatar: (row[47] as string) ?? '',
        avatar_static: (row[47] as string) ?? '',
        bot: (row[50] as number) === 1,
        created_at: '',
        display_name: (row[46] as string) ?? '',
        emojis: parseEmojis(rbAccountEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: (row[48] as string) ?? '',
        header_static: (row[48] as string) ?? '',
        id: '',
        limited: null,
        locked: (row[49] as number) === 1,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[51] as string) ?? '',
        username: (row[45] as string) ?? '',
      },
      application: null,
      bookmarked: rbEngagements.includes('bookmark'),
      card: null,
      content: (row[34] as string) ?? '',
      created_at: row[42] ? new Date(row[42] as number).toISOString() : '',
      edited_at: editedAtMsToIso(rbEditedAtMs),
      emoji_reactions: parseEmojiReactions(rbEmojiReactionsJson),
      emojis: parseEmojis(rbStatusEmojisJson),
      favourited: rbEngagements.includes('favourite'),
      favourites_count: (row[54] as number) ?? 0,
      id: (row[61] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[40] as string | null,
      language: row[37] as string | null,
      media_attachments: parseMediaAttachments(rbMediaJson),
      mentions: parseMentions(rbMentionsJson),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rbPollJson ? parseInlinePoll(rbPollJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: rbEngagements.includes('reblog'),
      reblogs_count: (row[53] as number) ?? 0,
      replies_count: (row[52] as number) ?? 0,
      sensitive: (row[39] as number) === 1,
      spoiler_text: (row[35] as string) ?? '',
      tags: [],
      uri: (row[43] as string) ?? '',
      url: (row[36] as string | null) ?? undefined,
      visibility: ((row[38] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  // ── メイン投稿 ──
  const editedAtMs = row[13] as number | null

  return {
    account: {
      acct: (row[14] as string) ?? '',
      avatar: (row[17] as string) ?? '',
      avatar_static: (row[17] as string) ?? '',
      bot: (row[20] as number) === 1,
      created_at: '',
      display_name: (row[16] as string) ?? '',
      emojis: parseEmojis(accountEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[18] as string) ?? '',
      header_static: (row[18] as string) ?? '',
      id: '',
      limited: null,
      locked: (row[19] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[21] as string) ?? '',
      username: (row[15] as string) ?? '',
    },
    application: null,
    backendUrl: (row[1] as string) ?? '',
    belongingTags,
    bookmarked: engagements.includes('bookmark'),
    card: null,
    content: (row[5] as string) ?? '',
    created_at: new Date(row[3] as number).toISOString(),
    created_at_ms: row[3] as number,
    edited_at: editedAtMsToIso(editedAtMs),
    edited_at_ms: editedAtMs,
    emoji_reactions: parseEmojiReactions(emojiReactionsJson),
    emojis: parseEmojis(statusEmojisJson),
    favourited: engagements.includes('favourite'),
    favourites_count: (row[24] as number) ?? 0,
    id: (row[2] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[12] as string | null,
    language: row[8] as string | null,
    media_attachments: parseMediaAttachments(mediaJson),
    mentions: parseMentions(mentionsJson),
    muted: null,
    pinned: null,
    plain_content: null,
    poll: pollJson ? parseInlinePoll(pollJson) : null,
    // SqliteStoredStatus extra fields
    post_id: row[0] as number,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog,
    reblogged: engagements.includes('reblog'),
    reblogs_count: (row[23] as number) ?? 0,
    replies_count: (row[22] as number) ?? 0,
    sensitive: (row[10] as number) === 1,
    spoiler_text: (row[6] as string) ?? '',
    tags: belongingTags.map((t) => ({ name: t, url: '' })),
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as (TimelineType | null)[]).filter(
          (t): t is TimelineType => t !== null,
        )
      : [],
    uri: (row[4] as string) ?? '',
    url: (row[7] as string | null) ?? undefined,
    visibility: ((row[9] as string) ?? 'public') as Entity.StatusVisibility,
  }
}

// ================================================================
// assembleStatusFromBatch
// ================================================================

/**
 * Phase2-A の基本行 + バッチクエリの Map 群から SqliteStoredStatus を組み立てる。
 *
 * rowToStoredStatus と同じ出力を返すが、相関サブクエリの結果を
 * 事前に取得済みの Map から引く点が異なる。
 *
 * STATUS_BASE_SELECT の新カラム順序:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  object_uri
 *   [5]  content_html    [6]  spoiler_text     [7]  canonical_url
 *   [8]  language        [9]  visibility_code  [10] is_sensitive
 *   [11] is_reblog       [12] in_reply_to_id
 *   [13] edited_at_ms    [14] author_acct      [15] author_username
 *   [16] author_display  [17] author_avatar    [18] author_header
 *   [19] author_locked   [20] author_bot       [21] author_url
 *   [22] replies_count   [23] reblogs_count    [24] favourites_count
 *   [25] rb_post_id      [26] rb_content_html  [27] rb_spoiler_text
 *   [28] rb_canonical_url [29] rb_language     [30] rb_visibility_code
 *   [31] rb_is_sensitive  [32] rb_in_reply_to_id [33] rb_edited_at
 *   [34] rb_created_at_ms [35] rb_object_uri   [36] rb_author_acct
 *   [37] rb_author_username [38] rb_author_display [39] rb_author_avatar
 *   [40] rb_author_header [41] rb_author_locked [42] rb_author_bot
 *   [43] rb_author_url   [44] rb_replies_count [45] rb_reblogs_count
 *   [46] rb_favourites_count
 *   [47] rb_local_id     [48] author_account_id [49] rb_author_account_id
 *   [50] emoji_reactions_json [51] rb_emoji_reactions_json
 */
export function assembleStatusFromBatch(
  row: (string | number | null)[],
  maps: BatchMaps,
): SqliteStoredStatus {
  const postId = row[0] as number

  // ── バッチ Map からデータ取得 ──
  const interactionsJson = maps.interactionsMap.get(postId) ?? null
  const interactions = parseInteractions(interactionsJson)
  const mediaJson = maps.mediaMap.get(postId) ?? null
  const mentionsJson = maps.mentionsMap.get(postId) ?? null
  const timelineTypesJson = maps.timelineTypesMap.get(postId) ?? null
  const belongingTagsJson = maps.belongingTagsMap.get(postId) ?? null
  const customEmojisJson = maps.customEmojisMap.get(postId) ?? null
  const pollJson = maps.pollsMap.get(postId) ?? null
  const emojiReactionsJson = maps.emojiReactionsMap.get(postId) ?? null

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  // ── リブログ元投稿の復元 ──
  const isReblog = (row[11] as number) === 1
  const rbPostId = row[25] as number | null
  let reblog: Entity.Status | null = null

  if (isReblog && rbPostId !== null) {
    const rbInteractionsJson = maps.interactionsMap.get(rbPostId) ?? null
    const rbInteractions = parseInteractions(rbInteractionsJson)
    const rbMediaJson = maps.mediaMap.get(rbPostId) ?? null
    const rbMentionsJson = maps.mentionsMap.get(rbPostId) ?? null
    const rbCustomEmojisJson = maps.customEmojisMap.get(rbPostId) ?? null
    const rbPollJson = maps.pollsMap.get(rbPostId) ?? null
    const rbEmojiReactionsJson = maps.emojiReactionsMap.get(rbPostId) ?? null

    const rbEditedAtMs = row[33] as number | null

    reblog = {
      account: {
        acct: (row[36] as string) ?? '',
        avatar: (row[39] as string) ?? '',
        avatar_static: (row[39] as string) ?? '',
        bot: (row[42] as number) === 1,
        created_at: '',
        display_name: (row[38] as string) ?? '',
        emojis: parseEmojis(rbCustomEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: (row[40] as string) ?? '',
        header_static: (row[40] as string) ?? '',
        id: '',
        limited: null,
        locked: (row[41] as number) === 1,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[43] as string) ?? '',
        username: (row[37] as string) ?? '',
      },
      application: null,
      bookmarked: rbInteractions?.is_bookmarked === 1,
      card: null,
      content: (row[26] as string) ?? '',
      created_at: row[34] ? new Date(row[34] as number).toISOString() : '',
      edited_at: editedAtMsToIso(rbEditedAtMs),
      emoji_reactions: parseEmojiReactions(rbEmojiReactionsJson),
      emojis: parseEmojis(rbCustomEmojisJson),
      favourited: rbInteractions?.is_favourited === 1,
      favourites_count: (row[46] as number) ?? 0,
      id: (row[47] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[32] as string | null,
      language: row[29] as string | null,
      media_attachments: parseMediaAttachments(rbMediaJson),
      mentions: parseMentions(rbMentionsJson),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rbPollJson ? parseBatchPoll(rbPollJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: rbInteractions?.is_reblogged === 1,
      reblogs_count: (row[45] as number) ?? 0,
      replies_count: (row[44] as number) ?? 0,
      sensitive: (row[31] as number) === 1,
      spoiler_text: (row[27] as string) ?? '',
      tags: [],
      uri: (row[35] as string) ?? '',
      url: (row[28] as string | null) ?? undefined,
      visibility: ((row[30] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  // ── メイン投稿 ──
  const editedAtMs = row[13] as number | null

  return {
    account: {
      acct: (row[14] as string) ?? '',
      avatar: (row[17] as string) ?? '',
      avatar_static: (row[17] as string) ?? '',
      bot: (row[20] as number) === 1,
      created_at: '',
      display_name: (row[16] as string) ?? '',
      emojis: parseEmojis(customEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[18] as string) ?? '',
      header_static: (row[18] as string) ?? '',
      id: '',
      limited: null,
      locked: (row[19] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[21] as string) ?? '',
      username: (row[15] as string) ?? '',
    },
    application: null,
    backendUrl: (row[1] as string) ?? '',
    belongingTags,
    bookmarked: interactions?.is_bookmarked === 1,
    card: null,
    content: (row[5] as string) ?? '',
    created_at: new Date(row[3] as number).toISOString(),
    created_at_ms: row[3] as number,
    edited_at: editedAtMsToIso(editedAtMs),
    edited_at_ms: editedAtMs,
    emoji_reactions: parseEmojiReactions(emojiReactionsJson),
    emojis: parseEmojis(customEmojisJson),
    favourited: interactions?.is_favourited === 1,
    favourites_count: (row[24] as number) ?? 0,
    id: (row[2] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[12] as string | null,
    language: row[8] as string | null,
    media_attachments: parseMediaAttachments(mediaJson),
    mentions: parseMentions(mentionsJson),
    muted: null,
    pinned: null,
    plain_content: null,
    poll: pollJson ? parseBatchPoll(pollJson) : null,
    post_id: postId,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog,
    reblogged: interactions?.is_reblogged === 1,
    reblogs_count: (row[23] as number) ?? 0,
    replies_count: (row[22] as number) ?? 0,
    sensitive: (row[10] as number) === 1,
    spoiler_text: (row[6] as string) ?? '',
    tags: belongingTags.map((t) => ({ name: t, url: '' })),
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as (TimelineType | null)[]).filter(
          (t): t is TimelineType => t !== null,
        )
      : [],
    uri: (row[4] as string) ?? '',
    url: (row[7] as string | null) ?? undefined,
    visibility: ((row[9] as string) ?? 'public') as Entity.StatusVisibility,
  }
}

// ================================================================
// toStoredStatus
// ================================================================

/**
 * Entity.Status を StoredStatus 互換に変換して返す（保存は行わない）
 */
export function toStoredStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineTypes: TimelineType[],
): SqliteStoredStatus {
  return {
    ...status,
    backendUrl,
    belongingTags: status.tags.map((tag) => tag.name),
    created_at_ms: new Date(status.created_at).getTime(),
    edited_at_ms: status.edited_at
      ? new Date(status.edited_at).getTime()
      : null,
    post_id: 0,
    timelineTypes,
  }
}
