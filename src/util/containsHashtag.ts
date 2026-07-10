import { TAG_HIGHLIGHT_REG } from 'app/_parts/statusRichTextareaConstants'

/**
 * Returns true when the text contains at least one hashtag token
 * matching the same pattern used by StatusRichTextarea highlighting.
 * A bare `#` (empty tag name) does not count.
 */
export const containsHashtag = (text: string): boolean => {
  TAG_HIGHLIGHT_REG.lastIndex = 0
  for (const match of text.matchAll(TAG_HIGHLIGHT_REG)) {
    if (match[1] != null && match[1].length > 0) return true
  }
  return false
}
