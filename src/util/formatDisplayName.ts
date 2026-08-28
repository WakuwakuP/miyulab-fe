import type { Entity } from 'megalodon'
import { replaceEmojis } from 'util/emojiReplacer'
import { escapeHtml } from 'util/escapeHtml'

/**
 * Display-name emoji sizing for truncated rows.
 * `min-w-*` must not be used: it raises the flex item's min-content width
 * and prevents `truncate` from shrinking to the column.
 */
export const DISPLAY_NAME_EMOJI_CLASS =
  'inline-block h-4 w-4 max-h-4 max-w-4 align-text-bottom'

export function formatDisplayNameHtml(
  account: Pick<Entity.Account, 'display_name' | 'emojis'>,
): string {
  return replaceEmojis(
    escapeHtml(account.display_name),
    account.emojis,
    DISPLAY_NAME_EMOJI_CLASS,
  )
}
