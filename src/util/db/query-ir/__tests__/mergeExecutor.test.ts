import { describe, expect, it } from 'vitest'
import { executeMerge } from '../executor/mergeExecutor'
import type { NodeOutput } from '../executor/types'
import type { MergeNodeV2 } from '../nodes'

// --------------- ヘルパー ---------------

/** MergeNodeV2 を簡潔に生成する */
function mkNode(strategy: MergeNodeV2['strategy'], limit = 0): MergeNodeV2 {
  return { kind: 'merge-v2', limit, strategy }
}

/** NodeOutput を簡潔に生成する */
function mkInput(
  rows: { id: number; createdAtMs: number; table?: string }[],
  hash = 'h',
  sourceTable = 'posts',
): NodeOutput {
  return {
    hash,
    rows: rows.map((r) => ({ ...r, table: r.table ?? sourceTable })),
    sourceTable,
  }
}

describe('executeMerge', () => {
  // =============================================================
  // --- 正常系: union strategy ---
  // =============================================================
  describe('strategy: union', () => {
    it('複数入力に異なるIDの行がある時、すべての行が和集合として返ること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 150, id: 3 },
            { createdAtMs: 50, id: 4 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(4)
      const ids = result.rows.map((r) => r.id)
      expect(ids).toContain(1)
      expect(ids).toContain(2)
      expect(ids).toContain(3)
      expect(ids).toContain(4)
    })

    it('複数入力に同一IDの行が重複している時、IDが重複排除されて1件ずつになること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 300, id: 2 },
            { createdAtMs: 50, id: 3 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
      const ids = result.rows.map((r) => r.id)
      expect(ids).toEqual(expect.arrayContaining([1, 2, 3]))
      // ID=2 は1件のみ
      expect(ids.filter((id) => id === 2)).toHaveLength(1)
    })

    it('重複排除時、最初に出現した入力の行データが採用されること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a'),
        mkInput([{ createdAtMs: 999, id: 1 }], 'b'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（最初の入力の createdAtMs=100 が採用される）
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(1)
      expect(result.rows[0].createdAtMs).toBe(100)
    })

    it('(table, id) 複合キーで重複排除 — 異なるテーブルの同一IDは共存する', () => {
      // Arrange: posts.id=1 と notifications.id=1 は別の行
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a', 'posts'),
        mkInput([{ createdAtMs: 200, id: 1 }], 'b', 'notifications'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert: 異なるテーブルなので両方残る
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.table)).toEqual(
        expect.arrayContaining(['posts', 'notifications']),
      )
    })

    it('(table, id) 複合キーで重複排除 — 同一テーブルの同一IDは1件にまとめられる', () => {
      // Arrange: 両方 posts.id=1
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1, table: 'posts' }], 'a', 'posts'),
        mkInput([{ createdAtMs: 200, id: 1, table: 'posts' }], 'b', 'posts'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert: 同一テーブル・同一IDなので1件
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].table).toBe('posts')
    })

    it('和集合の結果がcreatedAtMsの降順でソートされて返ること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 300, id: 2 },
          ],
          'a',
        ),
        mkInput([{ createdAtMs: 200, id: 3 }], 'b'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows.map((r) => r.id)).toEqual([2, 3, 1])
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 200, 100])
    })

    it('単一入力の時、その入力の行がそのまま返ること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 100, id: 2 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（降順ソートされる）
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.id)).toEqual([1, 2])
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 100])
    })

    it('3つ以上の入力がある時、すべての入力の和集合が正しく計算されること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 300, id: 1 }], 'a'),
        mkInput(
          [
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 999, id: 1 },
          ],
          'b',
        ),
        mkInput(
          [
            { createdAtMs: 100, id: 3 },
            { createdAtMs: 888, id: 2 },
          ],
          'c',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
      expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3])
      // 先着優先: id=1 は入力a(300), id=2 は入力b(200)
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 200, 100])
    })
  })

  // =============================================================
  // --- 正常系: intersect strategy ---
  // =============================================================
  describe('strategy: intersect', () => {
    it('2つの入力に共通するIDのみが結果に含まれること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 300, id: 3 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 250, id: 2 },
            { createdAtMs: 350, id: 3 },
            { createdAtMs: 400, id: 4 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      const ids = result.rows.map((r) => r.id)
      expect(ids).toEqual(expect.arrayContaining([2, 3]))
      expect(ids).toHaveLength(2)
      expect(ids).not.toContain(1)
      expect(ids).not.toContain(4)
    })

    it('3つ以上の入力がある時、すべての入力に共通するIDのみが結果に含まれること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 300, id: 3 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 250, id: 2 },
            { createdAtMs: 350, id: 3 },
            { createdAtMs: 400, id: 4 },
          ],
          'b',
        ),
        mkInput(
          [
            { createdAtMs: 370, id: 3 },
            { createdAtMs: 410, id: 4 },
            { createdAtMs: 500, id: 5 },
          ],
          'c',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（id=3 のみが全3入力に共通）
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(3)
    })

    it('共通集合の結果がcreatedAtMsの降順でソートされて返ること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 300, id: 2 },
            { createdAtMs: 200, id: 3 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 150, id: 1 },
            { createdAtMs: 350, id: 2 },
            { createdAtMs: 250, id: 3 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（inputs[0] の行が使われ、降順ソート）
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 200, 100])
    })

    it('共通IDの行データが最初の入力から取得されること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a'),
        mkInput([{ createdAtMs: 999, id: 1 }], 'b'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（inputs[0] の createdAtMs が採用される）
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(1)
      expect(result.rows[0].createdAtMs).toBe(100)
    })

    it('単一入力の時、その入力の行がそのままコピーされて返ること', () => {
      // Arrange
      const node = mkNode('intersect')
      const originalRows = [
        { createdAtMs: 300, id: 1 },
        { createdAtMs: 100, id: 2 },
      ]
      const inputs: NodeOutput[] = [mkInput(originalRows, 'a')]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.id)).toEqual(
        expect.arrayContaining([1, 2]),
      )
    })

    it('2つの入力に共通するIDが1件もない時、空配列が返ること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 300, id: 3 },
            { createdAtMs: 400, id: 4 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(0)
    })

    it('すべての入力が完全に同一のIDセットを持つ時、全IDが結果に含まれること', () => {
      // Arrange
      const node = mkNode('intersect')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 150, id: 1 },
            { createdAtMs: 250, id: 2 },
          ],
          'b',
        ),
        mkInput(
          [
            { createdAtMs: 180, id: 1 },
            { createdAtMs: 280, id: 2 },
          ],
          'c',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.id)).toEqual(
        expect.arrayContaining([1, 2]),
      )
    })
  })

  // =============================================================
  // --- 正常系: interleave-by-time strategy ---
  // =============================================================
  describe('strategy: interleave-by-time', () => {
    it('複数入力の行がcreatedAtMsの降順でインターリーブされて返ること', () => {
      // Arrange
      const node = mkNode('interleave-by-time')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 100, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 250, id: 3 },
            { createdAtMs: 50, id: 4 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows.map((r) => r.id)).toEqual([1, 3, 2, 4])
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 250, 100, 50])
    })

    it('複数入力に同一IDが存在する時、重複排除されること', () => {
      // Arrange
      const node = mkNode('interleave-by-time')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 999, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
      const ids = result.rows.map((r) => r.id)
      expect(ids.filter((id) => id === 2)).toHaveLength(1)
    })

    it('単一入力の時、その入力の行がcreatedAtMs降順で返ること', () => {
      // Arrange
      const node = mkNode('interleave-by-time')
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 300, id: 2 },
            { createdAtMs: 200, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows.map((r) => r.id)).toEqual([2, 3, 1])
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([300, 200, 100])
    })

    it('3つ以上の入力がある時、すべての行が時間降順で正しくインターリーブされること', () => {
      // Arrange
      const node = mkNode('interleave-by-time')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 500, id: 1 }], 'a'),
        mkInput([{ createdAtMs: 400, id: 2 }], 'b'),
        mkInput([{ createdAtMs: 300, id: 3 }], 'c'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3])
      expect(result.rows.map((r) => r.createdAtMs)).toEqual([500, 400, 300])
    })

    // --- 境界値: 同時刻 ---
    it('異なるIDで同一のcreatedAtMsを持つ行がある時、両方とも結果に含まれること', () => {
      // Arrange
      const node = mkNode('interleave-by-time')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 200, id: 1 }], 'a'),
        mkInput([{ createdAtMs: 200, id: 2 }], 'b'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(2)
      const ids = result.rows.map((r) => r.id)
      expect(ids).toContain(1)
      expect(ids).toContain(2)
    })
  })

  // =============================================================
  // --- 境界値: 空入力・単一入力 ---
  // =============================================================
  describe('空入力・単一入力', () => {
    it("inputsが空配列の時、hash='merge:empty'・rows=[]・sourceTable='posts'が返ること", () => {
      // Arrange
      const node = mkNode('union')

      // Act
      const result = executeMerge(node, [])

      // Assert
      expect(result.hash).toBe('merge:empty')
      expect(result.rows).toEqual([])
      expect(result.sourceTable).toBe('posts')
    })

    it('すべての入力のrowsが空配列の時、結果のrowsも空配列になること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [mkInput([], 'a'), mkInput([], 'b')]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toEqual([])
    })

    it('入力が1件だけの時、その入力の行がstrategyに応じて処理されて返ること', () => {
      // Arrange
      const rows = [
        { createdAtMs: 100, id: 1 },
        { createdAtMs: 200, id: 2 },
      ]

      // Act（各 strategy で単一入力の結果が同じ行を含むことを確認）
      const unionResult = executeMerge(mkNode('union'), [mkInput(rows, 'a')])
      const intersectResult = executeMerge(mkNode('intersect'), [
        mkInput(rows, 'a'),
      ])
      const interleaveResult = executeMerge(mkNode('interleave-by-time'), [
        mkInput(rows, 'a'),
      ])

      // Assert（全 strategy で行数が同じ）
      expect(unionResult.rows).toHaveLength(2)
      expect(intersectResult.rows).toHaveLength(2)
      expect(interleaveResult.rows).toHaveLength(2)

      // Assert（union と interleave-by-time は降順ソートされる）
      expect(unionResult.rows.map((r) => r.createdAtMs)).toEqual([200, 100])
      expect(interleaveResult.rows.map((r) => r.createdAtMs)).toEqual([
        200, 100,
      ])

      // Assert（intersect の単一入力はソートせずコピーを返す）
      expect(intersectResult.rows.map((r) => r.id)).toEqual(
        expect.arrayContaining([1, 2]),
      )
      expect(intersectResult.rows).toHaveLength(2)
    })
  })

  // =============================================================
  // --- sourceTable 推論 ---
  // =============================================================
  describe('sourceTable推論', () => {
    it('すべての入力のsourceTableが同一の時、その値がsourceTableとして返ること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a', 'posts'),
        mkInput([{ createdAtMs: 200, id: 2 }], 'b', 'posts'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.sourceTable).toBe('posts')
    })

    it("すべての入力のsourceTableが'notifications'の時、'notifications'が返ること", () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a', 'notifications'),
        mkInput([{ createdAtMs: 200, id: 2 }], 'b', 'notifications'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.sourceTable).toBe('notifications')
    })

    it("入力のsourceTableが混在している時、sourceTableが'mixed'になること", () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a', 'posts'),
        mkInput([{ createdAtMs: 200, id: 2 }], 'b', 'notifications'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.sourceTable).toBe('mixed')
    })

    it('入力が1件の時、その入力のsourceTableがそのまま返ること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'a', 'notifications'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.sourceTable).toBe('notifications')
    })
  })

  // =============================================================
  // --- limit 適用 ---
  // =============================================================
  describe('limit適用', () => {
    it('結果の行数がlimitを超過する時、先頭からlimit件に切り詰められること', () => {
      // Arrange
      const node = mkNode('union', 2)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.id)).toEqual([1, 2])
    })

    it('結果の行数がlimit未満の時、すべての行がそのまま返ること', () => {
      // Arrange
      const node = mkNode('union', 10)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 200, id: 1 },
            { createdAtMs: 100, id: 2 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(2)
    })

    it('結果の行数がlimitとちょうど同じ時、すべての行がそのまま返ること', () => {
      // Arrange
      const node = mkNode('union', 3)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
    })

    it('limitが0の時、limit適用がスキップされ全件が返ること', () => {
      // Arrange
      const node = mkNode('union', 0)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
    })

    it('limitが負の値の時、limit適用がスキップされ全件が返ること', () => {
      // Arrange
      const node = mkNode('union', -5)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(3)
    })

    it('limitが1の時、結果が1件のみに切り詰められること', () => {
      // Arrange
      const node = mkNode('union', 1)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'a',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(1)
    })
  })

  // =============================================================
  // --- hash 生成 ---
  // =============================================================
  describe('hash生成', () => {
    it("生成されるhashが'merge:{strategy}:{inputHashes}:{rowCount}'の形式であること", () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'hash-a'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.hash).toBe('merge:union:hash-a:1')
    })

    it('同一の入力とstrategyの時、同一のhashが生成されること', () => {
      // Arrange
      const node = mkNode('union')
      const makeInputs = (): NodeOutput[] => [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'x',
        ),
      ]

      // Act
      const result1 = executeMerge(node, makeInputs())
      const result2 = executeMerge(node, makeInputs())

      // Assert
      expect(result1.hash).toBe(result2.hash)
    })

    it('入力のhashが異なる時、異なるhashが生成されること', () => {
      // Arrange
      const node = mkNode('union')
      const inputs1: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'hash-alpha'),
      ]
      const inputs2: NodeOutput[] = [
        mkInput([{ createdAtMs: 100, id: 1 }], 'hash-beta'),
      ]

      // Act
      const result1 = executeMerge(node, inputs1)
      const result2 = executeMerge(node, inputs2)

      // Assert
      expect(result1.hash).not.toBe(result2.hash)
    })

    it('strategyが異なる時、同一の入力でも異なるhashが生成されること', () => {
      // Arrange
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 100, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'same',
        ),
      ]

      // Act
      const unionResult = executeMerge(mkNode('union'), inputs)
      const intersectResult = executeMerge(mkNode('intersect'), inputs)

      // Assert
      expect(unionResult.hash).not.toBe(intersectResult.hash)
      expect(unionResult.hash).toContain('union')
      expect(intersectResult.hash).toContain('intersect')
    })

    it("複数入力のhashが'+'で連結されてhashに含まれること", () => {
      // Arrange
      const node = mkNode('union')
      const inputs: NodeOutput[] = [
        mkInput([{ createdAtMs: 200, id: 1 }], 'aaa'),
        mkInput([{ createdAtMs: 100, id: 2 }], 'bbb'),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert
      expect(result.hash).toContain('aaa+bbb')
      expect(result.hash).toBe('merge:union:aaa+bbb:2')
    })

    it('limit適用後の行数がhashに反映されること', () => {
      // Arrange
      const node = mkNode('union', 1)
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'h',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（limit=1 で切り詰められた後の行数 "1" が含まれる）
      expect(result.rows).toHaveLength(1)
      expect(result.hash).toBe('merge:union:h:1')
    })

    it("inputsが空配列の時、hashが'merge:empty'であること", () => {
      // Arrange
      const node = mkNode('union')

      // Act
      const result = executeMerge(node, [])

      // Assert
      expect(result.hash).toBe('merge:empty')
    })
  })

  // =============================================================
  // --- 異常系: 未知のstrategy ---
  // =============================================================
  describe('未知のstrategy', () => {
    it('未知のstrategyが指定された時、unionとして処理されること', () => {
      // Arrange
      const node = {
        kind: 'merge-v2',
        limit: 0,
        strategy: 'unknown-strategy',
      } as unknown as MergeNodeV2
      const inputs: NodeOutput[] = [
        mkInput(
          [
            { createdAtMs: 300, id: 1 },
            { createdAtMs: 200, id: 2 },
          ],
          'a',
        ),
        mkInput(
          [
            { createdAtMs: 999, id: 2 },
            { createdAtMs: 100, id: 3 },
          ],
          'b',
        ),
      ]

      // Act
      const result = executeMerge(node, inputs)

      // Assert（union と同様: 重複排除 + 先着優先 + 降順ソート）
      expect(result.rows).toHaveLength(3)
      expect(result.rows.map((r) => r.id)).toEqual([1, 2, 3])
      // id=2 は先着入力(a)の createdAtMs=200 が採用される
      expect(result.rows.find((r) => r.id === 2)?.createdAtMs).toBe(200)
    })
  })
})
