/**
 * バッチクエリ (STATUS_BASE_SELECT + BatchMaps) の行データ → SqliteStoredStatus 変換
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

import type { Entity } from 'megalodon'
import type { BatchMaps } from './statusBatch'
import {
  editedAtMsToIso,
  parseBatchPoll,
  parseEmojiReactions,
  parseEmojis,
  parseInteractions,
  parseMediaAttachments,
  parseMentions,
} from './statusMapperParsers'
import type { SqliteStoredStatus, TimelineType } from './statusMapperTypes'

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
  const profileEmojisJson = maps.profileEmojisMap.get(postId) ?? null
  const pollJson = maps.pollsMap.get(postId) ?? null
  const emojiReactionsJson = (row[50] as string | null) ?? null

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
    const rbProfileEmojisJson = maps.profileEmojisMap.get(rbPostId) ?? null
    const rbPollJson = maps.pollsMap.get(rbPostId) ?? null
    const rbEmojiReactionsJson = (row[51] as string | null) ?? null

    const rbEditedAtMs = row[33] as number | null

    reblog = {
      account: {
        acct: (row[36] as string) ?? '',
        avatar: (row[39] as string) ?? '',
        avatar_static: (row[39] as string) ?? '',
        bot: (row[42] as number) === 1,
        created_at: '',
        display_name: (row[38] as string) ?? '',
        emojis: parseEmojis(rbProfileEmojisJson),
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
      emojis: parseEmojis(profileEmojisJson),
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
