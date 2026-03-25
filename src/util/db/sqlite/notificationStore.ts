/**
 * SQLite ベースの Notification ストア
 *
 * v13 スキーマでは json カラムを廃止し、正規化テーブルから
 * Entity.Notification を構築する。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from './connection'

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
  storedAt: number
}

/**
 * 正規化テーブルから Entity.Notification を構築するための SELECT 句
 */
export const NOTIFICATION_SELECT = `
  n.notification_id,
  COALESCE(sv.base_url, '') AS backendUrl,
  n.created_at_ms,
  n.stored_at,
  COALESCE(nt.code, '') AS notification_type,
  n.local_id,
  n.is_read,
  COALESCE(ap.acct, '') AS actor_acct,
  COALESCE(ap.username, '') AS actor_username,
  COALESCE(ap.display_name, '') AS actor_display_name,
  COALESCE(ap.avatar_url, '') AS actor_avatar,
  COALESCE(ap.header_url, '') AS actor_header,
  COALESCE(ap.locked, 0) AS actor_locked,
  COALESCE(ap.bot, 0) AS actor_bot,
  COALESCE(ap.actor_uri, '') AS actor_url,
  rp.post_id AS rp_post_id,
  COALESCE(rp.content_html, '') AS rp_content,
  COALESCE(rp.spoiler_text, '') AS rp_spoiler_text,
  rp.canonical_url AS rp_url,
  rp.object_uri AS rp_uri,
  rp.created_at_ms AS rp_created_at_ms,
  COALESCE(rp.is_sensitive, 0) AS rp_sensitive,
  COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = rp.visibility_id), 'public') AS rp_visibility,
  rp.language AS rp_language,
  COALESCE(rppr.acct, '') AS rp_author_acct,
  COALESCE(rppr.username, '') AS rp_author_username,
  COALESCE(rppr.display_name, '') AS rp_author_display_name,
  COALESCE(rppr.avatar_url, '') AS rp_author_avatar,
  COALESCE(rppr.actor_uri, '') AS rp_author_url,
  COALESCE(
    (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rp.post_id AND rpb.backendUrl = sv.base_url LIMIT 1),
    (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rp.post_id ORDER BY rpb.backendUrl LIMIT 1)
  ) AS rp_local_id,
  rp.in_reply_to_id AS rp_in_reply_to_id,
  rp.edited_at AS rp_edited_at,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rp.post_id AND pce.usage_context = 'status') AS rp_status_emojis_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rp.post_id AND pce.usage_context = 'account') AS rp_account_emojis_json,
  (SELECT json_object('id', pl.poll_id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.poll_id ORDER BY po.option_index)) FROM polls pl WHERE pl.post_id = rp.post_id) AS rp_poll_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM profile_custom_emojis pce2 INNER JOIN custom_emojis ce ON pce2.emoji_id = ce.emoji_id WHERE pce2.profile_id = ap.profile_id) AS actor_emojis_json,
  COALESCE(apa.remote_account_id, '') AS actor_account_id,
  COALESCE(rppa.remote_account_id, '') AS rp_author_account_id,
  rpps.emoji_reactions_json AS rp_emoji_reactions_json,
  CASE WHEN rp.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = rp.post_id ORDER BY pm.sort_order) ELSE NULL END AS rp_media_json,
  (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = rp.post_id) AS rp_mentions_json`

export const NOTIFICATION_BASE_JOINS = `
  LEFT JOIN servers sv ON n.server_id = sv.server_id
  LEFT JOIN notification_types nt ON n.notification_type_id = nt.notification_type_id
  LEFT JOIN profiles ap ON n.actor_profile_id = ap.profile_id
  LEFT JOIN posts rp ON n.related_post_id = rp.post_id
  LEFT JOIN profiles rppr ON rp.author_profile_id = rppr.profile_id
  LEFT JOIN post_stats rpps ON rp.post_id = rpps.post_id
  LEFT JOIN profile_aliases apa ON apa.profile_id = ap.profile_id AND apa.server_id = n.server_id
  LEFT JOIN profile_aliases rppa ON rppa.profile_id = rppr.profile_id AND rppa.server_id = n.server_id`

