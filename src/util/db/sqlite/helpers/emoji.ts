import type {
  BindValue,
  SqliteResultRows,
  WrittenTableCollector,
} from '../protocol'
import { emojiIdCache } from './cache'
import { lastChangeCount } from './changes'

/**
 * カスタム絵文字を custom_emojis に UPSERT し、id を返す。
 */
export function ensureCustomEmoji(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: BindValue[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  serverId: number,
  emoji: {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  },
  collector?: WrittenTableCollector,
): number {
  const cacheKey = `${serverId}:${emoji.shortcode}`

  // UPSERT は常に実行（url 等の更新のため）
  db.exec(
    `INSERT INTO custom_emojis (server_id, shortcode, url, static_url, visible_in_picker)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(shortcode, server_id) DO UPDATE SET
       url               = excluded.url,
       static_url        = excluded.static_url,
       visible_in_picker = excluded.visible_in_picker
     WHERE custom_emojis.url               IS NOT excluded.url
        OR custom_emojis.static_url        IS NOT excluded.static_url
        OR custom_emojis.visible_in_picker IS NOT excluded.visible_in_picker;`,
    {
      bind: [
        serverId,
        emoji.shortcode,
        emoji.url,
        emoji.static_url ?? null,
        emoji.visible_in_picker === false ? 0 : 1,
      ],
    },
  )
  if (collector && lastChangeCount(db) > 0) collector.add('custom_emojis')

  // キャッシュヒット時は SELECT をスキップ
  const cached = emojiIdCache.get(cacheKey)
  if (cached !== undefined) return cached

  const emojiRows = db.exec(
    'SELECT id FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
    { bind: [serverId, emoji.shortcode], returnValue: 'resultRows' },
  ) as number[][]

  emojiIdCache.set(cacheKey, emojiRows[0][0])
  return emojiRows[0][0]
}

/**
 * 投稿のカスタム絵文字を post_custom_emojis に同期する。
 */
export function syncPostCustomEmojis(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: BindValue[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
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
    db.exec('DELETE FROM post_custom_emojis WHERE post_id = ?;', {
      bind: [postId],
    })
    if (lastChangeCount(db) > 0) collector?.add('post_custom_emojis')
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
        'SELECT custom_emoji_id FROM post_custom_emojis WHERE post_id = ?;',
        { bind: [postId], returnValue: 'resultRows' },
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
      `INSERT OR IGNORE INTO post_custom_emojis (post_id, custom_emoji_id)
       VALUES (?, ?);`,
      { bind: [postId, emojiId] },
    )
    if (lastChangeCount(db) > 0) linksChanged = true
  }

  // Remove stale entries
  const ph = keepIds.map(() => '?').join(',')
  db.exec(
    `DELETE FROM post_custom_emojis WHERE post_id = ? AND custom_emoji_id NOT IN (${ph});`,
    { bind: [postId, ...keepIds] },
  )
  if (lastChangeCount(db) > 0) linksChanged = true
  if (linksChanged) collector?.add('post_custom_emojis')
}

// ================================================================
// 絵文字フォールバック解決（Misskey ストリーミング対応）
// ================================================================

/** :shortcode: または :shortcode@host: パターンを抽出する正規表現 */
export const CUSTOM_EMOJI_RE = /:(\w+)(?:@[\w.-]+)?:/g

/**
 * テキスト中の :shortcode: パターンから DB 上のカスタム絵文字を解決する。
 *
 * Misskey 系ストリーミングで note.emojis が空の場合のフォールバックとして使用。
 * DB にヒットしなかった shortcode は Misskey URL パターン
 * (`${backendUrl}/emoji/${shortcode}.webp`) で推定する。
 */
export function resolveEmojisFromDb(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: BindValue[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  serverId: number,
  text: string | null | undefined,
  backendUrl: string,
): {
  shortcode: string
  url: string
  static_url: string | null
  visible_in_picker: boolean
}[] {
  if (!text) return []

  const matches = [...text.matchAll(CUSTOM_EMOJI_RE)]
  const shortcodes = [...new Set(matches.map((m) => m[1]))]
  if (shortcodes.length === 0) return []

  const result: {
    shortcode: string
    url: string
    static_url: string | null
    visible_in_picker: boolean
  }[] = []

  for (const shortcode of shortcodes) {
    // DB から検索（custom_emojis テーブル）
    const rows = db.exec(
      'SELECT url, static_url, visible_in_picker FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
      { bind: [serverId, shortcode], returnValue: 'resultRows' },
    ) as SqliteResultRows

    if (rows.length > 0) {
      result.push({
        shortcode,
        static_url: rows[0][1] as string | null,
        url: rows[0][0] as string,
        visible_in_picker: rows[0][2] === 1,
      })
    } else {
      // Misskey URL パターンでフォールバック
      const fallbackUrl = `${backendUrl}/emoji/${encodeURIComponent(shortcode)}.webp`
      result.push({
        shortcode,
        static_url: fallbackUrl,
        url: fallbackUrl,
        visible_in_picker: true,
      })
    }
  }

  return result
}
