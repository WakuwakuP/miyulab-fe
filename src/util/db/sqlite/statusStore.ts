/**
 * SQLite ベースの Status ストア（薄いラッパー）
 *
 * 書き込み操作は Worker 側の専用ハンドラに委譲し、
 * 読み取り操作のみ execAsync で直接実行する。
 *
 * notifyChange は workerClient が changedTables を元に自動発火するため、
 * このモジュールからは呼ばない。
 */

import type { Entity } from 'megalodon'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
} from 'util/queryBuilder'
/** タイムラインの種類（DB層用。notification は notifications テーブルで管理するため含めない） */
export type TimelineType = 'home' | 'local' | 'public' | 'tag'

import { getSqliteDb } from './connection'

// ================================================================
// 定数
// ================================================================

/** クエリの最大行数上限（LIMIT 未指定時のデフォルト） */
const MAX_QUERY_LIMIT = 2147483647

// ================================================================
// StoredStatus 型
// ================================================================
export interface SqliteStoredStatus extends Entity.Status {
  post_id: number
  backendUrl: string
  timelineTypes: TimelineType[]
  belongingTags: string[]
  created_at_ms: number
  storedAt: number
}

// ================================================================
// 内部ユーティリティ
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
 * 正規化テーブルから Entity.Status を構築するための SELECT 句
 * posts_backends (pb), profiles (pr), visibility_types (vt) の JOIN が必要
 */
export const STATUS_SELECT = `
  p.post_id,
  MIN(pb.backendUrl) AS backendUrl,
  (SELECT pb2.local_id FROM posts_backends pb2 WHERE pb2.post_id = p.post_id ORDER BY pb2.backendUrl LIMIT 1) AS local_id,
  p.created_at_ms,
  p.stored_at,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.code, 'public') AS visibility_code,
  p.is_sensitive,
  p.is_reblog,
  p.reblog_of_uri,
  p.in_reply_to_id,
  p.edited_at,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.locked, 0) AS author_locked,
  COALESCE(pr.bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  (SELECT group_concat(et.code, ',') FROM post_engagements pe INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id WHERE pe.post_id = p.post_id) AS engagements_csv,
  CASE WHEN p.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = p.post_id ORDER BY pm.sort_order) ELSE NULL END AS media_json,
  (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = p.post_id) AS mentions_json,
  (SELECT json_group_array(ck.code) FROM timeline_items ti INNER JOIN timelines t ON t.timeline_id = ti.timeline_id INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id WHERE ti.post_id = p.post_id) AS timelineTypes,
  (SELECT json_group_array(tag) FROM posts_belonging_tags WHERE post_id = p.post_id) AS belongingTags,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = p.post_id AND pce.usage_context = 'status') AS status_emojis_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = p.post_id AND pce.usage_context = 'account') AS account_emojis_json,
  (SELECT json_object('id', pl.poll_id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.poll_id ORDER BY po.option_index)) FROM polls pl WHERE pl.post_id = p.post_id) AS poll_json,
  rs.post_id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.code, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.locked, 0) AS rb_author_locked,
  COALESCE(rpr.bot, 0) AS rb_author_bot,
  COALESCE(rpr.actor_uri, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT group_concat(et.code, ',') FROM post_engagements pe INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id WHERE pe.post_id = rs.post_id)
    ELSE NULL
  END AS rb_engagements_csv,
  CASE WHEN rs.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = rs.post_id ORDER BY pm.sort_order) ELSE NULL END AS rb_media_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = rs.post_id)
    ELSE NULL
  END AS rb_mentions_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rs.post_id AND pce.usage_context = 'status')
    ELSE NULL
  END AS rb_status_emojis_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rs.post_id AND pce.usage_context = 'account')
    ELSE NULL
  END AS rb_account_emojis_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_object('id', pl.poll_id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.poll_id ORDER BY po.option_index)) FROM polls pl WHERE pl.post_id = rs.post_id)
    ELSE NULL
  END AS rb_poll_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id AND rpb.backendUrl = (SELECT MIN(pb3.backendUrl) FROM posts_backends pb3 WHERE pb3.post_id = p.post_id) LIMIT 1),
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id ORDER BY rpb.backendUrl LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(pra.remote_account_id, '') AS author_account_id,
  COALESCE(rpra.remote_account_id, '') AS rb_author_account_id,
  ps.emoji_reactions_json,
  rps.emoji_reactions_json AS rb_emoji_reactions_json`

// ================================================================
// Phase2 バッチクエリ用の定数・型定義
// ================================================================

/**
 * Phase2-A: 相関サブクエリを除いた本体 + 1:1 JOIN の SELECT 句
 *
 * useCustomQueryTimeline.ts のインライン Phase2 でも使用するため export する。
 *
 * rowToBaseRow のレイアウト:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  stored_at        [5]  object_uri
 *   [6]  content_html    [7]  spoiler_text     [8]  canonical_url
 *   [9]  language        [10] visibility_code  [11] is_sensitive
 *   [12] is_reblog       [13] reblog_of_uri    [14] in_reply_to_id
 *   [15] edited_at       [16] author_acct      [17] author_username
 *   [18] author_display  [19] author_avatar    [20] author_header
 *   [21] author_locked   [22] author_bot       [23] author_url
 *   [24] replies_count   [25] reblogs_count    [26] favourites_count
 *   [27] rb_post_id      [28] rb_content_html  [29] rb_spoiler_text
 *   [30] rb_canonical_url [31] rb_language     [32] rb_visibility_code
 *   [33] rb_is_sensitive  [34] rb_in_reply_to_id [35] rb_edited_at
 *   [36] rb_created_at_ms [37] rb_object_uri   [38] rb_author_acct
 *   [39] rb_author_username [40] rb_author_display [41] rb_author_avatar
 *   [42] rb_author_header [43] rb_author_locked [44] rb_author_bot
 *   [45] rb_author_url   [46] rb_replies_count [47] rb_reblogs_count
 *   [48] rb_favourites_count
 *   [49] rb_local_id     [50] author_account_id [51] rb_author_account_id
 *   [52] emoji_reactions_json [53] rb_emoji_reactions_json
 */
