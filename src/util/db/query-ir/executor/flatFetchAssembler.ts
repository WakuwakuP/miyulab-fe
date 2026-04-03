// ============================================================
// Flat Fetch — Assembler
//
// POST_FLAT_SELECT / NOTIFICATION_FLAT_SELECT の行データと
// BatchMaps を結合して Entity を組み立てる。
// Worker 内で実行される。
// ============================================================

import type { Entity } from 'megalodon'
import type { SqliteStoredNotification } from '../../sqlite/notificationStore'
import type { BatchMaps } from '../../sqlite/queries/statusBatch'
import {
  editedAtMsToIso,
  parseBatchPoll,
  parseEmojiReactions,
  parseEmojis,
  parseInteractions,
  parseMediaAttachments,
  parseMentions,
  type SqliteStoredStatus,
  type TimelineType,
} from '../../sqlite/queries/statusMapper'

// ================================================================
// POST_FLAT_SELECT カラムインデックス
// ================================================================

/** POST_FLAT_SELECT の列番号マッピング（flatSelect.ts のカラムレイアウトと一致） */
const P = {
  AUTHOR_ACCOUNT_ID: 29,
  AUTHOR_ACCT: 15,
  AUTHOR_AVATAR: 18,
  AUTHOR_BOT: 21,
  AUTHOR_DISPLAY_NAME: 17,
  AUTHOR_HEADER: 19,
  AUTHOR_LOCKED: 20,
  AUTHOR_PROFILE_ID: 14,
  AUTHOR_URL: 22,
  AUTHOR_USERNAME: 16,
  BACKEND_URL: 27,
  CANONICAL_URL: 2,
  CONTENT_HTML: 3,
  CREATED_AT_MS: 4,
  EDITED_AT_MS: 5,
  EMOJI_REACTIONS_JSON: 26,
  FAVOURITES_COUNT: 25,
  IN_REPLY_TO_ID: 9,
  IS_LOCAL_ONLY: 12,
  IS_REBLOG: 11,
  IS_SENSITIVE: 7,
  LANGUAGE: 6,
  LOCAL_ID: 28,
  OBJECT_URI: 1,
  POST_ID: 0,
  REBLOG_OF_POST_ID: 10,
  REBLOGS_COUNT: 24,
  REPLIES_COUNT: 23,
  SPOILER_TEXT: 8,
  VISIBILITY_CODE: 13,
} as const

// ================================================================
// NOTIFICATION_FLAT_SELECT カラムインデックス
// ================================================================

/** NOTIFICATION_FLAT_SELECT の列番号マッピング（flatSelect.ts のカラムレイアウトと一致） */
const N = {
  ACTOR_ACCT: 11,
  ACTOR_AVATAR: 14,
  ACTOR_BOT: 17,
  ACTOR_DISPLAY_NAME: 13,
  ACTOR_HEADER: 15,
  ACTOR_LOCKED: 16,
  ACTOR_PROFILE_ID: 8,
  ACTOR_URL: 18,
  ACTOR_USERNAME: 12,
  BACKEND_URL: 10,
  CREATED_AT_MS: 3,
  ID: 0,
  IS_READ: 4,
  LOCAL_ACCOUNT_ID: 1,
  LOCAL_ID: 2,
  NOTIFICATION_TYPE: 9,
  REACTION_NAME: 6,
  REACTION_URL: 7,
  RELATED_POST_ID: 5,
} as const

// ================================================================
// Post assembler
// ================================================================

/**
 * POST_FLAT_SELECT の1行 + BatchMaps から SqliteStoredStatus を組み立てる。
 *
 * reblog フィールドは null のまま返す。
 * リブログのリンクは呼び出し側で postMap を使って行う。
 */
