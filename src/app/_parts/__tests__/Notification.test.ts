import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Notification emoji reaction image', () => {
  it('Next Image がクラッシュしないよう width と height を渡す', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/_parts/Notification.tsx'),
      'utf8',
    )

    const emojiImage = source.match(/<ProxyImage\s+alt="emoji"[\s\S]*?\/>/)

    expect(emojiImage?.[0]).toContain('height={48}')
    expect(emojiImage?.[0]).toContain('width={48}')
  })
})
