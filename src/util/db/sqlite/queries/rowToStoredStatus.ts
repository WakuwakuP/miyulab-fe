/**
 * インラインクエリ (STATUS_SELECT) の行データ → SqliteStoredStatus 変換
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

import type { Entity } from 'megalodon'
import {
  editedAtMsToIso,
  parseEmojiReactions,
  parseEmojis,
  parseInlinePoll,
  parseMediaAttachments,
  parseMentions,
} from './statusMapperParsers'
import type { SqliteStoredStatus, TimelineType } from './statusMapperTypes'

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