export function assemblePostFromFlat(
  row: (string | number | null)[],
  maps: BatchMaps,
): SqliteStoredStatus {
  const postId = row[P.POST_ID] as number

  // ── Batch Map lookup ──
  const interactionsJson = maps.interactionsMap.get(postId) ?? null
  const interactions = parseInteractions(interactionsJson)
  const mediaJson = maps.mediaMap.get(postId) ?? null
  const mentionsJson = maps.mentionsMap.get(postId) ?? null
  const timelineTypesJson = maps.timelineTypesMap.get(postId) ?? null
  const belongingTagsJson = maps.belongingTagsMap.get(postId) ?? null
  const customEmojisJson = maps.customEmojisMap.get(postId) ?? null
  const profileEmojisJson = maps.profileEmojisMap.get(postId) ?? null
  const pollJson = maps.pollsMap.get(postId) ?? null
  const emojiReactionsJson =
    (row[P.EMOJI_REACTIONS_JSON] as string | null) ?? null

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  const editedAtMs = row[P.EDITED_AT_MS] as number | null

  return {
    account: {
      acct: (row[P.AUTHOR_ACCT] as string) ?? '',
      avatar: (row[P.AUTHOR_AVATAR] as string) ?? '',
      avatar_static: (row[P.AUTHOR_AVATAR] as string) ?? '',
      bot: (row[P.AUTHOR_BOT] as number) === 1,
      created_at: '',
      display_name: (row[P.AUTHOR_DISPLAY_NAME] as string) ?? '',
      emojis: parseEmojis(profileEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[P.AUTHOR_HEADER] as string) ?? '',
      header_static: (row[P.AUTHOR_HEADER] as string) ?? '',
      id: '',
      limited: null,
      locked: (row[P.AUTHOR_LOCKED] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[P.AUTHOR_URL] as string) ?? '',
      username: (row[P.AUTHOR_USERNAME] as string) ?? '',
    },
    application: null,
    backendUrl: (row[P.BACKEND_URL] as string) ?? '',
    belongingTags,
    bookmarked: interactions?.is_bookmarked === 1,
    card: null,
    content: (row[P.CONTENT_HTML] as string) ?? '',
    created_at: new Date(row[P.CREATED_AT_MS] as number).toISOString(),
    created_at_ms: row[P.CREATED_AT_MS] as number,
    edited_at: editedAtMsToIso(editedAtMs),
    edited_at_ms: editedAtMs,
    emoji_reactions: parseEmojiReactions(emojiReactionsJson),
    emojis: parseEmojis(customEmojisJson),
    favourited: interactions?.is_favourited === 1,
    favourites_count: (row[P.FAVOURITES_COUNT] as number) ?? 0,
    id: (row[P.LOCAL_ID] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[P.IN_REPLY_TO_ID] as string | null,
    language: row[P.LANGUAGE] as string | null,
    media_attachments: parseMediaAttachments(mediaJson),
    mentions: parseMentions(mentionsJson),
    muted: null,
    pinned: null,
    plain_content: null,
    poll: pollJson ? parseBatchPoll(pollJson) : null,
    post_id: postId,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog: null,
    reblogged: interactions?.is_reblogged === 1,
    reblogs_count: (row[P.REBLOGS_COUNT] as number) ?? 0,
    replies_count: (row[P.REPLIES_COUNT] as number) ?? 0,
    sensitive: (row[P.IS_SENSITIVE] as number) === 1,
    spoiler_text: (row[P.SPOILER_TEXT] as string) ?? '',
    tags: belongingTags.map((t) => ({ name: t, url: '' })),
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as (TimelineType | null)[]).filter(
          (t): t is TimelineType => t !== null,
        )
      : [],
    uri: (row[P.OBJECT_URI] as string) ?? '',
    url: (row[P.CANONICAL_URL] as string | null) ?? undefined,
    visibility: ((row[P.VISIBILITY_CODE] as string) ??
      'public') as Entity.StatusVisibility,
  }
}

// ================================================================
// Notification assembler
// ================================================================

/**
 * NOTIFICATION_FLAT_SELECT の1行から SqliteStoredNotification を組み立てる。
 *
 * @param row — NOTIFICATION_FLAT_SELECT の1行 (19カラム)
 * @param postMap — 全投稿の Map（related_post_id で参照する）
 * @param actorEmojisMap — profile_id → カスタム絵文字 JSON の Map
 */
export function assembleNotificationFromFlat(
  row: (string | number | null)[],
  postMap: Map<number, SqliteStoredStatus>,
  actorEmojisMap: Map<number, string>,
): SqliteStoredNotification {
  const relatedPostId = row[N.RELATED_POST_ID] as number | null
  const status = relatedPostId != null ? postMap.get(relatedPostId) : undefined

  const actorProfileId = row[N.ACTOR_PROFILE_ID] as number | null
  const actorEmojisJson =
    actorProfileId != null ? (actorEmojisMap.get(actorProfileId) ?? null) : null

  const reactionName = row[N.REACTION_NAME] as string | null
  const reactionUrl = row[N.REACTION_URL] as string | null
  const reaction: Entity.Reaction | undefined =
    reactionName != null
      ? {
          accounts: [],
          count: 1,
          me: false,
          name: reactionName,
          ...(reactionUrl ? { static_url: reactionUrl, url: reactionUrl } : {}),
        }
      : undefined

  return {
    account: {
      acct: (row[N.ACTOR_ACCT] as string) ?? '',
      avatar: (row[N.ACTOR_AVATAR] as string) ?? '',
      avatar_static: (row[N.ACTOR_AVATAR] as string) ?? '',
      bot: (row[N.ACTOR_BOT] as number) === 1,
      created_at: '',
      display_name: (row[N.ACTOR_DISPLAY_NAME] as string) ?? '',
      emojis: parseEmojis(actorEmojisJson),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[N.ACTOR_HEADER] as string) ?? '',
      header_static: (row[N.ACTOR_HEADER] as string) ?? '',
      id: '',
      limited: null,
      locked: (row[N.ACTOR_LOCKED] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[N.ACTOR_URL] as string) ?? '',
      username: (row[N.ACTOR_USERNAME] as string) ?? '',
    },
    backendUrl: (row[N.BACKEND_URL] as string) ?? '',
    created_at: new Date(row[N.CREATED_AT_MS] as number).toISOString(),
    created_at_ms: row[N.CREATED_AT_MS] as number,
    id: (row[N.LOCAL_ID] as string) ?? String(row[N.ID]),
    notification_id: row[N.ID] as number,
    ...(reaction ? { reaction } : {}),
    status: status ?? undefined,
    type: (row[N.NOTIFICATION_TYPE] as string) ?? '',
  }
}

// ================================================================
// エクスポート定数（executor が使用するカラムインデックス）
// ================================================================

/** POST_FLAT_SELECT: post_id の列番号 */
export const POST_ID_COL = P.POST_ID

/** POST_FLAT_SELECT: reblog_of_post_id の列番号 */
export const POST_REBLOG_OF_COL = P.REBLOG_OF_POST_ID

/** NOTIFICATION_FLAT_SELECT: related_post_id の列番号 */
export const NOTIF_RELATED_POST_ID_COL = N.RELATED_POST_ID

/** NOTIFICATION_FLAT_SELECT: actor_profile_id の列番号 */
export const NOTIF_ACTOR_PROFILE_ID_COL = N.ACTOR_PROFILE_ID
