/**
 * リンクカード同期ヘルパー
 */

/**
 * 投稿のリンクカードを link_cards / post_links に同期する。
 *
 * link_cards テーブルに canonical_url で UPSERT し、
 * post_links テーブルを洗い替え（DELETE → INSERT）する。
 * card が null の場合は post_links のみ削除する。
 */
export function syncPostLinkCard(
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
  card: {
    url: string
    title: string
    description: string
    image: string | null
    provider_name: string | null
  } | null,
): void {
  if (!card || !card.url) {
    // No card - delete all links for this post
    db.exec('DELETE FROM post_links WHERE post_id = ?;', { bind: [postId] })
    return
  }

  // UPSERT the link card
  db.exec(
    `INSERT INTO link_cards (canonical_url, title, description, image_url, provider_name, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(canonical_url) DO UPDATE SET
       title         = excluded.title,
       description   = excluded.description,
       image_url     = excluded.image_url,
       provider_name = excluded.provider_name,
       fetched_at    = excluded.fetched_at;`,
    {
      bind: [
        card.url,
        card.title ?? null,
        card.description ?? null,
        card.image ?? null,
        card.provider_name ?? null,
      ],
    },
  )

  const rows = db.exec(
    'SELECT link_card_id FROM link_cards WHERE canonical_url = ?;',
    { bind: [card.url], returnValue: 'resultRows' },
  ) as number[][]
  const linkCardId = rows[0][0]

  db.exec(
    `INSERT INTO post_links (post_id, link_card_id, url_in_post, sort_order)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(post_id, link_card_id, url_in_post) DO NOTHING;`,
    { bind: [postId, linkCardId, card.url] },
  )

  // Remove stale links (links to other cards)
  db.exec(`DELETE FROM post_links WHERE post_id = ? AND link_card_id != ?;`, {
    bind: [postId, linkCardId],
  })
}
