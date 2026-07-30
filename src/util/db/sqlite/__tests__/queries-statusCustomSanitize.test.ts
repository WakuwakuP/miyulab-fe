import { sanitizeWhereClause } from 'util/db/sqlite/queries/statusCustomQuery'
import { describe, expect, it } from 'vitest'

describe('sanitizeWhereClause', () => {
  it('前後空白、セミコロン、大小文字を問わない LIMIT/OFFSET を除去する', () => {
    const sanitized = sanitizeWhereClause(
      "  p.language = 'ja'; limit 20 OfFsEt 5;  ",
    )

    expect(sanitized).toBe("p.language = 'ja'")
    expect(sanitized).not.toContain(';')
  })

  it('複数の LIMIT/OFFSET をすべて除去する', () => {
    const sanitized = sanitizeWhereClause(
      'p.is_reblog = 0 LIMIT 10 OFFSET 1 LIMIT 20 OFFSET 2',
    )

    expect(sanitized).not.toMatch(/\b(?:LIMIT|OFFSET)\b/i)
    expect(sanitized.trim()).toBe('p.is_reblog = 0')
  })

  it('空文字列とセミコロンだけの入力を空文字列にする', () => {
    expect(sanitizeWhereClause('')).toBe('')
    expect(sanitizeWhereClause(' ;;; ')).toBe('')
  })

  it.each([
    'DROP',
    'DELETE',
    'INSERT',
    'UPDATE',
    'ALTER',
    'CREATE',
    'ATTACH',
    'DETACH',
    'PRAGMA',
    'VACUUM',
    'REINDEX',
  ])('%s を独立した SQL キーワードとして拒否する', (keyword) => {
    expect(() =>
      sanitizeWhereClause(`p.id = 1 OR ${keyword.toLowerCase()} TABLE posts`),
    ).toThrow(
      'Custom query contains forbidden SQL statements. Only SELECT-compatible WHERE clauses are allowed.',
    )
  })

  it('禁止語を一部に含む通常の識別子は拒否しない', () => {
    const input =
      'p.updated_at IS NULL AND p.created_by IS NOT NULL AND p.delete_flag = 0 AND p.pragma_mode = 1'

    expect(sanitizeWhereClause(input)).toBe(input)
  })

  it.each(["p.language = 'ja' -- bypass", 'p.language = "ja" /* bypass */'])(
    'SQL コメントを拒否する: %s',
    (input) => {
      expect(() => sanitizeWhereClause(input)).toThrow(
        'Custom query contains SQL comments (-- or /* */). Comments are not allowed.',
      )
    },
  )

  it('LIMIT/OFFSET を一部に含む識別子は変更しない', () => {
    const input = 'p.limitless = 1 AND p.offset_value = 2'

    expect(sanitizeWhereClause(input)).toBe(input)
  })

  it('SELECT 互換の複雑な WHERE 句は内容を維持する', () => {
    const input =
      "EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id) AND vt.name IN ('public', 'unlisted')"

    expect(sanitizeWhereClause(input)).toBe(input)
  })
})
