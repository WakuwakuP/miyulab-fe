/**
 * SQLite ベースの Notification ストア
 *
 * 新スキーマでは json カラムを廃止し、正規化テーブルから
 * Entity.Notification を構築する。
 *
 * - notifications.id (旧 notification_id)
 * - local_accounts.backend_url (旧 servers.base_url)
 * - notification_types.name (旧 code)
 * - post_mentions (旧 posts_mentions)
 * - custom_emojis.url (旧 image_url)
 * - posts.id (旧 post_id)
 * - poll_options.sort_order (旧 option_index)
 * - poll_votes で voted/own_votes を取得
 * - post_custom_emojis.custom_emoji_id (旧 emoji_id)
 * - profile_custom_emojis.custom_emoji_id (旧 emoji_id)
 * - post_backend_ids (旧 posts_backends)
 * - posts.edited_at_ms INTEGER (旧 edited_at TEXT)
 * - profile_aliases 廃止
 * - stored_at 廃止
 * - has_media → EXISTS サブクエリ
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from './connection'
import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
} from './queries/notificationSelect'

export { NOTIFICATION_BASE_JOINS, NOTIFICATION_SELECT }

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

/** クエリの最大行数上限 */
const MAX_QUERY_LIMIT = 2147483647

export interface SqliteStoredNotification extends Entity.Notification {
  notification_id: number
  backendUrl: string
  created_at_ms: number
}

/**
 * 正規化テーブルから Entity.Notification を構築するための SELECT 句
 *
 * row layout:
 *   [0] id (notification PK)
 *   [1] backendUrl (from local_accounts.backend_url)
 *   [2] created_at_ms
 *   [3] notification_type   [4] local_id          [5] is_read
 *   [6] actor_acct          [7] actor_username     [8] actor_display_name
 *   [9] actor_avatar        [10] actor_header      [11] actor_locked
 *   [12] actor_bot          [13] actor_url
 *   [14] rp_post_id         [15] rp_content        [16] rp_spoiler_text
 *   [17] rp_url             [18] rp_uri            [19] rp_created_at_ms
 *   [20] rp_sensitive       [21] rp_visibility     [22] rp_language
 *   [23] rp_author_acct     [24] rp_author_username [25] rp_author_display_name
 *   [26] rp_author_avatar   [27] rp_author_url     [28] rp_local_id
 *   [29] rp_in_reply_to_id  [30] rp_edited_at_ms
 *   [31] rp_status_emojis_json [32] rp_account_emojis_json
 *   [33] rp_poll_json
 *   [34] actor_emojis_json
 *   [35] rp_emoji_reactions_json
 *   [36] rp_media_json      [37] rp_mentions_json
 *   [38] rp_voted           [39] rp_own_votes_json
 *   [40] reaction_name      [41] reaction_url
 */
// NOTIFICATION_SELECT / NOTIFICATION_BASE_JOINS は
// queries/notificationSelect.ts に定義し、このファイルから re-export している。
// Worker バンドル（outputExecutor.ts 等）が connection.ts への依存を
// 持たないよう、SQL 定数を独立モジュールに分離している。

/**
 * row layout:
 *   [0] id (notification PK)
 *   [1] backendUrl (from local_accounts.backend_url)
 *   [2] created_at_ms
 *   [3] notification_type   [4] local_id          [5] is_read
 *   [6] actor_acct          [7] actor_username     [8] actor_display_name
 *   [9] actor_avatar        [10] actor_header      [11] actor_locked
 *   [12] actor_bot          [13] actor_url
 *   [14] rp_post_id         [15] rp_content        [16] rp_spoiler_text
 *   [17] rp_url             [18] rp_uri            [19] rp_created_at_ms
 *   [20] rp_sensitive       [21] rp_visibility     [22] rp_language
 *   [23] rp_author_acct     [24] rp_author_username [25] rp_author_display_name
 *   [26] rp_author_avatar   [27] rp_author_url     [28] rp_local_id
 *   [29] rp_in_reply_to_id  [30] rp_edited_at_ms
 *   [31] rp_status_emojis_json [32] rp_account_emojis_json
 *   [33] rp_poll_json
 *   [34] actor_emojis_json
 *   [35] rp_emoji_reactions_json
 *   [36] rp_media_json      [37] rp_mentions_json
 *   [38] rp_voted           [39] rp_own_votes_json
 *   [40] reaction_name      [41] reaction_url
 */
