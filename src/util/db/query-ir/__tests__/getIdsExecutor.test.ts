import { describe, expect, it } from 'vitest'
import { compileGetIds } from '../executor/getIdsExecutor'
import type { GetIdsNode } from '../nodes'

function makeNode(overrides: Partial<GetIdsNode> = {}): GetIdsNode {
  return {
    filters: [],
    kind: 'get-ids',
    table: 'posts',
    ...overrides,
  }
}

describe('compileGetIds', () => {
  describe('outputTimeColumn のデフォルト動作', () => {
    it('省略時は created_at_ms を時刻カラムとして使用する', () => {
      const node = makeNode()
      const { sql } = compileGetIds(node, new Map())

      expect(sql).toContain('p.created_at_ms AS created_at_ms')
      expect(sql).toContain('ORDER BY p.created_at_ms DESC')
    })

    it('文字列指定時はそのカラムを使用する', () => {
      const node = makeNode({ outputTimeColumn: 'updated_at' })
      const { sql } = compileGetIds(node, new Map())

      expect(sql).toContain('p.updated_at AS created_at_ms')
      expect(sql).toContain('ORDER BY p.updated_at DESC')
    })
  })

  describe('outputTimeColumn: null（時刻カラムなし）', () => {
    it('時刻カラムの代わりに 0 を SELECT する', () => {
      const node = makeNode({ outputTimeColumn: null })
      const { sql } = compileGetIds(node, new Map())

      expect(sql).toContain('0 AS created_at_ms')
      expect(sql).not.toContain('p.created_at_ms')
    })

    it('ROWID 降順でソートする', () => {
      const node = makeNode({ outputTimeColumn: null })
      const { sql } = compileGetIds(node, new Map())

      expect(sql).toContain('ORDER BY p.rowid DESC')
    })

    it('フィルタ付きでも正しく動作する', () => {
      const node = makeNode({
        filters: [
          { column: 'is_sensitive', op: '=', table: 'posts', value: 0 },
        ],
        outputTimeColumn: null,
      })
      const { sql, binds } = compileGetIds(node, new Map())

      expect(sql).toContain('WHERE')
      expect(sql).toContain('0 AS created_at_ms')
      expect(sql).toContain('ORDER BY p.rowid DESC')
      expect(binds).toContain(0)
    })

    it('LIMIT 付きでも正しく動作する', () => {
      const node = makeNode({ outputTimeColumn: null })
      const { sql } = compileGetIds(node, new Map(), 100)

      expect(sql).toContain('LIMIT 100')
      expect(sql).toContain('0 AS created_at_ms')
    })
  })
})
