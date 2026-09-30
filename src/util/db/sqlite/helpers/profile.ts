import type { Entity } from 'megalodon'
import type { WrittenTableCollector } from '../protocol'
import { profileIdCache, serverHostCache } from './cache'
import { lastChangeCount } from './changes'
import { ensureCustomEmoji } from './emoji'
import type { DbExecCompat } from './types'

/**
 * acct と server host から canonical_acct を算出する。
 * acct に '@' が含まれていれば FQN としてそのまま返し、
 * ローカルアカウント (@ なし) なら `acct@host` に正規化する。
 */
export function computeCanonicalAcct(acct: string, host: string): string {
  return acct.includes('@') ? acct : `${acct}@${host}`
}

/**
 * serverId から host を取得する。
 * キャッシュヒットしない場合は DB を参照する。
 */
function resolveServerHost(db: DbExecCompat, serverId: number): string {
  const cached = serverHostCache.get(serverId)
  if (cached) return cached

  const rows = db.exec('SELECT host FROM servers WHERE id = ?;', {
    bind: [serverId],
    returnValue: 'resultRows',
  }) as string[][]

  if (rows.length > 0) {
    serverHostCache.set(serverId, rows[0][0])
    return rows[0][0]
  }
  return ''
}

/**
 * account に対応する profiles.id を返す。
 * 未登録の場合は INSERT、既存の場合は表示名等を更新する。
 *
 * UNIQUE 制約は (canonical_acct) と (username, server_id)。
 * キャッシュキーは acct (FQN)。
 */
