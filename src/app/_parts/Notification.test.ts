import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Notification emoji reaction image', () => {
  it('passes both width and height to ProxyImage', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/_parts/Notification.tsx'),
      'utf8',
    )
    const emojiImageBlock = source.match(
      /<ProxyImage\s+alt="emoji"[\s\S]*?\/>/,
    )?.[0]

    expect(emojiImageBlock).toContain('height={48}')
    expect(emojiImageBlock).toContain('width={48}')
  })
})
