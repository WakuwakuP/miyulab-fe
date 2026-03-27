/**
 * Status の型定義とマッピング関数
 *
 * DB の行データを SqliteStoredStatus に変換するロジックを集約する。
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
  storedAt: number
}

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

/**
 * クエリ結果の1行を SqliteStoredStatus に変換する
 *
 * row レイアウト:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  stored_at        [5]  object_uri
 *   [6]  content_html    [7]  spoiler_text     [8]  canonical_url
 *   [9]  language        [10] visibility_code  [11] is_sensitive
 *   [12] is_reblog       [13] reblog_of_uri    [14] in_reply_to_id
 *   [15] edited_at       [16] author_acct      [17] author_username
 *   [18] author_display  [19] author_avatar    [20] author_header
 *   [21] author_locked   [22] author_bot       [23] author_url
 *   [24] replies_count   [25] reblogs_count    [26] favourites_count
 *   [27] engagements_csv [28] media_json       [29] mentions_json
 *   [30] timelineTypes   [31] belongingTags
 *   [32] status_emojis_json [33] account_emojis_json
 *   [34] poll_json
 *
 * リブログ元 (is_reblog=1 の場合):
 *   [35] rb_post_id      [36] rb_content_html  [37] rb_spoiler_text
 *   [38] rb_canonical_url [39] rb_language     [40] rb_visibility_code
 *   [41] rb_is_sensitive  [42] rb_in_reply_to_id [43] rb_edited_at
 *   [44] rb_created_at_ms [45] rb_object_uri   [46] rb_author_acct
 *   [47] rb_author_username [48] rb_author_display [49] rb_author_avatar
 *   [50] rb_author_header [51] rb_author_locked [52] rb_author_bot
 *   [53] rb_author_url   [54] rb_replies_count [55] rb_reblogs_count
 *   [56] rb_favourites_count [57] rb_engagements_csv [58] rb_media_json
 *   [59] rb_mentions_json [60] rb_status_emojis_json
 *   [61] rb_account_emojis_json [62] rb_poll_json [63] rb_local_id
 *
 * 追加フィールド:
 *   [64] author_account_id [65] rb_author_account_id
 *   [66] emoji_reactions_json [67] rb_emoji_reactions_json
 */
