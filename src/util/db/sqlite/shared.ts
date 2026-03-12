/**
 * Worker / メインスレッド共有の純粋関数
 *
 * DB アクセス不要な純粋関数をここに配置し、
 * Worker 側とメインスレッド側の両方から import できるようにする。
 */

import type { Entity } from 'megalodon'

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
  const rows = db.exec(
    `SELECT la.local_account_id
     FROM local_accounts la
     INNER JOIN servers sv ON la.server_id = sv.server_id
     WHERE sv.base_url = ?
     LIMIT 1;`,
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * channel_kind_id を code から解決する
 */
export function resolveChannelKindId(
  db: DbExecCompat,
  code: string,
): number | null {
  const rows = db.exec(
    'SELECT channel_kind_id FROM channel_kinds WHERE code = ?;',
    { bind: [code], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
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

  if (existing.length > 0) return existing[0][0]

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
  const host = new URL(backendUrl).host

  db.exec('INSERT OR IGNORE INTO servers (host, base_url) VALUES (?, ?);', {
    bind: [host, backendUrl],
  })

  const rows = db.exec('SELECT server_id FROM servers WHERE base_url = ?;', {
    bind: [backendUrl],
    returnValue: 'resultRows',
  }) as number[][]

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

  const rows = db.exec('SELECT profile_id FROM profiles WHERE actor_uri = ?;', {
    bind: [actorUri],
    returnValue: 'resultRows',
  }) as number[][]

  return rows[0][0]
}
