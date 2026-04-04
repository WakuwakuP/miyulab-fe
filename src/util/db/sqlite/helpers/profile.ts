import type { Entity } from 'megalodon'
import { profileIdCache } from './cache'
import { ensureCustomEmoji } from './emoji'
import type { DbExecCompat } from './types'

/**
 * account に対応する profiles.id を返す。
 * 未登録の場合は INSERT、既存の場合は表示名等を更新する。
 *
 * UNIQUE 制約は (username, server_id)。
 * キャッシュキーは acct (FQN)。
 */
export function ensureProfile(
  db: DbExecCompat,
  account: Entity.Account,
  serverId: number,
): number {
  const acct = account.acct

  db.exec(
    `INSERT INTO profiles (
      actor_uri, username, server_id, acct, display_name,
      url, avatar_url, avatar_static_url, header_url, header_static_url,
      bio, is_locked, is_bot, last_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username, server_id) DO UPDATE SET
      actor_uri         = COALESCE(excluded.actor_uri, profiles.actor_uri),
      display_name      = excluded.display_name,
      url               = excluded.url,
      avatar_url        = excluded.avatar_url,
      avatar_static_url = excluded.avatar_static_url,
      header_url        = excluded.header_url,
      header_static_url = excluded.header_static_url,
      bio               = excluded.bio,
      is_locked         = excluded.is_locked,
      is_bot            = excluded.is_bot,
      last_fetched_at   = excluded.last_fetched_at;`,
    {
      bind: [
        account.url || null, // actor_uri
        account.username, // username
        serverId, // server_id
        acct, // acct
        account.display_name ?? '', // display_name
        account.url ?? '', // url
        account.avatar ?? '', // avatar_url
        account.avatar_static ?? '', // avatar_static_url
        account.header ?? '', // header_url
        account.header_static ?? '', // header_static_url
        account.note ?? '', // bio
        account.locked ? 1 : 0, // is_locked
        account.bot ? 1 : 0, // is_bot
        Date.now(), // last_fetched_at
      ],
    },
  )

  const cached = profileIdCache.get(acct)
  if (cached !== undefined) return cached

  const rows = db.exec(
    'SELECT id FROM profiles WHERE username = ? AND server_id = ?;',
    {
      bind: [account.username, serverId],
      returnValue: 'resultRows',
    },
  ) as number[][]

  const id = rows[0][0]
  profileIdCache.set(acct, id)
  return id
}

/**
 * profile_stats テーブルを UPSERT する。
 */
export function syncProfileStats(
  db: DbExecCompat,
  profileId: number,
  stats: {
    followers_count?: number
    following_count?: number
    statuses_count?: number
  },
): void {
  db.exec(
    `INSERT INTO profile_stats (profile_id, followers_count, following_count, statuses_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       followers_count = excluded.followers_count,
       following_count = excluded.following_count,
       statuses_count  = excluded.statuses_count,
       updated_at      = excluded.updated_at;`,
    {
      bind: [
        profileId,
        stats.followers_count ?? 0,
        stats.following_count ?? 0,
        stats.statuses_count ?? 0,
        Date.now(),
      ],
    },
  )
}

/**
 * profile_fields テーブルを同期する（DELETE + INSERT）。
 */
export function syncProfileFields(
  db: DbExecCompat,
  profileId: number,
  fields: { name: string; value: string; verified_at?: string | null }[],
): void {
  db.exec('DELETE FROM profile_fields WHERE profile_id = ?;', {
    bind: [profileId],
  })

  if (fields.length === 0) return

  const placeholders: string[] = []
  const binds: (string | number | null)[] = []

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    placeholders.push('(?, ?, ?, ?, ?)')
    binds.push(profileId, i, field.name, field.value, field.verified_at ?? null)
  }

  db.exec(
    `INSERT INTO profile_fields (profile_id, sort_order, name, value, verified_at)
     VALUES ${placeholders.join(',')};`,
    { bind: binds },
  )
}

/**
 * profile_custom_emojis テーブルを同期する。
 */
export function syncProfileCustomEmojis(
  db: DbExecCompat,
  profileId: number,
  serverId: number,
  emojis: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[],
): void {
  if (emojis.length === 0) {
    db.exec('DELETE FROM profile_custom_emojis WHERE profile_id = ?;', {
      bind: [profileId],
    })
    return
  }

  const keepIds: number[] = []

  for (const emoji of emojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji)
    db.exec(
      `INSERT OR IGNORE INTO profile_custom_emojis (profile_id, custom_emoji_id)
       VALUES (?, ?);`,
      { bind: [profileId, emojiId] },
    )
    keepIds.push(emojiId)
  }

  const ph = keepIds.map(() => '?').join(',')
  db.exec(
    `DELETE FROM profile_custom_emojis WHERE profile_id = ? AND custom_emoji_id NOT IN (${ph});`,
    { bind: [profileId, ...keepIds] },
  )
}
