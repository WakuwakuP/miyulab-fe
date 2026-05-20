import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Notification', () => {
  it('カスタム絵文字リアクション画像には next/image 必須の width と height を指定する', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/_parts/Notification.tsx'),
      'utf8',
    )

    const reactionImageBlock = source.match(
      /<ProxyImage\s+alt="emoji"[\s\S]*?\/>/,
    )?.[0]

    expect(reactionImageBlock).toContain('height={48}')
    expect(reactionImageBlock).toContain('width={48}')
  })
})