export const STATUS_BASE_SELECT = `
  p.post_id,
  MIN(pb.backendUrl) AS backendUrl,
  (SELECT pb2.local_id FROM posts_backends pb2 WHERE pb2.post_id = p.post_id ORDER BY pb2.backendUrl LIMIT 1) AS local_id,
  p.created_at_ms,
  p.stored_at,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.code, 'public') AS visibility_code,
  p.is_sensitive,
  p.is_reblog,
  p.reblog_of_uri,
  p.in_reply_to_id,
  p.edited_at,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.locked, 0) AS author_locked,
  COALESCE(pr.bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  rs.post_id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.code, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.locked, 0) AS rb_author_locked,
  COALESCE(rpr.bot, 0) AS rb_author_bot,
  COALESCE(rpr.actor_uri, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.post_id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id AND rpb.backendUrl = (SELECT MIN(pb3.backendUrl) FROM posts_backends pb3 WHERE pb3.post_id = p.post_id) LIMIT 1),
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id ORDER BY rpb.backendUrl LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(pra.remote_account_id, '') AS author_account_id,
  COALESCE(rpra.remote_account_id, '') AS rb_author_account_id,
  ps.emoji_reactions_json,
  rps.emoji_reactions_json AS rb_emoji_reactions_json`

/** post_id → engagements_csv (例: "favourite,bookmark") のバッチクエリ */
const BATCH_ENGAGEMENTS_SQL = `
  SELECT pe.post_id, group_concat(et.code, ',') AS engagements_csv
  FROM post_engagements pe
  INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
  WHERE pe.post_id IN (__PH__)
  GROUP BY pe.post_id`

/** post_id → media_json のバッチクエリ */
const BATCH_MEDIA_SQL = `
  SELECT pm.post_id,
    json_group_array(
      json_object(
        'id', pm.remote_media_id,
        'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'),
        'url', pm.url,
        'preview_url', pm.preview_url,
        'description', pm.description,
        'blurhash', pm.blurhash,
        'remote_url', pm.url
      )
    ) AS media_json
  FROM post_media pm
  WHERE pm.post_id IN (__PH__)
  GROUP BY pm.post_id
  ORDER BY pm.post_id, pm.sort_order`

/** post_id → mentions_json のバッチクエリ */
const BATCH_MENTIONS_SQL = `
  SELECT pme.post_id,
    json_group_array(json_object('acct', pme.acct)) AS mentions_json
  FROM posts_mentions pme
  WHERE pme.post_id IN (__PH__)
  GROUP BY pme.post_id`

/** post_id → timelineTypes JSON のバッチクエリ */
const BATCH_TIMELINE_TYPES_SQL = `
  SELECT ti.post_id,
    json_group_array(ck.code) AS timelineTypes
  FROM timeline_items ti
  INNER JOIN timelines t ON t.timeline_id = ti.timeline_id
  INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
  WHERE ti.post_id IN (__PH__)
  GROUP BY ti.post_id`

/** post_id → belongingTags JSON のバッチクエリ */
const BATCH_BELONGING_TAGS_SQL = `
  SELECT pbt.post_id,
    json_group_array(pbt.tag) AS belongingTags
  FROM posts_belonging_tags pbt
  WHERE pbt.post_id IN (__PH__)
  GROUP BY pbt.post_id`

/** post_id → custom_emojis JSON (status / account 両方) のバッチクエリ */
const BATCH_CUSTOM_EMOJIS_SQL = `
  SELECT pce.post_id, pce.usage_context,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.image_url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM post_custom_emojis pce
  INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id
  WHERE pce.post_id IN (__PH__)
  GROUP BY pce.post_id, pce.usage_context`

/** post_id → poll_json のバッチクエリ */
const BATCH_POLLS_SQL = `
  SELECT pl.post_id,
    json_object(
      'id', pl.poll_id,
      'expires_at', pl.expires_at,
      'multiple', pl.multiple,
      'votes_count', pl.votes_count,
      'options', (
        SELECT json_group_array(
          json_object('title', po.title, 'votes_count', po.votes_count)
        )
        FROM poll_options po
        WHERE po.poll_id = pl.poll_id
        ORDER BY po.option_index
      )
    ) AS poll_json
  FROM polls pl
  WHERE pl.post_id IN (__PH__)`

// ================================================================
// バッチクエリ結果の Map 型
// ================================================================

interface BatchMaps {
  engagementsMap: Map<number, string>
  mediaMap: Map<number, string>
  mentionsMap: Map<number, string>
  timelineTypesMap: Map<number, string>
  belongingTagsMap: Map<number, string>
  statusEmojisMap: Map<number, string>
  accountEmojisMap: Map<number, string>
  pollsMap: Map<number, string>
  emojiReactionsMap: Map<number, string>
}

// ================================================================
// バッチクエリ実行ヘルパー
// ================================================================

/**
 * プレースホルダ文字列 __PH__ を実際の (?, ?, ...) に置換する
 */
export function replacePlaceholders(sql: string, count: number): string {
  const ph = Array.from({ length: count }, () => '?').join(',')
  return sql.replace('__PH__', ph)
}

