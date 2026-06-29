import type { Entity } from 'megalodon'
import { escapeHtml } from 'util/escapeHtml'
import { toSecureResourceUrl } from 'util/secureResourceUrl'

/**
 * Replace custom emoji shortcodes (`:name:`) in a string with `<img>` tags,
 * escaping the emoji URL and shortcode to prevent HTML injection.
 */
export function replaceEmojis(
  text: string,
  emojis: Entity.Emoji[],
  className = 'min-w-7 h-7 inline-block',
): string {
  let result = text
  for (const emoji of emojis) {
    const emojiUrl = toSecureResourceUrl(emoji.url) ?? ''
    result = result.replace(
      new RegExp(`:${escapeForRegex(emoji.shortcode)}:`, 'gm'),
      `<img src="${escapeHtml(emojiUrl)}" alt="${escapeHtml(emoji.shortcode)}" title=":${escapeHtml(emoji.shortcode)}:" class="${className}" loading="lazy" />`,
    )
  }
  return result
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
