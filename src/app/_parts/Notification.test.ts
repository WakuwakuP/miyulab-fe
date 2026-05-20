import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Notification emoji reaction image', () => {
  it('renders the reaction emoji with an img element', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/_parts/Notification.tsx'),
      'utf8',
    )
    const emojiImageBlock = source.match(/<img\s+alt="emoji"[\s\S]*?\/>/)?.[0]

    expect(emojiImageBlock).toContain('src={resolvedReactionUrl}')
    expect(source).not.toMatch(/<ProxyImage\s+alt="emoji"/)
  })
})
