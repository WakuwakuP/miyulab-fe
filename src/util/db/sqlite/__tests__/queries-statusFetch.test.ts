import type { SqliteHandle } from 'util/db/sqlite/queries/statusBatch'
import { fetchStatusesByIds } from 'util/db/sqlite/queries/statusFetch'
import { describe, expect, it, vi } from 'vitest'

/**
 * fetchStatusesByIds が新スキーマのカラム名を
 * 正しく参照しているかを検証するテスト。
 *
 * Phase2 クエリで WHERE / GROUP BY に使われるカラムが
 * p.id であること（旧 p.post_id ではないこと）を確認する。
 */

// ─── helpers ────────────────────────────────────────────────────

/** execAsync に渡された SQL を記録するモックハンドルを生成する */
function createMockHandle() {
  const captured: string[] = []
  const handle = {
    execAsync: vi.fn(async (sql: string) => {
      captured.push(sql)
      return []
    }),
  } as unknown as SqliteHandle
  return { captured, handle }
}

// ─── Phase2 クエリ ─────────────────────────────────────────────

describe('Phase2 クエリが p.id を使用する（post_id ではない）', () => {
  it('WHERE 句で p.id IN を使用する', async () => {
    const { captured, handle } = createMockHandle()
    await fetchStatusesByIds(handle, [1, 2, 3])

    expect(captured.length).toBeGreaterThanOrEqual(1)
    const baseSql = captured[0]
    expect(baseSql).toContain('WHERE p.id IN')
    expect(baseSql).not.toContain('WHERE p.post_id')
  })

  it('GROUP BY 句で p.id を使用する', async () => {
    const { captured, handle } = createMockHandle()
    await fetchStatusesByIds(handle, [1, 2, 3])

    expect(captured.length).toBeGreaterThanOrEqual(1)
    const baseSql = captured[0]
    expect(baseSql).toContain('GROUP BY p.id')
    expect(baseSql).not.toContain('GROUP BY p.post_id')
  })

  it('SQL 全体に p.post_id が含まれない', async () => {
    const { captured, handle } = createMockHandle()
    await fetchStatusesByIds(handle, [10, 20])

    expect(captured.length).toBeGreaterThanOrEqual(1)
    const baseSql = captured[0]
    // p.id AS post_id は許容するが、p.post_id カラム参照は NG
    expect(baseSql).not.toMatch(/\bp\.post_id\b/)
  })

  it('空配列を渡した場合はクエリを発行せず空配列を返す', async () => {
    const { captured, handle } = createMockHandle()
    const result = await fetchStatusesByIds(handle, [])

    expect(result).toEqual([])
    expect(captured).toHaveLength(0)
  })
})