/**
 * allPostIds に対して子テーブルのバッチクエリをまとめて実行し、
 * post_id をキーとした Map 群を返す。
 *
 * 親投稿とリブログ元投稿の post_id を両方含めた allPostIds を渡すことで、
 * 1 回のバッチクエリで両方のデータを取得できる。
 */
export async function executeBatchQueries(
  handle: SqliteHandle,
  allPostIds: number[],
): Promise<BatchMaps> {
  if (allPostIds.length === 0) {
    return {
      accountEmojisMap: new Map(),
      belongingTagsMap: new Map(),
      emojiReactionsMap: new Map(),
      engagementsMap: new Map(),
      mediaMap: new Map(),
      mentionsMap: new Map(),
      pollsMap: new Map(),
      statusEmojisMap: new Map(),
      timelineTypesMap: new Map(),
    }
  }

  const count = allPostIds.length

  // 全バッチクエリを並列実行
  const [
    engagementRows,
    mediaRows,
    mentionRows,
    timelineTypeRows,
    belongingTagRows,
    emojiRows,
    pollRows,
  ] = await Promise.all([
    handle.execAsync(replacePlaceholders(BATCH_ENGAGEMENTS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_MEDIA_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_MENTIONS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_TIMELINE_TYPES_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_BELONGING_TAGS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_CUSTOM_EMOJIS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_POLLS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
  ])

  // 結果を Map に変換
  const engagementsMap = new Map<number, string>()
  for (const row of engagementRows) {
    engagementsMap.set(row[0] as number, row[1] as string)
  }

  const mediaMap = new Map<number, string>()
  for (const row of mediaRows) {
    mediaMap.set(row[0] as number, row[1] as string)
  }

  const mentionsMap = new Map<number, string>()
  for (const row of mentionRows) {
    mentionsMap.set(row[0] as number, row[1] as string)
  }

  const timelineTypesMap = new Map<number, string>()
  for (const row of timelineTypeRows) {
    timelineTypesMap.set(row[0] as number, row[1] as string)
  }

  const belongingTagsMap = new Map<number, string>()
  for (const row of belongingTagRows) {
    belongingTagsMap.set(row[0] as number, row[1] as string)
  }

  // emojis は usage_context ごとに分ける: [post_id, usage_context, emojis_json]
  const statusEmojisMap = new Map<number, string>()
  const accountEmojisMap = new Map<number, string>()
  for (const row of emojiRows) {
    const postId = row[0] as number
    const context = row[1] as string
    const json = row[2] as string
    if (context === 'status') {
      statusEmojisMap.set(postId, json)
    } else if (context === 'account') {
      accountEmojisMap.set(postId, json)
    }
  }

  const pollsMap = new Map<number, string>()
  for (const row of pollRows) {
    pollsMap.set(row[0] as number, row[1] as string)
  }

  // emoji_reactions は Phase2-A の基本行に含まれるため、バッチクエリ不要。
  // assembleStatusFromBatch 内で row[52] / row[53] から直接読み取る。
  const emojiReactionsMap = new Map<number, string>()

  return {
    accountEmojisMap,
    belongingTagsMap,
    emojiReactionsMap,
    engagementsMap,
    mediaMap,
    mentionsMap,
    pollsMap,
    statusEmojisMap,
    timelineTypesMap,
  }
}

// ================================================================
// バッチ結果から SqliteStoredStatus を組み立てるヘルパー
// ================================================================

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
 * 正規化テーブルの基本 JOIN 句（profiles, visibility_types, posts_backends）
 */
export const STATUS_BASE_JOINS = `
  LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
  LEFT JOIN visibility_types vt ON p.visibility_id = vt.visibility_id
  LEFT JOIN posts_backends pb ON p.post_id = pb.post_id
  LEFT JOIN post_stats ps ON p.post_id = ps.post_id
  LEFT JOIN posts rs ON p.reblog_of_uri = rs.object_uri AND rs.object_uri != ''
  LEFT JOIN profiles rpr ON rs.author_profile_id = rpr.profile_id
  LEFT JOIN visibility_types rvt ON rs.visibility_id = rvt.visibility_id
  LEFT JOIN post_stats rps ON rs.post_id = rps.post_id
  LEFT JOIN profile_aliases pra ON pra.profile_id = pr.profile_id AND pra.server_id = (SELECT pb_s.server_id FROM posts_backends pb_s WHERE pb_s.post_id = p.post_id ORDER BY pb_s.backendUrl LIMIT 1)
  LEFT JOIN profile_aliases rpra ON rpra.profile_id = rpr.profile_id AND rpra.server_id = (SELECT pb_s.server_id FROM posts_backends pb_s WHERE pb_s.post_id = p.post_id ORDER BY pb_s.backendUrl LIMIT 1)`

// ================================================================
// 2段階クエリ: post_id リストから詳細情報を取得する共通ヘルパー
// ================================================================

type SqliteHandle = Awaited<ReturnType<typeof getSqliteDb>>

/**
 * post_id のリストから完全な投稿データを取得する（バッチクエリ版）
 *
 * 2段階クエリ戦略の第2段階で使用する共通ヘルパー。
 * 第1段階でフィルタ済みの post_id を受け取り、詳細情報を返す。
 *
 * 従来は 1 つの SQL に ~13 個の相関サブクエリを埋め込んでいたが、
 * 本実装では本体クエリ (Phase2-A) + 7 個の子テーブルバッチクエリに分解し、
 * JS 側でマージする。これにより約 1,050 回 → 8 回にクエリ回数を削減する。
 */
async function fetchStatusesByIds(
  handle: SqliteHandle,
  postIds: number[],
  timelineTypesMap?: Map<number, string>,
): Promise<SqliteStoredStatus[]> {
  if (postIds.length === 0) return []

  // Phase2-A: 本体 + 1:1 JOIN (相関サブクエリなし)
  const placeholders = postIds.map(() => '?').join(',')
  const baseSql = `
    SELECT ${STATUS_BASE_SELECT}
    FROM posts p
      ${STATUS_BASE_JOINS}
    WHERE p.post_id IN (${placeholders})
    GROUP BY p.post_id
    ORDER BY p.created_at_ms DESC;
  `
  const baseRows = (await handle.execAsync(baseSql, {
    bind: postIds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  if (baseRows.length === 0) return []

  // リブログ元の post_id を収集し、全 post_id のリストを作成
  const reblogPostIds: number[] = []
  for (const row of baseRows) {
    const rbPostId = row[27] as number | null // rb_post_id
    if (rbPostId !== null) {
      reblogPostIds.push(rbPostId)
    }
  }

  // 重複を排除した全 post_id (親 + リブログ元)
  const allPostIds = [...new Set([...postIds, ...reblogPostIds])]

  // Phase2-B〜H: 子テーブルのバッチクエリを並列実行
  const maps = await executeBatchQueries(handle, allPostIds)

  // 外部から渡された timelineTypesMap があればバッチ結果を上書き
  if (timelineTypesMap) {
    for (const [id, types] of timelineTypesMap) {
      maps.timelineTypesMap.set(id, types)
    }
  }

  // JS 側マージ: 基本行 + バッチ Map → SqliteStoredStatus
  return baseRows.map((row) => assembleStatusFromBatch(row, maps))
}

// ================================================================
// Public API
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
    post_id: 0,
    storedAt: Date.now(),
    timelineTypes,
  }
}

// ================================================================
// ストリーミングイベント マイクロバッチング
// ================================================================

type BufferedUpsert = {
  backendUrl: string
  status: Entity.Status
  tag?: string
  timelineType: TimelineType
}

/** バッファキー: backendUrl + timelineType + tag */
function makeBufferKey(
  backendUrl: string,
  timelineType: string,
  tag?: string,
): string {
  return `${backendUrl}\0${timelineType}\0${tag ?? ''}`
}

const upsertBufferMap = new Map<string, BufferedUpsert[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** バッファリング間隔（ms） */
const FLUSH_INTERVAL_MS = 100
/** この件数に達したら即座にフラッシュ */
const FLUSH_SIZE_THRESHOLD = 20

async function flushAllBuffers(): Promise<void> {
  flushTimer = null
  const entries = Array.from(upsertBufferMap.entries())
  upsertBufferMap.clear()

  for (const [, items] of entries) {
    if (items.length === 0) continue
    const { backendUrl, tag, timelineType } = items[0]
    try {
      const handle = await getSqliteDb()
      await handle.sendCommand({
        backendUrl,
        statusesJson: items.map((e) => JSON.stringify(e.status)),
        tag,
        timelineType,
        type: 'bulkUpsertStatuses',
      })
    } catch (error) {
      console.error('Failed to flush upsert buffer:', error)
    }
  }
}

/**
 * Status を追加または更新（マイクロバッチング対応）
 *
 * ストリーミングイベントごとの個別トランザクションを避けるため、
 * バッファに蓄積し一定間隔または閾値到達時にまとめてフラッシュする。
 */
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const key = makeBufferKey(backendUrl, timelineType, tag)
  let buf = upsertBufferMap.get(key)
  if (!buf) {
    buf = []
    upsertBufferMap.set(key, buf)
  }
  buf.push({ backendUrl, status, tag, timelineType })

  // 閾値に達したら即座にフラッシュ
  const totalBuffered = Array.from(upsertBufferMap.values()).reduce(
    (sum, b) => sum + b.length,
    0,
  )
  if (totalBuffered >= FLUSH_SIZE_THRESHOLD) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
    }
    await flushAllBuffers()
    return
  }

  // タイマーが未設定なら設定
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushAllBuffers()
    }, FLUSH_INTERVAL_MS)
  }
}