export function rowToStoredNotification(
  row: (string | number | null)[],
): SqliteStoredNotification {
  const rpPostId = row[14] as number | null
  let status: Entity.Status | undefined

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

  const parsePoll = (
    json: string,
    voted: number | null,
    ownVotesJson: string | null,
  ): Entity.Poll => {
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

    let ownVotes: number[] | undefined
    if (ownVotesJson) {
      try {
        ownVotes = JSON.parse(ownVotesJson) as number[]
      } catch {
        ownVotes = undefined
      }
    }

    return {
      expired: p.expires_at ? new Date(p.expires_at) < new Date() : false,
      expires_at: p.expires_at,
      id: String(p.id),
      multiple: p.multiple === 1,
      options: options.map((o) => ({
        title: o.title,
        votes_count: o.votes_count,
      })),
      voted: voted === 1,
      votes_count: p.votes_count,
      ...(ownVotes ? { own_votes: ownVotes } : {}),
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
        username: m.acct.split('@')[0],
      }))
  }

  if (rpPostId !== null) {
    const rpCreatedAtMs = row[19] as number | null
    const rpStatusEmojisJson = row[31] as string | null
    const rpAccountEmojisJson = row[32] as string | null
    const rpPollJson = row[33] as string | null
    const rpVoted = row[38] as number | null
    const rpOwnVotesJson = row[39] as string | null
    const rpEditedAtMs = row[30] as number | null

    status = {
      account: {
        acct: (row[23] as string) ?? '',
        avatar: (row[26] as string) ?? '',
        avatar_static: (row[26] as string) ?? '',
        bot: false,
        created_at: '',
        display_name: (row[25] as string) ?? '',
        emojis: parseEmojis(rpAccountEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: '',
        header_static: '',
        id: '',
        limited: null,
        locked: false,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[27] as string) ?? '',
        username: (row[24] as string) ?? '',
      },
      application: null,
      bookmarked: false,
      card: null,
      content: (row[15] as string) ?? '',
      created_at: rpCreatedAtMs ? new Date(rpCreatedAtMs).toISOString() : '',
      edited_at: rpEditedAtMs ? new Date(rpEditedAtMs).toISOString() : null,
      emoji_reactions: parseEmojiReactions(row[35] as string | null),
      emojis: parseEmojis(rpStatusEmojisJson),
      favourited: null,
      favourites_count: 0,
      id: (row[28] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[29] as string | null,
      language: row[22] as string | null,
      media_attachments: parseMediaAttachments(row[36] as string | null),
      mentions: parseMentions(row[37] as string | null),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rpPollJson ? parsePoll(rpPollJson, rpVoted, rpOwnVotesJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: null,
      reblogs_count: 0,
      replies_count: 0,
      sensitive: (row[20] as number) === 1,
      spoiler_text: (row[16] as string) ?? '',
      tags: [],
      uri: (row[18] as string) ?? '',
      url: (row[17] as string | null) ?? undefined,
      visibility: ((row[21] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  const reactionName = row[40] as string | null
  const reactionUrl = row[41] as string | null
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
      acct: (row[6] as string) ?? '',
      avatar: (row[9] as string) ?? '',
      avatar_static: (row[9] as string) ?? '',
      bot: (row[12] as number) === 1,
      created_at: '',
      display_name: (row[8] as string) ?? '',
      emojis: parseEmojis(row[34] as string | null),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[10] as string) ?? '',
      header_static: (row[10] as string) ?? '',
      id: '',
      limited: null,
      locked: (row[11] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[13] as string) ?? '',
      username: (row[7] as string) ?? '',
    },
    backendUrl: (row[1] as string) ?? '',
    created_at: new Date(row[2] as number).toISOString(),
    created_at_ms: row[2] as number,
    id: (row[4] as string) ?? String(row[0]),
    // SqliteStoredNotification extra fields
    notification_id: row[0] as number,
    ...(reaction ? { reaction } : {}),
    status,
    type: (row[3] as string) ?? '',
  }
}

/**
 * Notification を追加 — Worker に委譲
 */
export async function addNotification(
  notification: Entity.Notification,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    notificationJson: JSON.stringify(notification),
    type: 'addNotification',
  })
}

/**
 * 複数の Notification を一括追加 — Worker に委譲
 */
export async function bulkAddNotifications(
  notifications: Entity.Notification[],
  backendUrl: string,
): Promise<void> {
  if (notifications.length === 0) return

  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    notificationsJson: notifications.map((n) => JSON.stringify(n)),
    type: 'bulkAddNotifications',
  })
}

/**
 * Notification を取得 — execAsync で直接クエリ
 */
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
  localAccountId?: number | null,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()

  const binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `WHERE la.backend_url IN (${placeholders})`
    binds.push(...backendUrls)
  }

  let localAccountFilter = ''
  if (localAccountId != null) {
    localAccountFilter = `${backendFilter ? 'AND' : 'WHERE'} n.local_account_id = ?`
    binds.push(localAccountId)
  }

  const sql = `
    SELECT ${NOTIFICATION_SELECT}
    FROM notifications n
    ${NOTIFICATION_BASE_JOINS}
    ${backendFilter}
    ${localAccountFilter}
    ORDER BY n.created_at_ms DESC
    LIMIT ?;
  `
  binds.push(limit ?? MAX_QUERY_LIMIT)

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredNotification)
}

/**
 * Notification 内の Status アクション状態を更新 — Worker に委譲
 *
 * statusId は特定バックエンドのローカル ID のため、
 * post_backend_ids 経由でグローバルな status を特定し、
 * その status.uri に紐づく通知も含めて更新する。
 */
export async function updateNotificationStatusAction(
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
    type: 'updateNotificationStatusAction',
    value,
  })
}
