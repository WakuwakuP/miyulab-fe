import { describe, expect, it } from 'vitest'
import { compileGetIds } from '../executor/getIdsExecutor'
import type { NodeOutput } from '../executor/types'
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

  describe('upstreamSourceNodeId によるフィルタ値注入', () => {
    // --- 正常系 ---
    it('IN演算子で上流ノードにIDがある時、WHERE句にIN (?, ?, ...)が生成されること', () => {
      // Arrange
      const upstreamRows = [
        { createdAtMs: 1000, id: 10, table: 'posts' },
        { createdAtMs: 2000, id: 20, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('p.id IN (?, ?)')
    })

    it('NOT IN演算子で上流ノードにIDがある時、WHERE句にNOT IN (?, ?, ...)が生成されること', () => {
      // Arrange
      const upstreamRows = [
        { createdAtMs: 1000, id: 10, table: 'posts' },
        { createdAtMs: 2000, id: 20, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'NOT IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('p.id NOT IN (?, ?)')
    })

    it('binds配列に上流ノードの出力IDが正しい順序で含まれること', () => {
      // Arrange
      const upstreamRows = [
        { createdAtMs: 3000, id: 30, table: 'posts' },
        { createdAtMs: 1000, id: 10, table: 'posts' },
        { createdAtMs: 2000, id: 20, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { binds } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(binds).toEqual([30, 10, 20])
    })

    // --- 境界値 ---
    it('IN演算子で上流ノードの出力が空配列の時、常にfalseとなる条件（0）が生成されること', () => {
      // Arrange
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: [], sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('WHERE 0')
      expect(binds).toEqual([])
    })

    it('NOT IN演算子で上流ノードの出力が空配列の時、常にtrueとなる条件（1）が生成されること', () => {
      // Arrange
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: [], sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'NOT IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('WHERE 1')
      expect(binds).toEqual([])
    })

    it('upstreamSourceNodeIdが存在しないノードIDを参照する時、上流が空と同じ挙動になること', () => {
      // Arrange
      const upstreamOutputs = new Map<string, NodeOutput>()
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'non-existent-node',
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert（IN + 空 → 常にfalse '0'）
      expect(sql).toContain('WHERE 0')
      expect(binds).toEqual([])
    })

    it('上流ノードの出力が1件だけの時、IN (?)のプレースホルダが1つ生成されること', () => {
      // Arrange
      const upstreamRows = [{ createdAtMs: 1000, id: 42, table: 'posts' }]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('p.id IN (?)')
      expect(binds).toEqual([42])
    })

    // --- 複合条件 ---
    it('通常の静的フィルタとupstreamフィルタが混在する時、両方のWHERE条件がANDで結合されること', () => {
      // Arrange
      const upstreamRows = [
        { createdAtMs: 1000, id: 10, table: 'posts' },
        { createdAtMs: 2000, id: 20, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'is_sensitive',
            op: '=',
            table: 'posts',
            value: 0,
          },
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { sql } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('WHERE')
      expect(sql).toContain('p.is_sensitive = ?')
      expect(sql).toContain('p.id IN (?, ?)')
      const whereMatch = sql.match(/WHERE\s+(.+?)\s+ORDER/)
      expect(whereMatch).not.toBeNull()
      expect(whereMatch?.[1]).toContain(' AND ')
    })

    it('通常の静的フィルタとupstreamフィルタが混在する時、binds配列に両方の値が含まれること', () => {
      // Arrange
      const upstreamRows = [
        { createdAtMs: 1000, id: 10, table: 'posts' },
        { createdAtMs: 2000, id: 20, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'h1', rows: upstreamRows, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'is_sensitive',
            op: '=',
            table: 'posts',
            value: 0,
          },
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-a',
          },
        ],
      })

      // Act
      const { binds } = compileGetIds(node, upstreamOutputs)

      // Assert（静的フィルタの値 0 + upstream IDs 10, 20）
      expect(binds).toEqual([0, 10, 20])
    })

    // --- 制約条件 ---
    it('upstreamSourceNodeIdが未設定のフィルタは従来通り静的なvalueでSQL生成されること', () => {
      // Arrange
      const upstreamOutputs = new Map<string, NodeOutput>()
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            value: [100, 200, 300],
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert
      expect(sql).toContain('p.id IN (?, ?, ?)')
      expect(binds).toEqual([100, 200, 300])
    })

    it('upstreamOutputsのMapに複数ノードがある時、upstreamSourceNodeIdに一致するノードのみ参照されること', () => {
      // Arrange
      const rowsA = [{ createdAtMs: 1000, id: 10, table: 'posts' }]
      const rowsB = [
        { createdAtMs: 5000, id: 50, table: 'posts' },
        { createdAtMs: 6000, id: 60, table: 'posts' },
      ]
      const upstreamOutputs = new Map<string, NodeOutput>([
        ['node-a', { hash: 'ha', rows: rowsA, sourceTable: 'posts' }],
        ['node-b', { hash: 'hb', rows: rowsB, sourceTable: 'posts' }],
      ])
      const node = makeNode({
        filters: [
          {
            column: 'id',
            op: 'IN',
            table: 'posts',
            upstreamSourceNodeId: 'node-b',
          },
        ],
      })

      // Act
      const { sql, binds } = compileGetIds(node, upstreamOutputs)

      // Assert（node-b の ID のみ使用される）
      expect(sql).toContain('p.id IN (?, ?)')
      expect(binds).toEqual([50, 60])
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