export function ensureProfile(
  db: DbExecCompat,
  account: Entity.Account,
  serverId: number,
  collector?: WrittenTableCollector,
  skipUpdate?: boolean,
  now?: number,
): number {
  const acct = account.acct
  const host = resolveServerHost(db, serverId)
  const canonicalAcct = computeCanonicalAcct(acct, host)
  const nowTs = now ?? Date.now()

  if (skipUpdate) {
    // キャッシュヒット → DB アクセス不要
    const cached = profileIdCache.get(canonicalAcct)
    if (cached !== undefined) return cached

    // 既存プロフィールを上書きしない INSERT OR IGNORE
    db.exec(
      `INSERT OR IGNORE INTO profiles (
        actor_uri, username, server_id, acct, canonical_acct, display_name,
        url, avatar_url, avatar_static_url, header_url, header_static_url,
        bio, is_locked, is_bot, last_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          account.url || null,
          account.username,
          serverId,
          acct,
          canonicalAcct,
          account.display_name ?? '',
          account.url ?? '',
          account.avatar ?? '',
          account.avatar_static ?? '',
          account.header ?? '',
          account.header_static ?? '',
          account.note ?? '',
          account.locked ? 1 : 0,
          account.bot ? 1 : 0,
          nowTs,
        ],
      },
    )
    if (lastChangeCount(db) > 0) collector?.add('profiles')

    const rows = db.exec('SELECT id FROM profiles WHERE canonical_acct = ?;', {
      bind: [canonicalAcct],
      returnValue: 'resultRows',
    }) as number[][]

    const id = rows[0][0]
    profileIdCache.set(canonicalAcct, id)
    return id
  }

  db.exec(
    `INSERT INTO profiles (
      actor_uri, username, server_id, acct, canonical_acct, display_name,
      url, avatar_url, avatar_static_url, header_url, header_static_url,
      bio, is_locked, is_bot, last_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_acct) DO UPDATE SET
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
      last_fetched_at   = excluded.last_fetched_at
    WHERE profiles.actor_uri         IS NOT COALESCE(excluded.actor_uri, profiles.actor_uri)
       OR profiles.display_name      IS NOT excluded.display_name
       OR profiles.url               IS NOT excluded.url
       OR profiles.avatar_url        IS NOT excluded.avatar_url
       OR profiles.avatar_static_url IS NOT excluded.avatar_static_url
       OR profiles.header_url        IS NOT excluded.header_url
       OR profiles.header_static_url IS NOT excluded.header_static_url
       OR profiles.bio               IS NOT excluded.bio
       OR profiles.is_locked         IS NOT excluded.is_locked
       OR profiles.is_bot            IS NOT excluded.is_bot
       OR profiles.last_fetched_at   IS NOT excluded.last_fetched_at
    ON CONFLICT(username, server_id) DO UPDATE SET
      actor_uri         = COALESCE(excluded.actor_uri, profiles.actor_uri),
      acct              = excluded.acct,
      canonical_acct    = excluded.canonical_acct,
      display_name      = excluded.display_name,
      url               = excluded.url,
      avatar_url        = excluded.avatar_url,
      avatar_static_url = excluded.avatar_static_url,
      header_url        = excluded.header_url,
      header_static_url = excluded.header_static_url,
      bio               = excluded.bio,
      is_locked         = excluded.is_locked,
      is_bot            = excluded.is_bot,
      last_fetched_at   = excluded.last_fetched_at
    WHERE profiles.actor_uri         IS NOT COALESCE(excluded.actor_uri, profiles.actor_uri)
       OR profiles.acct              IS NOT excluded.acct
       OR profiles.canonical_acct    IS NOT excluded.canonical_acct
       OR profiles.display_name      IS NOT excluded.display_name
       OR profiles.url               IS NOT excluded.url
       OR profiles.avatar_url        IS NOT excluded.avatar_url
       OR profiles.avatar_static_url IS NOT excluded.avatar_static_url
       OR profiles.header_url        IS NOT excluded.header_url
       OR profiles.header_static_url IS NOT excluded.header_static_url
       OR profiles.bio               IS NOT excluded.bio
       OR profiles.is_locked         IS NOT excluded.is_locked
       OR profiles.is_bot            IS NOT excluded.is_bot
       OR profiles.last_fetched_at   IS NOT excluded.last_fetched_at;`,
    {
      bind: [
        account.url || null, // actor_uri
        account.username, // username
        serverId, // server_id
        acct, // acct
        canonicalAcct, // canonical_acct
        account.display_name ?? '', // display_name
        account.url ?? '', // url
        account.avatar ?? '', // avatar_url
        account.avatar_static ?? '', // avatar_static_url
        account.header ?? '', // header_url
        account.header_static ?? '', // header_static_url
        account.note ?? '', // bio
        account.locked ? 1 : 0, // is_locked
        account.bot ? 1 : 0, // is_bot
        nowTs, // last_fetched_at
      ],
    },
  )
  if (lastChangeCount(db) > 0) collector?.add('profiles')

  const cached = profileIdCache.get(canonicalAcct)
  if (cached !== undefined) return cached

  const rows = db.exec('SELECT id FROM profiles WHERE canonical_acct = ?;', {
    bind: [canonicalAcct],
    returnValue: 'resultRows',
  }) as number[][]

  const id = rows[0][0]
  profileIdCache.set(canonicalAcct, id)
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
  now?: number,
): void {
  db.exec(
    `INSERT INTO profile_stats (profile_id, followers_count, following_count, statuses_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       followers_count = excluded.followers_count,
       following_count = excluded.following_count,
       statuses_count  = excluded.statuses_count,
       updated_at      = excluded.updated_at
     WHERE profile_stats.followers_count IS NOT excluded.followers_count
        OR profile_stats.following_count IS NOT excluded.following_count
        OR profile_stats.statuses_count  IS NOT excluded.statuses_count
        OR profile_stats.updated_at      IS NOT excluded.updated_at;`,
    {
      bind: [
        profileId,
        stats.followers_count ?? 0,
        stats.following_count ?? 0,
        stats.statuses_count ?? 0,
        now ?? Date.now(),
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
  const current = db.exec(
    'SELECT name, value, verified_at FROM profile_fields WHERE profile_id = ? ORDER BY sort_order;',
    { bind: [profileId], returnValue: 'resultRows' },
  ) as (string | number | null)[][]

  const expected = fields.map((f) => [f.name, f.value, f.verified_at ?? null])
  const identical =
    current.length === expected.length &&
    current.every((row, i) => row.every((v, j) => v === expected[i][j]))
  if (identical) return

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
  collector?: WrittenTableCollector,
): void {
  if (emojis.length === 0) {
    db.exec('DELETE FROM profile_custom_emojis WHERE profile_id = ?;', {
      bind: [profileId],
    })
    if (lastChangeCount(db) > 0) collector?.add('profile_custom_emojis')
    return
  }

  const keepIds: number[] = []
  const seenIds = new Set<number>()
  for (const emoji of emojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji, collector)
    if (seenIds.has(emojiId)) continue
    seenIds.add(emojiId)
    keepIds.push(emojiId)
  }

  const currentIds = new Set(
    (
      db.exec(
        'SELECT custom_emoji_id FROM profile_custom_emojis WHERE profile_id = ?;',
        { bind: [profileId], returnValue: 'resultRows' },
      ) as number[][]
    ).map((row) => row[0]),
  )
  const linksIdentical =
    currentIds.size === keepIds.length &&
    keepIds.every((id) => currentIds.has(id))
  if (linksIdentical) return

  let linksChanged = false
  for (const emojiId of keepIds) {
    db.exec(
      `INSERT OR IGNORE INTO profile_custom_emojis (profile_id, custom_emoji_id)
       VALUES (?, ?);`,
      { bind: [profileId, emojiId] },
    )
    if (lastChangeCount(db) > 0) linksChanged = true
  }

  const ph = keepIds.map(() => '?').join(',')
  db.exec(
    `DELETE FROM profile_custom_emojis WHERE profile_id = ? AND custom_emoji_id NOT IN (${ph});`,
    { bind: [profileId, ...keepIds] },
  )
  if (lastChangeCount(db) > 0) linksChanged = true
  if (linksChanged) collector?.add('profile_custom_emojis')
}
