import { channelKindCache, timelineCache } from './cache'
import type { DbExecCompat } from './types'

/**
 * channel_kind_id を code から解決する
 */
export function resolveChannelKindId(
  db: DbExecCompat,
  code: string,
): number | null {
  const cached = channelKindCache.get(code)
  if (cached !== undefined) return cached

  const rows = db.exec(
    'SELECT channel_kind_id FROM channel_kinds WHERE code = ?;',
    { bind: [code], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  // null 結果はキャッシュしない（コードが不正な場合）
  if (result !== null) channelKindCache.set(code, result)
  return result
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
  localAccountId?: number | null,
): number {
  const cacheKey = `${serverId}\0${localAccountId ?? 0}\0${channelKindCode}\0${tag ?? ''}`
  const cached = timelineCache.get(cacheKey)
  if (cached !== undefined) return cached

  const channelKindId = resolveChannelKindId(db, channelKindCode)
  if (channelKindId === null) {
    throw new Error(`Unknown channel_kind code: ${channelKindCode}`)
  }

  const tagValue = tag ?? null

  // COALESCE でユニーク制約に合わせて検索
  const existing = db.exec(
    `SELECT timeline_id FROM timelines
     WHERE server_id = ? AND COALESCE(local_account_id, 0) = ? AND channel_kind_id = ? AND COALESCE(tag, '') = ?;`,
    {
      bind: [serverId, localAccountId ?? 0, channelKindId, tagValue ?? ''],
      returnValue: 'resultRows',
    },
  ) as number[][]

  if (existing.length > 0) {
    timelineCache.set(cacheKey, existing[0][0])
    return existing[0][0]
  }

  db.exec(
    `INSERT INTO timelines (server_id, local_account_id, channel_kind_id, tag, created_at)
     VALUES (?, ?, ?, ?, datetime('now'));`,
    { bind: [serverId, localAccountId ?? null, channelKindId, tagValue] },
  )

  const rows = db.exec(
    `SELECT timeline_id FROM timelines
     WHERE server_id = ? AND COALESCE(local_account_id, 0) = ? AND channel_kind_id = ? AND COALESCE(tag, '') = ?;`,
    {
      bind: [serverId, localAccountId ?? 0, channelKindId, tagValue ?? ''],
      returnValue: 'resultRows',
    },
  ) as number[][]

  timelineCache.set(cacheKey, rows[0][0])
  return rows[0][0]
}
