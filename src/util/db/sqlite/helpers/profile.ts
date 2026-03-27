import type { Entity } from 'megalodon'
import { profileIdCache } from './cache'
import { ensureCustomEmoji } from './emoji'

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

  // UPSERT は常に実行（display_name 等の更新のため）
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

  // キャッシュヒット時は SELECT をスキップ
  const cached = profileIdCache.get(actorUri)
  if (cached !== undefined) return cached

  const rows = db.exec('SELECT profile_id FROM profiles WHERE actor_uri = ?;', {
    bind: [actorUri],
    returnValue: 'resultRows',
  }) as number[][]

  profileIdCache.set(actorUri, rows[0][0])
  return rows[0][0]
}

/**
 * profile_aliases テーブルにリモートアカウント ID のマッピングを UPSERT する。
 *
 * Mastodon / Pleroma 等の API では、アカウント ID はサーバーごとに異なる。
 * この関数で (server_id, remote_account_id) → profile_id のマッピングを記録し、
 * 読み取りクエリ時にバックエンド固有のアカウント ID を復元できるようにする。
 */
export function ensureProfileAlias(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  profileId: number,
  serverId: number,
  remoteAccountId: string,
): void {
  if (!remoteAccountId) return
  db.exec(
    `INSERT INTO profile_aliases (server_id, remote_account_id, profile_id, fetched_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(server_id, remote_account_id) DO UPDATE SET
       profile_id = excluded.profile_id,
       fetched_at = excluded.fetched_at;`,
    { bind: [serverId, remoteAccountId, profileId] },
  )
}

/**
 * プロフィールのカスタム絵文字を profile_custom_emojis に同期する。
 */
export function syncProfileCustomEmojis(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  profileId: number,
  serverId: number,
  emojis: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[],
): void {
  const keepIds: number[] = []

  for (const emoji of emojis) {
    const emojiId = ensureCustomEmoji(db, serverId, emoji)
    db.exec(
      `INSERT OR IGNORE INTO profile_custom_emojis (profile_id, emoji_id)
       VALUES (?, ?);`,
      { bind: [profileId, emojiId] },
    )
    keepIds.push(emojiId)
  }

  // Remove stale
  if (keepIds.length === 0) {
    db.exec('DELETE FROM profile_custom_emojis WHERE profile_id = ?;', {
      bind: [profileId],
    })
  } else {
    const ph = keepIds.map(() => '?').join(',')
    db.exec(
      `DELETE FROM profile_custom_emojis WHERE profile_id = ? AND emoji_id NOT IN (${ph});`,
      { bind: [profileId, ...keepIds] },
    )
  }
}
