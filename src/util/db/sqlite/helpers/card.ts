import type { WrittenTableCollector } from '../protocol'
import type { DbExecCompat } from './types'

const CARD_TYPE_MAP: Record<string, number> = {
  link: 1,
  photo: 2,
  rich: 4,
  video: 3,
}

/**
 * リンクカードを同期する。
 * link_cards テーブルに post_id で 1:1 UPSERT する。
 */
export function syncLinkCard(
  db: DbExecCompat,
  postId: number,
  card:
    | {
        type?: string
        url: string
        title?: string
        description?: string
        image?: string | null
        author_name?: string | null
        author_url?: string | null
        provider_name?: string | null
        provider_url?: string | null
        html?: string | null
        width?: number | null
        height?: number | null
        embed_url?: string | null
        blurhash?: string | null
      }
    | null
    | undefined,
  collector?: WrittenTableCollector,
): void {
  if (!card) {
    db.exec('DELETE FROM link_cards WHERE post_id = ?;', { bind: [postId] })
    collector?.add('cards')
    return
  }

  const cardTypeId = CARD_TYPE_MAP[card.type ?? 'link'] ?? 1

  db.exec(
    `INSERT INTO link_cards (
      post_id, card_type_id, url, title, description, image,
      author_name, author_url, provider_name, provider_url,
      html, width, height, embed_url, blurhash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      card_type_id  = excluded.card_type_id,
      url           = excluded.url,
      title         = excluded.title,
      description   = excluded.description,
      image         = excluded.image,
      author_name   = excluded.author_name,
      author_url    = excluded.author_url,
      provider_name = excluded.provider_name,
      provider_url  = excluded.provider_url,
      html          = excluded.html,
      width         = excluded.width,
      height        = excluded.height,
      embed_url     = excluded.embed_url,
      blurhash      = excluded.blurhash;`,
    {
      bind: [
        postId,
        cardTypeId,
        card.url,
        card.title ?? '',
        card.description ?? '',
        card.image ?? null,
        card.author_name ?? null,
        card.author_url ?? null,
        card.provider_name ?? null,
        card.provider_url ?? null,
        card.html ?? null,
        card.width ?? null,
        card.height ?? null,
        card.embed_url ?? null,
        card.blurhash ?? null,
      ],
    },
  )
  collector?.add('cards')
}
