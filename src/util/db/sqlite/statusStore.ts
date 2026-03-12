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
import type { TimelineType } from '../database'
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

  const belongingTags: string[] = belongingTagsJson
    ? (JSON.parse(belongingTagsJson) as (string | null)[]).filter(
        (t): t is string => t !== null,
      )
    : []

  return {
    account: {
      acct: (row[16] as string) ?? '',
      avatar: (row[19] as string) ?? '',
      avatar_static: (row[19] as string) ?? '',
      bot: (row[22] as number) === 1,
      created_at: '',
      display_name: (row[18] as string) ?? '',
      emojis: [],
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: (row[20] as string) ?? '',
      header_static: (row[20] as string) ?? '',
      id: '',
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
    emoji_reactions: [],
    emojis: [],
    favourited: engagements.includes('favourite'),
    favourites_count: (row[26] as number) ?? 0,
    id: (row[2] as string) ?? '',
    in_reply_to_account_id: null,
    in_reply_to_id: row[14] as string | null,
    language: row[9] as string | null,
    media_attachments: mediaJson
      ? (JSON.parse(mediaJson) as (Entity.Attachment | null)[]).filter(
          (m): m is Entity.Attachment => m !== null,
        )
      : [],
    mentions: mentionsJson
      ? (JSON.parse(mentionsJson) as ({ acct: string } | null)[])
          .filter((m): m is { acct: string } => m !== null)
          .map((m) => ({
            acct: m.acct,
            id: '',
            url: '',
            username: m.acct.split('@')[0] ?? '',
          }))
      : [],
    muted: null,
    pinned: null,
    plain_content: null,
    poll: null,
    // SqliteStoredStatus extra fields
    post_id: row[0] as number,
    quote: null,
    quote_approval: { automatic: [], current_user: '', manual: [] },
    reblog: null,
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
  s.post_id,
  MIN(pb.backendUrl) AS backendUrl,
  MIN(pb.local_id) AS local_id,
  s.created_at_ms,
  s.stored_at,
  s.object_uri,
  COALESCE(s.content_html, '') AS content_html,
  COALESCE(s.spoiler_text, '') AS spoiler_text,
  s.canonical_url,
  s.language,
  COALESCE(vt.code, 'public') AS visibility_code,
  s.is_sensitive,
  s.is_reblog,
  s.reblog_of_uri,
  s.in_reply_to_id,
  s.edited_at,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.locked, 0) AS author_locked,
  COALESCE(pr.bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE((SELECT ps.replies_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS replies_count,
  COALESCE((SELECT ps.reblogs_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS reblogs_count,
  COALESCE((SELECT ps.favourites_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS favourites_count,
  (SELECT group_concat(et.code, ',') FROM post_engagements pe INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id WHERE pe.post_id = s.post_id) AS engagements_csv,
  CASE WHEN s.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = s.post_id ORDER BY pm.sort_order) ELSE NULL END AS media_json,
  (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = s.post_id) AS mentions_json,
  (SELECT json_group_array(ck.code) FROM timeline_items ti INNER JOIN timelines t ON t.timeline_id = ti.timeline_id INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id WHERE ti.post_id = s.post_id) AS timelineTypes,
  (SELECT json_group_array(tag) FROM posts_belonging_tags WHERE post_id = s.post_id) AS belongingTags`

/**
 * 正規化テーブルの基本 JOIN 句（profiles, visibility_types, posts_backends）
 */
export const STATUS_BASE_JOINS = `
  LEFT JOIN profiles pr ON s.author_profile_id = pr.profile_id
  LEFT JOIN visibility_types vt ON s.visibility_id = vt.visibility_id
  LEFT JOIN posts_backends pb ON s.post_id = pb.post_id`

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

/**
 * Status を追加または更新
 */
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusJson: JSON.stringify(status),
    tag,
    timelineType,
    type: 'upsertStatus',
  })
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

  const binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const sql = `
    SELECT ${STATUS_SELECT}
    FROM posts s
    ${STATUS_BASE_JOINS}
    INNER JOIN posts_timeline_types stt ON s.post_id = stt.post_id
    WHERE stt.timelineType = ?
      ${backendFilter}
    GROUP BY s.post_id
    ORDER BY s.created_at_ms DESC
    LIMIT ?;
  `
  binds.push(timelineType, limit ?? MAX_QUERY_LIMIT)

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
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

  const binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const sql = `
    SELECT ${STATUS_SELECT}
    FROM posts s
    ${STATUS_BASE_JOINS}
    INNER JOIN posts_belonging_tags sbt ON s.post_id = sbt.post_id
    WHERE sbt.tag = ?
      ${backendFilter}
    GROUP BY s.post_id
    ORDER BY s.created_at_ms DESC
    LIMIT ?;
  `
  binds.push(tag, limit ?? MAX_QUERY_LIMIT)

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
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
 * WHERE 句は statuses_timeline_types (stt), statuses_belonging_tags (sbt),
 * statuses (s) テーブルを参照できる。
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

  // sb. 参照を pb. に書き換え（posts_backends は常に pb で JOIN）
  // 旧カラム名 backend_url を正しい backendUrl に修正
  const rewrittenWhere = sanitized
    .replace(/\bsb\./g, 'pb.')
    .replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

  const joinLines: string[] = []
  if (refs.stt)
    joinLines.push(
      'LEFT JOIN posts_timeline_types stt\n      ON s.post_id = stt.post_id',
    )
  if (refs.sbt)
    joinLines.push(
      'LEFT JOIN posts_belonging_tags sbt\n      ON s.post_id = sbt.post_id',
    )
  if (refs.sm)
    joinLines.push(
      'LEFT JOIN posts_mentions sm\n      ON s.post_id = sm.post_id',
    )
  if (refs.sr)
    joinLines.push(
      'LEFT JOIN posts_reblogs sr\n      ON s.post_id = sr.post_id',
    )

  let backendFilter = ''
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.backendUrl IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const joinsClause =
    joinLines.length > 0 ? `\n    ${joinLines.join('\n    ')}` : ''

  // 旧カラム名の後方互換性のため posts をサブクエリでラップ
  const sql = `
    SELECT ${STATUS_SELECT}
    FROM (
      SELECT p.*,
        COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p.origin_server_id), '') AS origin_backend_url,
        COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p.author_profile_id), '') AS account_acct,
        '' AS account_id,
        COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p.visibility_id), 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS favourites_count,
        COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS reblogs_count,
        COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS replies_count
      FROM posts p
    ) s
    ${STATUS_BASE_JOINS}${joinsClause}
    WHERE (${rewrittenWhere || '1=1'})
      ${backendFilter}
    GROUP BY s.post_id
    ORDER BY s.created_at_ms DESC
    LIMIT ?
    OFFSET ?;
  `
  binds.push(limit ?? MAX_QUERY_LIMIT, offset ?? 0)

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
}

/**
 * テーブルカラム / エイリアス一覧（補完用）
 */
export const QUERY_COMPLETIONS = {
  aliases: ['s', 'stt', 'sbt', 'sm', 'sb', 'sr', 'n'],
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
    s: [
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
    sb: ['post_id', 'backendUrl', 'local_id'],
    sbt: ['post_id', 'tag'],
    sm: ['post_id', 'acct'],
    sr: ['post_id', 'original_uri', 'reblogger_acct', 'reblogged_at_ms'],
    stt: ['post_id', 'timelineType'],
  },
  examples: [
    {
      description: '特定ユーザーの投稿を取得する',
      query: "s.account_acct = 'user@example.com'",
    },
    {
      description: '添付メディアが存在する投稿を取得する',
      query: 's.has_media = 1',
    },
    {
      description: 'メディアが2枚以上ある投稿を取得する',
      query: 's.media_count >= 2',
    },
    {
      description: 'ブーストされた投稿を取得する',
      query: 's.is_reblog = 1',
    },
    {
      description: 'ブーストを除外する',
      query: 's.is_reblog = 0',
    },
    {
      description: 'CW（Content Warning）付きの投稿を取得する',
      query: 's.has_spoiler = 1',
    },
    {
      description: 'リプライを除外する',
      query: 's.in_reply_to_id IS NULL',
    },
    {
      description: '日本語の投稿のみ取得する',
      query: "s.language = 'ja'",
    },
    {
      description: '公開投稿のみ取得する',
      query: "s.visibility = 'public'",
    },
    {
      description: '未収載を含む公開投稿を取得する',
      query: "s.visibility IN ('public', 'unlisted')",
    },
    {
      description: 'ふぁぼ数が10以上の投稿を取得する',
      query: 's.favourites_count >= 10',
    },
    {
      description: '特定ユーザーへのメンションを含む投稿を取得する',
      query: "sm.acct = 'user@example.com'",
    },
    {
      description: 'ホームタイムラインを取得する',
      query: "stt.timelineType = 'home'",
    },
    {
      description: '指定タグの投稿を取得する',
      query: "sbt.tag = 'photo'",
    },
    {
      description: 'ローカルタイムラインで特定タグの投稿を取得する',
      query: "stt.timelineType = 'local' AND sbt.tag = 'music'",
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
        "stt.timelineType = 'home' OR n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description:
        'ふぁぼ・リアクション・ブースト通知と通知元ユーザーの直後の1投稿(3分以内)をまとめて表示する',
      query:
        "n.notification_type IN ('favourite', 'reaction', 'reblog') OR EXISTS (SELECT 1 FROM notifications ntf INNER JOIN notification_types ntt ON ntt.notification_type_id = ntf.notification_type_id INNER JOIN profiles pra ON pra.profile_id = ntf.actor_profile_id WHERE ntt.code IN ('favourite', 'reaction', 'reblog') AND pra.acct = s.account_acct AND s.created_at_ms > ntf.created_at_ms AND s.created_at_ms <= ntf.created_at_ms + 180000 AND s.created_at_ms = (SELECT MIN(s2.created_at_ms) FROM posts s2 INNER JOIN profiles pr2 ON pr2.profile_id = s2.author_profile_id WHERE pr2.acct = pra.acct AND s2.created_at_ms > ntf.created_at_ms AND s2.created_at_ms <= ntf.created_at_ms + 180000))",
    },
    {
      description: '特定ユーザーがリブログした投稿を取得する',
      query: "sr.reblogger_acct = 'user@example.com'",
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

    // sb. → pb. 変換（useCustomQueryTimeline と同じランタイム変換を適用）
    const rewritten = sanitized
      .replace(/\bsb\./g, 'pb.')
      .replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

    /** stt 互換サブクエリ: timeline_items + timelines + channel_kinds → (post_id, timelineType) */
    const sttCompat =
      '(SELECT ti2.post_id, ck2.code AS timelineType FROM timeline_items ti2 INNER JOIN timelines t2 ON t2.timeline_id = ti2.timeline_id INNER JOIN channel_kinds ck2 ON ck2.channel_kind_id = t2.channel_kind_id WHERE ti2.post_id IS NOT NULL)'

    let sql: string
    if (isMixed) {
      sql = `
        EXPLAIN
        SELECT post_id FROM (
          SELECT s.post_id, s.created_at_ms
          FROM (
            SELECT p.*,
              COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p.origin_server_id), '') AS origin_backend_url,
              COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p.author_profile_id), '') AS account_acct,
              COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p.visibility_id), 'public') AS visibility,
              COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS favourites_count,
              COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS reblogs_count,
              COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS replies_count
            FROM posts p
          ) s
          LEFT JOIN ${sttCompat} stt
            ON s.post_id = stt.post_id
          LEFT JOIN posts_belonging_tags sbt
            ON s.post_id = sbt.post_id
          LEFT JOIN posts_mentions sm
            ON s.post_id = sm.post_id
          LEFT JOIN posts_backends pb
            ON s.post_id = pb.post_id
          LEFT JOIN posts_reblogs sr
            ON s.post_id = sr.post_id
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
          ) s ON 0 = 1
          LEFT JOIN ${sttCompat} stt
            ON 0 = 1
          LEFT JOIN posts_belonging_tags sbt
            ON 0 = 1
          LEFT JOIN posts_mentions sm
            ON 0 = 1
          LEFT JOIN posts_backends pb
            ON 0 = 1
          LEFT JOIN posts_reblogs sr
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
        SELECT DISTINCT s.post_id
        FROM (
          SELECT p.*,
            COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p.origin_server_id), '') AS origin_backend_url,
            COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p.author_profile_id), '') AS account_acct,
            COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p.visibility_id), 'public') AS visibility,
            COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS favourites_count,
            COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS reblogs_count,
            COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS replies_count
          FROM posts p
        ) s
        LEFT JOIN ${sttCompat} stt
          ON s.post_id = stt.post_id
        LEFT JOIN posts_belonging_tags sbt
          ON s.post_id = sbt.post_id
        LEFT JOIN posts_mentions sm
          ON s.post_id = sm.post_id
        LEFT JOIN posts_backends pb
          ON s.post_id = pb.post_id
        LEFT JOIN posts_reblogs sr
          ON s.post_id = sr.post_id
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
  s: {
    columns: {
      language: 'language',
      object_uri: 'object_uri',
    },
    table: 'posts',
  },
  sb: {
    columns: {
      backend_url: 'backendUrl',
      backendUrl: 'backendUrl',
      local_id: 'local_id',
    },
    table: 'posts_backends',
  },
  sbt: {
    columns: {
      tag: 'tag',
    },
    table: 'posts_belonging_tags',
  },
  sm: {
    columns: {
      acct: 'acct',
    },
    table: 'posts_mentions',
  },
  sr: {
    columns: {
      original_uri: 'original_uri',
      reblogger_acct: 'reblogger_acct',
    },
    table: 'posts_reblogs',
  },
  stt: {
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
  s: {
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
 * エイリアス (s, sbt, sm 等) とカラム名から実テーブルを解決し、
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
