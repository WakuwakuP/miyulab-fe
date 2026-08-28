import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Status reblog display name', () => {
  it('truncates the reblogger name with TruncatedDisplayName', async () => {
    const source = await readFile(
      join(process.cwd(), 'src/app/_parts/Status.tsx'),
      'utf8',
    )

    expect(source).toContain('formatDisplayNameHtml')
    expect(source).toContain('TruncatedDisplayName')
    expect(source).not.toMatch(/whitespace-nowrap/)
    expect(source).toContain('className="pl-2"')
    expect(source).toContain('html={displayName}')
  })
})
