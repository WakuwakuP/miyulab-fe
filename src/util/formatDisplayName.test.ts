import { describe, expect, it } from 'vitest'
import {
  DISPLAY_NAME_EMOJI_CLASS,
  formatDisplayNameHtml,
} from './formatDisplayName'

describe('formatDisplayNameHtml', () => {
  it('escapes HTML in the display name before emoji replacement', () => {
    const html = formatDisplayNameHtml({
      display_name: '<script>alert(1)</script> :cat:',
      emojis: [
        {
          shortcode: 'cat',
          static_url: 'https://example.com/cat.png',
          url: 'https://example.com/cat.png',
          visible_in_picker: true,
        },
      ],
    })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<img')
    expect(html).toContain(DISPLAY_NAME_EMOJI_CLASS)
  })

  it('does not apply min-width to display-name emojis', () => {
    expect(DISPLAY_NAME_EMOJI_CLASS).not.toMatch(/min-w-/)

    const html = formatDisplayNameHtml({
      display_name: 'hello :wave:',
      emojis: [
        {
          shortcode: 'wave',
          static_url: 'https://example.com/wave.png',
          url: 'https://example.com/wave.png',
          visible_in_picker: true,
        },
      ],
    })

    expect(html).not.toMatch(/min-w-/)
    expect(html).toContain('max-w-4')
  })
})