/**
 * 複数の Status を一括追加（初期ロード用）
 */
export async function bulkUpsertStatuses(
  statuses: Entity.Status[],
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  if (statuses.length === 0) return

  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusesJson: statuses.map((s) => JSON.stringify(s)),
    tag,
    timelineType,
    type: 'bulkUpsertStatuses',
  })
}

/**
 * 特定タイムラインから Status を除外（物理削除ではない）
 */
export async function removeFromTimeline(
  backendUrl: string,
  statusId: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusId,
    tag,
    timelineType,
    type: 'removeFromTimeline',
  })
}

/**
 * delete イベントの処理
 */
export async function handleDeleteEvent(
  backendUrl: string,
  statusId: string,
  sourceTimelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    sourceTimelineType,
    statusId,
    tag,
    type: 'handleDeleteEvent',
  })
}

/**
 * Status のアクション状態を更新
 */
export async function updateStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    action,
    backendUrl,
    statusId,
    type: 'updateStatusAction',
    value,
  })
}

/**
 * Status 全体を更新（編集された投稿用）
 */
export async function updateStatus(
  status: Entity.Status,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusJson: JSON.stringify(status),
    type: 'updateStatus',
  })
}

/**
 * ローカルアカウントを登録または更新
 *
 * verifyAccountCredentials で取得した自アカウント情報を local_accounts テーブルに反映する。
 */
export async function ensureLocalAccount(
  account: Entity.Account,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    accountJson: JSON.stringify(account),
    backendUrl,
    type: 'ensureLocalAccount',
  })
}

