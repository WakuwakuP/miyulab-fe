import type { WrittenTableCollector } from '../protocol'
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
    collector?.add('post_hashtags')
    return
  }

  const keepIds: number[] = []

  for (const tag of tags) {
    const normalizedName = tag.name.toLowerCase()

    // hashtags テーブルに UPSERT
    db.exec(
      `INSERT INTO hashtags (name, url) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET url = COALESCE(excluded.url, hashtags.url);`,
      { bind: [normalizedName, tag.url ?? null] },
    )

    // ID 取得
    const rows = db.exec('SELECT id FROM hashtags WHERE name = ?;', {
      bind: [normalizedName],
      returnValue: 'resultRows',
    }) as number[][]

    const hashtagId = rows[0][0]
    keepIds.push(hashtagId)
  }

  collector?.add('hashtags')

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

  // 不要なリンクを削除
  const ph = keepIds.map(() => '?').join(',')
  db.exec(
    `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id NOT IN (${ph});`,
    { bind: [postId, ...keepIds] },
  )
  collector?.add('post_hashtags')
}
