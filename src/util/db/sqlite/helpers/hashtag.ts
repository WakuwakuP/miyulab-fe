/**
 * 投稿のハッシュタグを hashtags / post_hashtags に同期する。
 *
 * hashtags テーブルに正規化名（小文字）で UPSERT し、
 * post_hashtags テーブルを洗い替え（DELETE → INSERT）する。
 */
export function syncPostHashtags(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  tags: { name: string; url?: string }[],
): void {
  const keepHashtagIds: number[] = []

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]
    const normalizedName = tag.name.toLowerCase()
    const displayName = tag.name

    db.exec(
      `INSERT INTO hashtags (normalized_name, display_name)
       VALUES (?, ?)
       ON CONFLICT(normalized_name) DO UPDATE SET
         display_name = excluded.display_name;`,
      { bind: [normalizedName, displayName] },
    )

    const rows = db.exec(
      'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
      { bind: [normalizedName], returnValue: 'resultRows' },
    ) as number[][]
    const hashtagId = rows[0][0]
    keepHashtagIds.push(hashtagId)

    db.exec(
      `INSERT INTO post_hashtags (post_id, hashtag_id, sort_order)
       VALUES (?, ?, ?)
       ON CONFLICT(post_id, hashtag_id) DO UPDATE SET
         sort_order = excluded.sort_order;`,
      { bind: [postId, hashtagId, i] },
    )
  }

  // Remove stale
  if (keepHashtagIds.length === 0) {
    db.exec('DELETE FROM post_hashtags WHERE post_id = ?;', { bind: [postId] })
  } else {
    const ph = keepHashtagIds.map(() => '?').join(',')
    db.exec(
      `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id NOT IN (${ph});`,
      { bind: [postId, ...keepHashtagIds] },
    )
  }
}