/**
 * リアクションの追加/削除を DB に反映する
 */
export async function toggleReactionInDb(
  backendUrl: string,
  statusId: string,
  value: boolean,
  emoji: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    emoji,
    statusId,
    type: 'toggleReaction',
    value,
  })
}

// ================================================================
// クエリ API
// ================================================================

/**
 * タイムライン種類で Status を取得
 */
export async function getStatusesByTimelineType(
  timelineType: TimelineType,
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id + timelineTypes の取得
  const phase1Sql = `
    SELECT p.post_id, json_group_array(DISTINCT ck.code) AS timelineTypes
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
    LEFT JOIN timeline_items ti ON p.post_id = ti.post_id
    LEFT JOIN timelines t ON t.timeline_id = ti.timeline_id
    LEFT JOIN channel_kinds ck ON t.channel_kind_id = ck.channel_kind_id
    WHERE ptt.timelineType = ?
      ${backendFilter}
    GROUP BY p.post_id
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(timelineType, limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)
  const timelineTypesMap = new Map<number, string>()
  for (const row of idRows) {
    if (row[1] != null) {
      timelineTypesMap.set(row[0] as number, row[1] as string)
    }
  }

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds, timelineTypesMap)
}

/**
 * タグで Status を取得
 */
export async function getStatusesByTag(
  tag: string,
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id の取得
  const phase1Sql = `
    SELECT DISTINCT p.post_id
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN posts_belonging_tags pbt ON p.post_id = pbt.post_id
    WHERE pbt.tag = ?
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(tag, limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

/**
 * ブックマークした Status を取得
 */
export async function getBookmarkedStatuses(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id の取得
  const phase1Sql = `
    SELECT DISTINCT p.post_id
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN post_engagements pe ON p.post_id = pe.post_id
    INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
    WHERE et.code = 'bookmark'
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

/**
 * ユーザー入力の WHERE 句をサニタイズする
 *
 * - LIMIT / OFFSET を除去（自動設定のため）
 * - データ変更系ステートメントを拒否（DROP, DELETE, INSERT, UPDATE, ALTER, CREATE）
 * - セミコロン（複文実行）を除去
 *
 * ※ この DB はクライアントサイド専用（ユーザー自身のデータのみ）のため、
 *   悪意のある第三者による攻撃リスクは低い。しかし誤操作によるデータ破損を
 *   防止するため、DML/DDL ステートメントは拒否する。
 */
function sanitizeWhereClause(input: string): string {
  // データ変更・構造変更ステートメントを検出して拒否
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(input)) {
    throw new Error(
      'Custom query contains forbidden SQL statements. Only SELECT-compatible WHERE clauses are allowed.',
    )
  }

  // SQLコメントを拒否（後続条件のコメントアウト防止）
  if (/--/.test(input) || /\/\*/.test(input)) {
    throw new Error(
      'Custom query contains SQL comments (-- or /* */). Comments are not allowed.',
    )
  }

  return (
    input
      // セミコロンを除去（複文実行防止）
      .replace(/;/g, '')
      // LIMIT/OFFSET を除去（自動設定のため）
      .replace(/\bLIMIT\b\s+\d+/gi, '')
      .replace(/\bOFFSET\b\s+\d+/gi, '')
      .trim()
  )
}

/**
 * カスタム WHERE 句で Status を取得（advanced query 用）
 *
 * limit / offset はクエリ文字列を無視して自動設定する。
 * WHERE 句は posts_timeline_types (ptt), posts_belonging_tags (pbt),
 * posts (p) テーブルを参照できる。
 *
 * ※ この関数はクライアントサイド SQLite DB に対してのみ実行される。
 *   DB にはユーザー自身のデータのみが格納されており、
 *   第三者からの入力は含まれない。
 */
export async function getStatusesByCustomQuery(
  whereClause: string,
  backendUrls?: string[],
  limit?: number,
  offset?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const sanitized = sanitizeWhereClause(whereClause)

  // WHERE 句で参照されているテーブルのみ JOIN する（不要な JOIN を除外）
  const refs = detectReferencedAliases(sanitized)

  // 旧カラム名 backend_url を正しい backendUrl に修正
  const rewrittenWhere = sanitized.replace(
    /\bpb\.backend_url\b/g,
    'pb.backendUrl',
  )

  const joinLines: string[] = []
  if (refs.ptt)
    joinLines.push(
      'LEFT JOIN posts_timeline_types ptt\n      ON p.post_id = ptt.post_id',
    )
  if (refs.pbt)
    joinLines.push(
      'LEFT JOIN posts_belonging_tags pbt\n      ON p.post_id = pbt.post_id',
    )
  if (refs.pme)
    joinLines.push(
      'LEFT JOIN posts_mentions pme\n      ON p.post_id = pme.post_id',
    )
  if (refs.prb)
    joinLines.push(
      'LEFT JOIN posts_reblogs prb\n      ON p.post_id = prb.post_id',
    )
  if (refs.pe)
    joinLines.push(
      'LEFT JOIN post_engagements pe\n      ON p.post_id = pe.post_id',
    )

  let backendFilter = ''
  const phase1Binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    phase1Binds.push(...backendUrls)
  }

  const joinsClause =
    joinLines.length > 0 ? `\n    ${joinLines.join('\n    ')}` : ''

  // 第1段階: post_id の取得（旧カラム名の後方互換性のため posts をサブクエリでラップ）
  const phase1Sql = `
    SELECT DISTINCT p.post_id
    FROM (
      SELECT p_inner.*,
        COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p_inner.origin_server_id), '') AS origin_backend_url,
        COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p_inner.author_profile_id), '') AS account_acct,
        '' AS account_id,
        COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p_inner.visibility_id), 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS favourites_count,
        COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS reblogs_count,
        COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS replies_count
      FROM posts p_inner
    ) p
    LEFT JOIN posts_backends pb ON p.post_id = pb.post_id${joinsClause}
    WHERE (${rewrittenWhere || '1=1'})
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?
    OFFSET ?;
  `
  phase1Binds.push(limit ?? MAX_QUERY_LIMIT, offset ?? 0)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

/**
 * テーブルカラム / エイリアス一覧（補完用）
 */
export const QUERY_COMPLETIONS = {
  aliases: ['p', 'ptt', 'pbt', 'pme', 'pb', 'prb', 'pe', 'n'],
  columns: {
    n: [
      'notification_id',
      'server_id',
      'local_id',
      'notification_type_id',
      'actor_profile_id',
      'related_post_id',
      'created_at_ms',
      'stored_at',
      'is_read',
      // 後方互換（互換サブクエリ経由）
      'backend_url',
      'notification_type',
      'account_acct',
    ],
    p: [
      'post_id',
      'object_uri',
      'origin_server_id',
      'author_profile_id',
      'created_at_ms',
      'stored_at',
      'visibility_id',
      'language',
      'content_html',
      'spoiler_text',
      'canonical_url',
      'has_media',
      'media_count',
      'is_reblog',
      'reblog_of_uri',
      'is_sensitive',
      'has_spoiler',
      'in_reply_to_id',
      'is_local_only',
      'edited_at',
      // 後方互換（互換サブクエリ経由）
      'origin_backend_url',
      'account_acct',
      'visibility',
      'favourites_count',
      'reblogs_count',
      'replies_count',
    ],
    pb: ['post_id', 'backendUrl', 'local_id'],
    pbt: ['post_id', 'tag'],
    pe: ['post_id', 'local_account_id', 'engagement_type_id', 'emoji_id'],
    pme: ['post_id', 'acct'],
    prb: ['post_id', 'original_uri', 'reblogger_acct', 'reblogged_at_ms'],
    ptt: ['post_id', 'timelineType'],
  },
  examples: [
    {
      description: '特定ユーザーの投稿を取得する',
      query: "p.account_acct = 'user@example.com'",
    },
    {
      description: '添付メディアが存在する投稿を取得する',
      query: 'p.has_media = 1',
    },
    {
      description: 'メディアが2枚以上ある投稿を取得する',
      query: 'p.media_count >= 2',
    },
    {
      description: 'ブーストされた投稿を取得する',
      query: 'p.is_reblog = 1',
    },
    {
      description: 'ブーストを除外する',
      query: 'p.is_reblog = 0',
    },
    {
      description: 'CW（Content Warning）付きの投稿を取得する',
      query: 'p.has_spoiler = 1',
    },
    {
      description: 'リプライを除外する',
      query: 'p.in_reply_to_id IS NULL',
    },
    {
      description: '日本語の投稿のみ取得する',
      query: "p.language = 'ja'",
    },
    {
      description: '公開投稿のみ取得する',
      query: "p.visibility = 'public'",
    },
    {
      description: '未収載を含む公開投稿を取得する',
      query: "p.visibility IN ('public', 'unlisted')",
    },
    {
      description: 'ふぁぼ数が10以上の投稿を取得する',
      query: 'p.favourites_count >= 10',
    },
    {
      description: '特定ユーザーへのメンションを含む投稿を取得する',
      query: "pme.acct = 'user@example.com'",
    },
    {
      description: 'ホームタイムラインを取得する',
      query: "ptt.timelineType = 'home'",
    },
    {
      description: '指定タグの投稿を取得する',
      query: "pbt.tag = 'photo'",
    },
    {
      description: 'ローカルタイムラインで特定タグの投稿を取得する',
      query: "ptt.timelineType = 'local' AND pbt.tag = 'music'",
    },
    {
      description: 'フォロー通知のみ取得する',
      query: "n.notification_type = 'follow'",
    },
    {
      description: 'メンション通知のみ取得する',
      query: "n.notification_type = 'mention'",
    },
    {
      description: 'お気に入りとブースト通知を取得する',
      query: "n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description: '特定ユーザーからの通知を取得する',
      query: "n.account_acct = 'user@example.com'",
    },
    {
      description:
        'ホームタイムラインとお気に入り・ブースト通知を一緒に表示する',
      query:
        "ptt.timelineType = 'home' OR n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description:
        'ふぁぼ・リアクション・ブースト通知と通知元ユーザーの直後の1投稿(3分以内)をまとめて表示する',
      query:
        "n.notification_type IN ('favourite', 'reaction', 'reblog') OR EXISTS (SELECT 1 FROM notifications ntf INNER JOIN notification_types ntt ON ntt.notification_type_id = ntf.notification_type_id INNER JOIN profiles pra ON pra.profile_id = ntf.actor_profile_id WHERE ntt.code IN ('favourite', 'reaction', 'reblog') AND pra.acct = p.account_acct AND p.created_at_ms > ntf.created_at_ms AND p.created_at_ms <= ntf.created_at_ms + 180000 AND p.created_at_ms = (SELECT MIN(p2.created_at_ms) FROM posts p2 INNER JOIN profiles pr2 ON pr2.profile_id = p2.author_profile_id WHERE pr2.acct = pra.acct AND p2.created_at_ms > ntf.created_at_ms AND p2.created_at_ms <= ntf.created_at_ms + 180000))",
    },
    {
      description: '特定ユーザーがリブログした投稿を取得する',
      query: "prb.reblogger_acct = 'user@example.com'",
    },
  ],
  keywords: [
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'IN',
    'LIKE',
    'BETWEEN',
    'IS',
    'NULL',
    'IS NOT NULL',
    'GLOB',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'DISTINCT',
    // JSON 関数
    'json_extract',
    'json_array_length',
    'json_type',
    'json_valid',
    'json_each',
    'json_group_array',
    'json_group_object',
    // 文字列関数
    'length',
    'lower',
    'upper',
    'trim',
    'substr',
    'replace',
    'instr',
    // 集約・数値関数
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'abs',
    // その他の関数
    'coalesce',
    'ifnull',
    'nullif',
    'typeof',
    'cast',
  ],
} as const

/**
 * クエリの構文チェック
 *
 * EXPLAIN を使ってクエリの有効性を検証する。
 * エラーがあればメッセージを返し、問題なければ null を返す。
 */
export async function validateCustomQuery(
  whereClause: string,
): Promise<string | null> {
  if (!whereClause.trim()) return null

  // DML/DDL チェック
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(whereClause)) {
    return 'クエリに禁止されたSQL文が含まれています。WHERE句のみ使用可能です。'
  }

  const sanitized = whereClause
    .replace(/;/g, '')
    .replace(/\bLIMIT\b\s+\d+/gi, '')
    .replace(/\bOFFSET\b\s+\d+/gi, '')
    .trim()

  if (!sanitized) return null

  try {
    const handle = await getSqliteDb()

    // クエリが参照するテーブルに基づいて検証クエリを構築
    const isMixed = isMixedQuery(sanitized)
    const isNotifQuery = !isMixed && isNotificationQuery(sanitized)

    // 旧カラム名 backend_url を正しい backendUrl に修正
    const rewritten = sanitized.replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

    /** ptt 互換サブクエリ: timeline_items + timelines + channel_kinds → (post_id, timelineType) */
    const pttCompat =
      '(SELECT ti2.post_id, ck2.code AS timelineType FROM timeline_items ti2 INNER JOIN timelines t2 ON t2.timeline_id = ti2.timeline_id INNER JOIN channel_kinds ck2 ON ck2.channel_kind_id = t2.channel_kind_id WHERE ti2.post_id IS NOT NULL)'

    let sql: string
    if (isMixed) {
      sql = `
        EXPLAIN
        SELECT post_id FROM (
          SELECT p.post_id, p.created_at_ms
          FROM (
            SELECT p_inner.*,
              COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p_inner.origin_server_id), '') AS origin_backend_url,
              COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p_inner.author_profile_id), '') AS account_acct,
              COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p_inner.visibility_id), 'public') AS visibility,
              COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS favourites_count,
              COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS reblogs_count,
              COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS replies_count
            FROM posts p_inner
          ) p
          LEFT JOIN ${pttCompat} ptt
            ON p.post_id = ptt.post_id
          LEFT JOIN posts_belonging_tags pbt
            ON p.post_id = pbt.post_id
          LEFT JOIN posts_mentions pme
            ON p.post_id = pme.post_id
          LEFT JOIN posts_backends pb
            ON p.post_id = pb.post_id
          LEFT JOIN posts_reblogs prb
            ON p.post_id = prb.post_id
          LEFT JOIN (
            SELECT n2.*,
              COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = n2.server_id), '') AS backend_url,
              COALESCE((SELECT nt2.code FROM notification_types nt2 WHERE nt2.notification_type_id = n2.notification_type_id), '') AS notification_type,
              COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.profile_id = n2.actor_profile_id), '') AS account_acct
            FROM notifications n2
          ) n ON 0 = 1
          WHERE (${rewritten})
          UNION ALL
          SELECT n.notification_id, n.created_at_ms
          FROM (
            SELECT n2.*,
              COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = n2.server_id), '') AS backend_url,
              COALESCE((SELECT nt2.code FROM notification_types nt2 WHERE nt2.notification_type_id = n2.notification_type_id), '') AS notification_type,
              COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.profile_id = n2.actor_profile_id), '') AS account_acct
            FROM notifications n2
          ) n
          LEFT JOIN (
            SELECT p2.*,
              COALESCE((SELECT sv3.base_url FROM servers sv3 WHERE sv3.server_id = p2.origin_server_id), '') AS origin_backend_url,
              COALESCE((SELECT pr4.acct FROM profiles pr4 WHERE pr4.profile_id = p2.author_profile_id), '') AS account_acct
            FROM posts p2
          ) p ON 0 = 1
          LEFT JOIN ${pttCompat} ptt
            ON 0 = 1
          LEFT JOIN posts_belonging_tags pbt
            ON 0 = 1
          LEFT JOIN posts_mentions pme
            ON 0 = 1
          LEFT JOIN posts_backends pb
            ON 0 = 1
          LEFT JOIN posts_reblogs prb
            ON 0 = 1
          WHERE (${rewritten})
        )
        LIMIT 1;
      `
    } else if (isNotifQuery) {
      sql = `
        EXPLAIN
        SELECT DISTINCT n.notification_id
        FROM (
          SELECT n2.*,
            COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = n2.server_id), '') AS backend_url,
            COALESCE((SELECT nt2.code FROM notification_types nt2 WHERE nt2.notification_type_id = n2.notification_type_id), '') AS notification_type,
            COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.profile_id = n2.actor_profile_id), '') AS account_acct
          FROM notifications n2
        ) n
        WHERE (${rewritten})
        LIMIT 1;
      `
    } else {
      sql = `
        EXPLAIN
        SELECT DISTINCT p.post_id
        FROM (
          SELECT p_inner.*,
            COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p_inner.origin_server_id), '') AS origin_backend_url,
            COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p_inner.author_profile_id), '') AS account_acct,
            COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p_inner.visibility_id), 'public') AS visibility,
            COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS favourites_count,
            COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS reblogs_count,
            COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS replies_count
          FROM posts p_inner
        ) p
        LEFT JOIN ${pttCompat} ptt
          ON p.post_id = ptt.post_id
        LEFT JOIN posts_belonging_tags pbt
          ON p.post_id = pbt.post_id
        LEFT JOIN posts_mentions pme
          ON p.post_id = pme.post_id
        LEFT JOIN posts_backends pb
          ON p.post_id = pb.post_id
        LEFT JOIN posts_reblogs prb
          ON p.post_id = prb.post_id
        WHERE (${rewritten})
        LIMIT 1;
      `
    }
    await handle.execAsync(sql)
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return `クエリエラー: ${message}`
  }
}

/**
 * DB に保存されている全タグ名を取得する（補完用）
 */
export async function getDistinctTags(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT tag FROM posts_belonging_tags ORDER BY tag;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * DB に保存されている全タイムラインタイプを取得する（補完用）
 */
export async function getDistinctTimelineTypes(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT ck.code FROM timelines t INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id ORDER BY ck.code;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値を DB から取得する（補完用）
 *
 * statuses テーブルの backendUrl 等の値を返す。
 */
/** 許可リスト（安全なテーブル＋カラムの組み合わせ） */
const ALLOWED_COLUMN_VALUES: Record<string, string[]> = {
  channel_kinds: ['code'],
  notification_types: ['code'],
  posts: ['object_uri', 'language'],
  posts_backends: ['backendUrl', 'local_id'],
  posts_belonging_tags: ['tag'],
  posts_mentions: ['acct'],
  posts_reblogs: ['original_uri', 'reblogger_acct'],
  profiles: ['acct'],
  servers: ['base_url'],
  visibility_types: ['code'],
}

/** エイリアスからテーブル名・カラム名へのマッピング */
export const ALIAS_TO_TABLE: Record<
  string,
  { table: string; columns: Record<string, string> }
> = {
  n: {
    columns: {},
    table: 'notifications',
  },
  p: {
    columns: {
      language: 'language',
      object_uri: 'object_uri',
    },
    table: 'posts',
  },
  pb: {
    columns: {
      backend_url: 'backendUrl',
      backendUrl: 'backendUrl',
      local_id: 'local_id',
    },
    table: 'posts_backends',
  },
  pbt: {
    columns: {
      tag: 'tag',
    },
    table: 'posts_belonging_tags',
  },
  pe: {
    columns: {
      engagement_type_id: 'engagement_type_id',
    },
    table: 'post_engagements',
  },
  pme: {
    columns: {
      acct: 'acct',
    },
    table: 'posts_mentions',
  },
  prb: {
    columns: {
      original_uri: 'original_uri',
      reblogger_acct: 'reblogger_acct',
    },
    table: 'posts_reblogs',
  },
  ptt: {
    columns: {
      timelineType: 'code',
    },
    table: 'channel_kinds',
  },
}

/**
 * 互換カラム用のテーブル・カラムオーバーライド
 *
 * v13 で別テーブルに移動したカラムの値補完を実現するために、
 * エイリアス＋カラム名から実際のテーブル・カラムを解決する。
 */
const COLUMN_TABLE_OVERRIDE: Record<
  string,
  Record<string, { table: string; column: string }>
> = {
  n: {
    account_acct: { column: 'acct', table: 'profiles' },
    backend_url: { column: 'base_url', table: 'servers' },
    notification_type: { column: 'code', table: 'notification_types' },
  },
  p: {
    account_acct: { column: 'acct', table: 'profiles' },
    origin_backend_url: { column: 'backendUrl', table: 'posts_backends' },
    visibility: { column: 'code', table: 'visibility_types' },
  },
}

export async function getDistinctColumnValues(
  table: string,
  column: string,
  maxResults = 20,
): Promise<string[]> {
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(column)) return []

  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != '' ORDER BY "${column}" LIMIT ?;`,
      { bind: [maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値をプレフィクス検索で取得する（補完用）
 *
 * エイリアス (p, pbt, pme 等) とカラム名から実テーブルを解決し、
 * 入力中のプレフィクスに一致する値を DB から検索して返す。
 */
export async function searchDistinctColumnValues(
  alias: string,
  column: string,
  prefix: string,
  maxResults = 20,
): Promise<string[]> {
  // 互換カラムのオーバーライドを優先
  const override = COLUMN_TABLE_OVERRIDE[alias]?.[column]
  let table: string
  let realColumn: string

  if (override) {
    table = override.table
    realColumn = override.column
  } else {
    const mapping = ALIAS_TO_TABLE[alias]
    if (!mapping) return []
    const col = mapping.columns[column]
    if (!col) return []
    table = mapping.table
    realColumn = col
  }

  if (!ALLOWED_COLUMN_VALUES[table]?.includes(realColumn)) return []

  try {
    const handle = await getSqliteDb()
    // LIKE でプレフィクスフィルタ（ESCAPE でワイルドカード文字を安全にエスケープ）
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${realColumn}" FROM "${table}" WHERE "${realColumn}" IS NOT NULL AND "${realColumn}" != '' AND "${realColumn}" LIKE ? ESCAPE '\\' ORDER BY "${realColumn}" LIMIT ?;`,
      { bind: [`${escaped}%`, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}
