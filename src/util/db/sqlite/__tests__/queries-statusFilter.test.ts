import type { TimelineConfigV2 } from 'types/types'
import { buildFilterConditions } from 'util/db/sqlite/queries/statusFilter'
import { describe, expect, it } from 'vitest'

/**
 * buildFilterConditions が新スキーマのカラム名・テーブル構造を
 * 正しく参照しているかを検証するテスト。
 *
 * 旧スキーマの has_media / media_count / has_spoiler / visibility_types.code
 * が排除され、新スキーマの post_media サブクエリ / spoiler_text /
 * visibility_types.name に置き換わっていることを確認する。
 */

// ─── helpers ────────────────────────────────────────────────────

/** テスト用の最小限 TimelineConfigV2 を生成する */
function makeConfig(
  overrides: Partial<TimelineConfigV2> = {},
): TimelineConfigV2 {
  return {
    applyInstanceBlock: false,
    applyMuteFilter: false,
    id: 'test',
    order: 0,
    type: 'home',
    visible: true,
    ...overrides,
  }
}

/** conditions 配列を1つの文字列に結合して返す */
function joinConditions(conditions: string[]): string {
  return conditions.join(' ')
}

// ─── メディアフィルタ ──────────────────────────────────────────

describe('メディアフィルタが post_media サブクエリを使用する（has_media ではない）', () => {
  it('onlyMedia が post_media の EXISTS サブクエリを生成する', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ onlyMedia: true }),
      [],
    )
    const joined = joinConditions(conditions)
    expect(joined).toContain('post_media')
    expect(joined).not.toContain('has_media')
  })

  it('minMediaCount が post_media の COUNT サブクエリを生成する', () => {
    const { conditions, binds } = buildFilterConditions(
      makeConfig({ minMediaCount: 3 }),
      [],
    )
    const joined = joinConditions(conditions)
    expect(joined).toContain('post_media')
    expect(joined).toContain('COUNT')
    expect(joined).not.toContain('media_count')
    expect(binds).toContain(3)
  })

  it('onlyMedia でプレフィックス付きサブクエリが正しく生成される', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ onlyMedia: true }),
      [],
      'x',
    )
    const mediaCondition = conditions.find((c) => c.includes('post_media'))
    expect(mediaCondition).toBeDefined()
    // サブクエリ内で post_media.post_id = x.id の形で参照される
    expect(mediaCondition).toContain('x.id')
  })
})

// ─── spoiler フィルタ ──────────────────────────────────────────

describe('spoiler フィルタが spoiler_text を使用する（has_spoiler ではない）', () => {
  it('excludeSpoiler が spoiler_text 条件を生成する', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ excludeSpoiler: true }),
      [],
    )
    const joined = joinConditions(conditions)
    expect(joined).toContain('spoiler_text')
    expect(joined).not.toContain('has_spoiler')
  })

  it('excludeSpoiler でプレフィックス付き spoiler_text が正しく生成される', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ excludeSpoiler: true }),
      [],
      'q',
    )
    const spoilerCondition = conditions.find((c) => c.includes('spoiler_text'))
    expect(spoilerCondition).toBeDefined()
    expect(spoilerCondition).toContain("q.spoiler_text = ''")
  })
})

// ─── visibility フィルタ ───────────────────────────────────────

describe('visibility フィルタが visibility_types.name を使用する（code ではない）', () => {
  it('visibilityFilter が visibility_types.name をサブクエリで参照する', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ visibilityFilter: ['public', 'unlisted'] }),
      [],
    )
    const visCondition = conditions.find((c) => c.includes('visibility_types'))
    expect(visCondition).toBeDefined()
    expect(visCondition).toContain('name')
    expect(visCondition).not.toContain('code')
  })

  it('visibilityFilter のサブクエリが WHERE id = を使用する（visibility_id ではない）', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ visibilityFilter: ['public'] }),
      [],
    )
    const visCondition = conditions.find((c) => c.includes('visibility_types'))
    expect(visCondition).toBeDefined()
    // visibility_types WHERE id = ... の形
    expect(visCondition).toMatch(/visibility_types\s+WHERE\s+id\s*=/)
    // WHERE visibility_id = は旧スキーマ
    expect(visCondition).not.toMatch(
      /visibility_types\s+WHERE\s+visibility_id\s*=/,
    )
  })
})

// ─── アカウントフィルタ (profiles) ─────────────────────────────

describe('アカウントフィルタが profiles WHERE id を使用する（profile_id ではない）', () => {
  it('include モードで profiles WHERE id を使用する', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({
        accountFilter: { accts: ['user@example.com'], mode: 'include' },
        applyMuteFilter: false,
      }),
      [],
    )
    const acctCondition = conditions.find((c) => c.includes('profiles'))
    expect(acctCondition).toBeDefined()
    expect(acctCondition).toMatch(/profiles\s+WHERE\s+id\s*=/)
    expect(acctCondition).not.toMatch(/profiles\s+WHERE\s+profile_id\s*=/)
  })

  it('exclude モードで profiles WHERE id を使用する', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({
        accountFilter: { accts: ['spam@example.com'], mode: 'exclude' },
        applyMuteFilter: false,
      }),
      [],
    )
    const acctCondition = conditions.find((c) => c.includes('profiles'))
    expect(acctCondition).toBeDefined()
    expect(acctCondition).toMatch(/profiles\s+WHERE\s+id\s*=/)
  })
})

// ─── follows フィルタ ──────────────────────────────────────────

describe('followsOnly フィルタ（follows テーブル未実装）', () => {
  it('follows テーブル未実装のため条件を追加しない', () => {
    const { conditions } = buildFilterConditions(
      makeConfig({ followsOnly: true }),
      ['https://mastodon.social'],
    )
    const followCondition = conditions.find((c) => c.includes('follows'))
    expect(followCondition).toBeUndefined()
  })

  it('console.warn を出力する', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    buildFilterConditions(makeConfig({ followsOnly: true }), [
      'https://mastodon.social',
    ])
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('followsOnly'))
    spy.mockRestore()
  })
})
