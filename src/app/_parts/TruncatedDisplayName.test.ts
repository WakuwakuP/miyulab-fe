import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('TruncatedDisplayName', () => {
  it('forces flex-item shrink and inner block truncate', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/_parts/TruncatedDisplayName.tsx'),
      'utf8',
    )

    expect(source).toContain('min-w-0 w-0 flex-1 overflow-hidden')
    expect(source).toContain('block truncate')
    expect(source).toContain('[&_img]:max-w-4')
  })
})