export function rowToStoredStatus(
  row: (string | number | null)[],
): SqliteStoredStatus {
  const engagementsCsv = row[27] as string | null
  const engagements = engagementsCsv ? engagementsCsv.split(',') : []
  const mediaJson = row[28] as string | null
  const mentionsJson = row[29] as string | null
  const timelineTypesJson = row[30] as string | null
  const belongingTagsJson = row[31] as string | null
  const statusEmojisJson = row[32] as string | null
  const accountEmojisJson = row[33] as string | null
  const pollJson = row[34] as string | null
  const emojiReactionsJson = row[66] as string | null
  const rbEmojiReactionsJson = row[67] as string | null

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  const parseEmojis = (json: string | null): Entity.Emoji[] => {
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

  const parsePoll = (json: string): Entity.Poll => {
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

  const parseMediaAttachments = (json: string | null): Entity.Attachment[] => {
    if (!json) return []
    return (JSON.parse(json) as (Entity.Attachment | null)[]).filter(
      (m): m is Entity.Attachment => m !== null,
    )
  }

  const parseMentions = (json: string | null): Entity.Mention[] => {
    if (!json) return []
    return (JSON.parse(json) as ({ acct: string } | null)[])
      .filter((m): m is { acct: string } => m !== null)
      .map((m) => ({
        acct: m.acct,
        id: '',
        url: '',
        username: m.acct.split('@')[0] ?? '',
      }))
  }

  // リブログ元投稿の復元
  const isReblog = (row[12] as number) === 1
  const rbPostId = row[35] as number | null
  let reblog: Entity.Status | null = null

  if (isReblog && rbPostId !== null) {
    const rbEngagementsCsv = row[57] as string | null
    const rbEngagements = rbEngagementsCsv ? rbEngagementsCsv.split(',') : []
    const rbMediaJson = row[58] as string | null
    const rbMentionsJson = row[59] as string | null
    const rbStatusEmojisJson = row[60] as string | null
    const rbAccountEmojisJson = row[61] as string | null
    const rbPollJson = row[62] as string | null

    reblog = {
      account: {
        acct: (row[46] as string) ?? '',
        avatar: (row[49] as string) ?? '',
        avatar_static: (row[49] as string) ?? '',
        bot: (row[52] as number) === 1,
        created_at: '',
        display_name: (row[48] as string) ?? '',
        emojis: parseEmojis(rbAccountEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: (row[50] as string) ?? '',
        header_static: (row[50] as string) ?? '',
        id: (row[65] as string) || '',
        limited: null,
        locked: (row[51] as number) === 1,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[53] as string) ?? '',
        username: (row[47] as string) ?? '',
      },
      application: null,
      bookmarked: rbEngagements.includes('bookmark'),
      card: null,
      content: (row[36] as string) ?? '',
      created_at: row[44] ? new Date(row[44] as number).toISOString() : '',
      edited_at: row[43] as string | null,
      emoji_reactions: parseEmojiReactions(rbEmojiReactionsJson),
      emojis: parseEmojis(rbStatusEmojisJson),
      favourited: rbEngagements.includes('favourite'),
      favourites_count: (row[56] as number) ?? 0,
      id: (row[63] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[42] as string | null,
      language: row[39] as string | null,
      media_attachments: parseMediaAttachments(rbMediaJson),
      mentions: parseMentions(rbMentionsJson),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rbPollJson ? parsePoll(rbPollJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: rbEngagements.includes('reblog'),
      reblogs_count: (row[55] as number) ?? 0,
      replies_count: (row[54] as number) ?? 0,
      sensitive: (row[41] as number) === 1,
      spoiler_text: (row[37] as string) ?? '',
      tags: [],
      uri: (row[45] as string) ?? '',
      url: (row[38] as string | null) ?? undefined,
      visibility: ((row[40] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  return {
    account: {
      acct: (row[16] as string) ?? '',
      avatar: (row[19] as string) ?? '',
      avatar_static: (row[19] as string) ?? '',
      bot: (row[22] as number) === 1,
      created_at: '',
      display_name: (row[18] as string) ?? '',
      emojis: parseEmojis(accountEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[20] as string) ?? '',
      header_static: (row[20] as string) ?? '',
      id: (row[64] as string) || '',
      limited: null,
      locked: (row[21] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[23] as string) ?? '',
      username: (row[17] as string) ?? '',
    },
    application: null,
    backendUrl: (row[1] as string) ?? '',
    belongingTags,
    bookmarked: engagements.includes('bookmark'),
    card: null,
    content: (row[6] as string) ?? '',
    created_at: new Date(row[3] as number).toISOString(),
    created_at_ms: row[3] as number,
    edited_at: row[15] as string | null,
    emoji_reactions: parseEmojiReactions(emojiReactionsJson),
    emojis: parseEmojis(statusEmojisJson),
    favourited: engagements.includes('favourite'),
    favourites_count: (row[26] as number) ?? 0,
    id: (row[2] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[14] as string | null,
    language: row[9] as string | null,
    media_attachments: parseMediaAttachments(mediaJson),
    mentions: parseMentions(mentionsJson),
    muted: null,
    pinned: null,
    plain_content: null,
    poll: pollJson ? parsePoll(pollJson) : null,
    // SqliteStoredStatus extra fields
    post_id: row[0] as number,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog,
    reblogged: engagements.includes('reblog'),
    reblogs_count: (row[25] as number) ?? 0,
    replies_count: (row[24] as number) ?? 0,
    sensitive: (row[11] as number) === 1,
    spoiler_text: (row[7] as string) ?? '',
    storedAt: row[4] as number,
    tags: belongingTags.map((t) => ({ name: t, url: '' })),
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as (TimelineType | null)[]).filter(
          (t): t is TimelineType => t !== null,
        )
      : [],
    uri: (row[5] as string) ?? '',
    url: (row[8] as string | null) ?? undefined,
    visibility: ((row[10] as string) ?? 'public') as Entity.StatusVisibility,
  }
}

/**
 * Phase2-A の基本行 + バッチクエリの Map 群から SqliteStoredStatus を組み立てる。
 *
 * rowToStoredStatus と同じ出力を返すが、相関サブクエリの結果を
 * 事前に取得済みの Map から引く点が異なる。
 */
export function assembleStatusFromBatch(
  row: (string | number | null)[],
  maps: BatchMaps,
): SqliteStoredStatus {
  const postId = row[0] as number

  const engagementsCsv = maps.engagementsMap.get(postId) ?? null
  const engagements = engagementsCsv ? engagementsCsv.split(',') : []
  const mediaJson = maps.mediaMap.get(postId) ?? null
  const mentionsJson = maps.mentionsMap.get(postId) ?? null
  const timelineTypesJson = maps.timelineTypesMap.get(postId) ?? null
  const belongingTagsJson = maps.belongingTagsMap.get(postId) ?? null
  const statusEmojisJson = maps.statusEmojisMap.get(postId) ?? null
  const accountEmojisJson = maps.accountEmojisMap.get(postId) ?? null
  const pollJson = maps.pollsMap.get(postId) ?? null

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  const parseEmojis = (json: string | null): Entity.Emoji[] => {
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

  const parsePoll = (json: string): Entity.Poll => {
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

  const parseMediaAttachments = (json: string | null): Entity.Attachment[] => {
    if (!json) return []
    return (JSON.parse(json) as (Entity.Attachment | null)[]).filter(
      (m): m is Entity.Attachment => m !== null,
    )
  }

  const parseMentions = (json: string | null): Entity.Mention[] => {
    if (!json) return []
    return (JSON.parse(json) as ({ acct: string } | null)[])
      .filter((m): m is { acct: string } => m !== null)
      .map((m) => ({
        acct: m.acct,
        id: '',
        url: '',
        username: m.acct.split('@')[0] ?? '',
      }))
  }

  // リブログ元投稿の復元
  // Phase2-A の基本行レイアウト: rb_post_id = [27]
  const isReblog = (row[12] as number) === 1
  const rbPostId = row[27] as number | null
  let reblog: Entity.Status | null = null

  if (isReblog && rbPostId !== null) {
    const rbEngagementsCsv = maps.engagementsMap.get(rbPostId) ?? null
    const rbEngagements = rbEngagementsCsv ? rbEngagementsCsv.split(',') : []
    const rbMediaJson = maps.mediaMap.get(rbPostId) ?? null
    const rbMentionsJson = maps.mentionsMap.get(rbPostId) ?? null
    const rbStatusEmojisJson = maps.statusEmojisMap.get(rbPostId) ?? null
    const rbAccountEmojisJson = maps.accountEmojisMap.get(rbPostId) ?? null
    const rbPollJson = maps.pollsMap.get(rbPostId) ?? null

    reblog = {
      account: {
        acct: (row[38] as string) ?? '',
        avatar: (row[41] as string) ?? '',
        avatar_static: (row[41] as string) ?? '',
        bot: (row[44] as number) === 1,
        created_at: '',
        display_name: (row[40] as string) ?? '',
        emojis: parseEmojis(rbAccountEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: (row[42] as string) ?? '',
        header_static: (row[42] as string) ?? '',
        id: (row[51] as string) || '',
        limited: null,
        locked: (row[43] as number) === 1,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[45] as string) ?? '',
        username: (row[39] as string) ?? '',
      },
      application: null,
      bookmarked: rbEngagements.includes('bookmark'),
      card: null,
      content: (row[28] as string) ?? '',
      created_at: row[36] ? new Date(row[36] as number).toISOString() : '',
      edited_at: row[35] as string | null,
      emoji_reactions: parseEmojiReactions(row[53] as string | null),
      emojis: parseEmojis(rbStatusEmojisJson),
      favourited: rbEngagements.includes('favourite'),
      favourites_count: (row[48] as number) ?? 0,
      id: (row[49] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[34] as string | null,
      language: row[31] as string | null,
      media_attachments: parseMediaAttachments(rbMediaJson),
      mentions: parseMentions(rbMentionsJson),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rbPollJson ? parsePoll(rbPollJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: rbEngagements.includes('reblog'),
      reblogs_count: (row[47] as number) ?? 0,
      replies_count: (row[46] as number) ?? 0,
      sensitive: (row[33] as number) === 1,
      spoiler_text: (row[29] as string) ?? '',
      tags: [],
      uri: (row[37] as string) ?? '',
      url: (row[30] as string | null) ?? undefined,
      visibility: ((row[32] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  return {
    account: {
      acct: (row[16] as string) ?? '',
      avatar: (row[19] as string) ?? '',
      avatar_static: (row[19] as string) ?? '',
      bot: (row[22] as number) === 1,
      created_at: '',
      display_name: (row[18] as string) ?? '',
      emojis: parseEmojis(accountEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[20] as string) ?? '',
      header_static: (row[20] as string) ?? '',
      id: (row[50] as string) || '',
      limited: null,
      locked: (row[21] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[23] as string) ?? '',
      username: (row[17] as string) ?? '',
    },
    application: null,
    backendUrl: (row[1] as string) ?? '',
    belongingTags,
    bookmarked: engagements.includes('bookmark'),
    card: null,
    content: (row[6] as string) ?? '',
    created_at: new Date(row[3] as number).toISOString(),
    created_at_ms: row[3] as number,
    edited_at: row[15] as string | null,
    emoji_reactions: parseEmojiReactions(row[52] as string | null),
    emojis: parseEmojis(statusEmojisJson),
    favourited: engagements.includes('favourite'),
    favourites_count: (row[26] as number) ?? 0,
    id: (row[2] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[14] as string | null,
    language: row[9] as string | null,
    media_attachments: parseMediaAttachments(mediaJson),
    mentions: parseMentions(mentionsJson),
    muted: null,
    pinned: null,
    plain_content: null,
    poll: pollJson ? parsePoll(pollJson) : null,
    post_id: postId,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog,
    reblogged: engagements.includes('reblog'),
    reblogs_count: (row[25] as number) ?? 0,
    replies_count: (row[24] as number) ?? 0,
    sensitive: (row[11] as number) === 1,
    spoiler_text: (row[7] as string) ?? '',
    storedAt: row[4] as number,
    tags: belongingTags.map((t) => ({ name: t, url: '' })),
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as (TimelineType | null)[]).filter(
          (t): t is TimelineType => t !== null,
        )
      : [],
    uri: (row[5] as string) ?? '',
    url: (row[8] as string | null) ?? undefined,
    visibility: ((row[10] as string) ?? 'public') as Entity.StatusVisibility,
  }
}

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
    post_id: 0,
    storedAt: Date.now(),
    timelineTypes,
  }
}