/**
 * row layout:
 *   [0] notification_id  [1] backendUrl      [2] created_at_ms
 *   [3] stored_at        [4] notification_type [5] local_id
 *   [6] is_read
 *   [7] actor_acct       [8] actor_username   [9] actor_display_name
 *   [10] actor_avatar    [11] actor_header    [12] actor_locked
 *   [13] actor_bot       [14] actor_url
 *   [15] rp_post_id      [16] rp_content      [17] rp_spoiler_text
 *   [18] rp_url          [19] rp_uri          [20] rp_created_at_ms
 *   [21] rp_sensitive     [22] rp_visibility   [23] rp_language
 *   [24] rp_author_acct  [25] rp_author_username [26] rp_author_display_name
 *   [27] rp_author_avatar [28] rp_author_url  [29] rp_local_id
 *   [30] rp_in_reply_to_id [31] rp_edited_at
 *   [32] rp_status_emojis_json [33] rp_account_emojis_json
 *   [34] rp_poll_json
 *   [35] actor_emojis_json
 *   [36] actor_account_id [37] rp_author_account_id
 *   [38] rp_emoji_reactions_json
 *   [39] rp_media_json    [40] rp_mentions_json
 */
export function rowToStoredNotification(
  row: (string | number | null)[],
): SqliteStoredNotification {
  const rpPostId = row[15] as number | null
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
        username: m.acct.split('@')[0],
      }))
  }

  if (rpPostId !== null) {
    const rpCreatedAtMs = row[20] as number | null
    const rpStatusEmojisJson = row[32] as string | null
    const rpAccountEmojisJson = row[33] as string | null
    const rpPollJson = row[34] as string | null
    status = {
      account: {
        acct: (row[24] as string) ?? '',
        avatar: (row[27] as string) ?? '',
        avatar_static: (row[27] as string) ?? '',
        bot: false,
        created_at: '',
        display_name: (row[26] as string) ?? '',
        emojis: parseEmojis(rpAccountEmojisJson),
        fields: [],
        followers_count: 0,
        following_count: 0,
        group: null,
        header: '',
        header_static: '',
        id: (row[37] as string) || '',
        limited: null,
        locked: false,
        moved: null,
        noindex: null,
        note: '',
        statuses_count: 0,
        suspended: null,
        url: (row[28] as string) ?? '',
        username: (row[25] as string) ?? '',
      },
      application: null,
      bookmarked: false,
      card: null,
      content: (row[16] as string) ?? '',
      created_at: rpCreatedAtMs ? new Date(rpCreatedAtMs).toISOString() : '',
      edited_at: row[31] as string | null,
      emoji_reactions: parseEmojiReactions(row[38] as string | null),
      emojis: parseEmojis(rpStatusEmojisJson),
      favourited: null,
      favourites_count: 0,
      id: (row[29] as string) ?? '',
      in_reply_to_account_id: null,
      in_reply_to_id: row[30] as string | null,
      language: row[23] as string | null,
      media_attachments: parseMediaAttachments(row[39] as string | null),
      mentions: parseMentions(row[40] as string | null),
      muted: null,
      pinned: null,
      plain_content: null,
      poll: rpPollJson ? parsePoll(rpPollJson) : null,
      quote: null,
      quote_approval: { automatic: [], current_user: '', manual: [] },
      reblog: null,
      reblogged: null,
      reblogs_count: 0,
      replies_count: 0,
      sensitive: (row[21] as number) === 1,
      spoiler_text: (row[17] as string) ?? '',
      tags: [],
      uri: (row[19] as string) ?? '',
      url: (row[18] as string | null) ?? undefined,
      visibility: ((row[22] as string) ?? 'public') as Entity.StatusVisibility,
    }
  }

  return {
    account: {
      acct: (row[7] as string) ?? '',
      avatar: (row[10] as string) ?? '',
      avatar_static: (row[10] as string) ?? '',
      bot: (row[13] as number) === 1,
      created_at: '',
      display_name: (row[9] as string) ?? '',
      emojis: parseEmojis(row[35] as string | null),
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[11] as string) ?? '',
      header_static: (row[11] as string) ?? '',
      id: (row[36] as string) || '',
      limited: null,
      locked: (row[12] as number) === 1,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: (row[14] as string) ?? '',
      username: (row[8] as string) ?? '',
    },
    backendUrl: (row[1] as string) ?? '',
    created_at: new Date(row[2] as number).toISOString(),
    created_at_ms: row[2] as number,
    id: (row[5] as string) ?? String(row[0]),
    // SqliteStoredNotification extra fields
    notification_id: row[0] as number,
    status,
    storedAt: row[3] as number,
    type: (row[4] as string) ?? '',
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
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()

  const binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `WHERE sv.base_url IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const sql = `
    SELECT ${NOTIFICATION_SELECT}
    FROM notifications n
    ${NOTIFICATION_BASE_JOINS}
    ${backendFilter}
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
 * v7: statusId は特定バックエンドのローカル ID のため、
 * posts_backends 経由でグローバルな status を特定し、
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
