import type { WrittenTableCollector } from '../protocol'
import { lastChangeCount } from './changes'
import type { DbExecCompat } from './types'

/**
 * 投稿のハッシュタグを同期する。
 * hashtags テーブルに UPSERT し、post_hashtags でリンクを管理する。
 */
export function syncPostHashtags(
  db: DbExecCompat,
  postId: number,
  tags: { name: string; url?: string }[],
  collector?: WrittenTableCollector,
): void {
  if (tags.length === 0) {
    db.exec('DELETE FROM post_hashtags WHERE post_id = ?;', {
      bind: [postId],
    })
    if (lastChangeCount(db) > 0) collector?.add('post_hashtags')
    return
  }

  const expectedNames = new Set(tags.map((t) => t.name.toLowerCase()))
  const linksIdentical = hasIdenticalLinks(db, postId, expectedNames)

  const seen = new Set<string>()
  const keepIds: number[] = []
  let hashtagsChanged = false

  for (const tag of tags) {
    const normalizedName = tag.name.toLowerCase()
    if (seen.has(normalizedName)) continue
    seen.add(normalizedName)

    // hashtags テーブルに UPSERT
    db.exec(
      `INSERT INTO hashtags (name, url) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET url = COALESCE(excluded.url, hashtags.url)
       WHERE hashtags.url IS NOT COALESCE(excluded.url, hashtags.url);`,
      { bind: [normalizedName, tag.url ?? null] },
    )
    if (lastChangeCount(db) > 0) hashtagsChanged = true
    if (linksIdentical) continue

    // ID 取得
    const rows = db.exec('SELECT id FROM hashtags WHERE name = ?;', {
      bind: [normalizedName],
      returnValue: 'resultRows',
    }) as number[][]

    const hashtagId = rows[0][0]
    keepIds.push(hashtagId)
  }

  if (hashtagsChanged) collector?.add('hashtags')
  if (linksIdentical) return

  if (replacePostHashtagLinks(db, postId, keepIds)) {
    collector?.add('post_hashtags')
  }
}

/**
 * 投稿に現在リンクされているハッシュタグ名が expectedNames と完全一致するか判定する。
 */
function hasIdenticalLinks(
  db: DbExecCompat,
  postId: number,
  expectedNames: Set<string>,
): boolean {
  const currentNames = (
    db.exec(
      `SELECT ht.name FROM post_hashtags pht
       JOIN hashtags ht ON ht.id = pht.hashtag_id
       WHERE pht.post_id = ?;`,
      { bind: [postId], returnValue: 'resultRows' },
    ) as string[][]
  ).map((row) => row[0])
  return (
    currentNames.length === expectedNames.size &&
    currentNames.every((name) => expectedNames.has(name))
  )
}

/**
 * post_hashtags のリンクを keepIds に置き換える。リンクが変化した場合 true を返す。
 */
function replacePostHashtagLinks(
  db: DbExecCompat,
  postId: number,
  keepIds: number[],
): boolean {
  // post_hashtags にリンク（multi-value INSERT）
  const linkPlaceholders = keepIds.map(() => '(?, ?)').join(',')
  const linkBinds: number[] = []
  for (const id of keepIds) {
    linkBinds.push(postId, id)
  }
  db.exec(
    `INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES ${linkPlaceholders};`,
    { bind: linkBinds },
  )
  const inserted = lastChangeCount(db) > 0

  // 不要なリンクを削除
  const ph = keepIds.map(() => '?').join(',')
  db.exec(
    `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id NOT IN (${ph});`,
    { bind: [postId, ...keepIds] },
  )
  const deleted = lastChangeCount(db) > 0
  return inserted || deleted
}
