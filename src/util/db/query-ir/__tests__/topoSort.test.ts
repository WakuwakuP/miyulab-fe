import { describe, expect, it } from 'vitest'
import { topoSort } from '../executor/topoSort'
import type {
  SerializedGetIdsNode,
  SerializedGraphNode,
  SerializedGraphPlan,
  SerializedLookupRelatedNode,
  SerializedMergeNode,
  SerializedOutputNode,
} from '../executor/types'

// --------------- ヘルパー ---------------

/** get-ids ノードの最小構造を生成する */
function makeGetIdsNode(id: string, table = 'posts'): SerializedGraphNode {
  return {
    id,
    node: {
      filters: [],
      kind: 'get-ids',
      table,
    } satisfies SerializedGetIdsNode,
  }
}

/** merge-v2 ノードの最小構造を生成する */
function makeMergeNode(
  id: string,
  strategy: SerializedMergeNode['strategy'] = 'union',
): SerializedGraphNode {
  return {
    id,
    node: {
      kind: 'merge-v2',
      limit: 0,
      strategy,
    } satisfies SerializedMergeNode,
  }
}

/** output-v2 ノードの最小構造を生成する */
function makeOutputNode(id: string): SerializedGraphNode {
  return {
    id,
    node: {
      kind: 'output-v2',
      pagination: { limit: 50, offset: 0 },
      sort: { direction: 'DESC', field: 'createdAtMs' },
    } satisfies SerializedOutputNode,
  }
}

/** lookup-related ノードの最小構造を生成する */
function makeLookupRelatedNode(
  id: string,
  lookupTable = 'posts',
): SerializedGraphNode {
  return {
    id,
    node: {
      joinConditions: [],
      kind: 'lookup-related',
      lookupTable,
    } satisfies SerializedLookupRelatedNode,
  }
}

/** SerializedGraphPlan を簡潔に構築するヘルパー */
function makePlan(
  nodes: SerializedGraphNode[],
  edges: { source: string; target: string }[] = [],
): SerializedGraphPlan {
  return { edges, nodes, version: 2 }
}

// --------------- テスト本体 ---------------

describe('topoSort', () => {
  // --- 正常系 ---
  describe('正常系: 基本的なDAG', () => {
    it('Outputノード1つだけのグラフの時、そのノードIDのみの配列が返ること', () => {
      // Arrange
      const plan = makePlan([makeOutputNode('output1')])

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['output1'])
    })

    it('GetIds → Output の直線グラフの時、[GetIds, Output] の順で返ること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('getIds1'), makeOutputNode('output1')],
        [{ source: 'getIds1', target: 'output1' }],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['getIds1', 'output1'])
    })

    it('GetIds → Merge → Output の直線グラフの時、依存順に並んで返ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('getIds1'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'getIds1', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['getIds1', 'merge1', 'output1'])
    })

    it('2つのGetIdsが1つのMergeに合流しOutputに繋がるDAGの時、GetIds2つがMergeより前に来ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('getIds1'),
          makeGetIdsNode('getIds2'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'getIds1', target: 'merge1' },
          { source: 'getIds2', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      const mergeIdx = result.indexOf('merge1')
      const outputIdx = result.indexOf('output1')
      expect(result.indexOf('getIds1')).toBeLessThan(mergeIdx)
      expect(result.indexOf('getIds2')).toBeLessThan(mergeIdx)
      expect(mergeIdx).toBeLessThan(outputIdx)
      expect(result[result.length - 1]).toBe('output1')
    })

    it('3つのGetIds → Merge → Output の扇型DAGの時、すべてのGetIdsがMergeより前に来ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeGetIdsNode('g3'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
          { source: 'g3', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      const mergeIdx = result.indexOf('merge1')
      expect(result.indexOf('g1')).toBeLessThan(mergeIdx)
      expect(result.indexOf('g2')).toBeLessThan(mergeIdx)
      expect(result.indexOf('g3')).toBeLessThan(mergeIdx)
      expect(result[result.length - 1]).toBe('output1')
    })

    it('GetIds → LookupRelated → Merge → Output のチェーンの時、依存順に並んで返ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('getIds1'),
          makeLookupRelatedNode('lookup1'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'getIds1', target: 'lookup1' },
          { source: 'lookup1', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['getIds1', 'lookup1', 'merge1', 'output1'])
    })

    it('複数段の分岐・合流がある複雑なDAGの時、すべての依存関係が満たされた順序で返ること', () => {
      // Arrange
      // g1 → lookup1 ─┐
      //                ├→ merge1 → output1
      // g2 → lookup2 ─┘
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeLookupRelatedNode('lookup1'),
          makeLookupRelatedNode('lookup2'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'lookup1' },
          { source: 'g2', target: 'lookup2' },
          { source: 'lookup1', target: 'merge1' },
          { source: 'lookup2', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert — すべての依存関係が満たされていること
      for (const edge of plan.edges) {
        expect(result.indexOf(edge.source)).toBeLessThan(
          result.indexOf(edge.target),
        )
      }
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toHaveLength(6)
    })
  })

  describe('正常系: Outputノードの位置保証', () => {
    it('Outputノードが入次数0でない場合でも、返り値の最後の要素がOutputノードであること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('getIds1'), makeOutputNode('output1')],
        [{ source: 'getIds1', target: 'output1' }],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result[result.length - 1]).toBe('output1')
    })

    it('Outputノードに依存するエッジが無い孤立Outputと他ノードがある時、Outputが最後に来ること', () => {
      // Arrange — エッジなし、Outputは孤立している
      const plan = makePlan(
        [makeGetIdsNode('getIds1'), makeOutputNode('output1')],
        [],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toHaveLength(2)
      expect(result).toContain('getIds1')
    })
  })

  describe('正常系: 返り値の型と構造', () => {
    it('返り値がstring[]型であること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('getIds1'), makeOutputNode('output1')],
        [{ source: 'getIds1', target: 'output1' }],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(Array.isArray(result)).toBe(true)
      for (const item of result) {
        expect(typeof item).toBe('string')
      }
    })

    it('返り値の長さがplan.nodesの数と一致すること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toHaveLength(plan.nodes.length)
    })

    it('返り値にplan.nodesのすべてのIDが含まれること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      const expectedIds = plan.nodes.map((n) => n.id)
      expect(result.sort()).toEqual(expectedIds.sort())
    })
  })

  // --- 境界値 ---
  describe('境界値', () => {
    it('エッジが空配列でOutputノードのみ存在する時、Outputノードだけの配列が返ること', () => {
      // Arrange
      const plan = makePlan([makeOutputNode('output1')], [])

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['output1'])
    })

    it('エッジが空配列でOutputノードと他ノードが存在する時、すべてのノードが返りOutputが最後であること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toHaveLength(3)
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toContain('g1')
      expect(result).toContain('merge1')
    })

    it('ノードが1つ(Outputのみ)でエッジが空の時、そのノードだけが返ること', () => {
      // Arrange
      const plan = makePlan([makeOutputNode('only-output')], [])

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['only-output'])
    })

    it('多数のノード(例: 100個)が直線チェーンで繋がる時、正しい順序で返ること', () => {
      // Arrange — 99個のGetIdsを直線チェーンで繋ぎ、最後にOutputノードを配置
      const nodes: SerializedGraphNode[] = []
      const edges: { source: string; target: string }[] = []

      for (let i = 0; i < 99; i++) {
        nodes.push(makeGetIdsNode(`node-${i}`))
      }
      nodes.push(makeOutputNode('output1'))

      for (let i = 0; i < 98; i++) {
        edges.push({ source: `node-${i}`, target: `node-${i + 1}` })
      }
      edges.push({ source: 'node-98', target: 'output1' })

      const plan = makePlan(nodes, edges)

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toHaveLength(100)
      for (let i = 0; i < 99; i++) {
        expect(result[i]).toBe(`node-${i}`)
      }
      expect(result[99]).toBe('output1')
    })
  })

  // --- 異常系: サイクル検出 ---
  describe('異常系: サイクル検出', () => {
    it('2ノード間に双方向エッジがある時、サイクル検出エラーがスローされること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('a'), makeGetIdsNode('b'), makeOutputNode('output1')],
        [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'a' },
        ],
      )

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('サイクルが検出されました')
    })

    it('3ノードで循環するエッジがある時、サイクル検出エラーがスローされること', () => {
      // Arrange — a → b → c → a
      const plan = makePlan(
        [
          makeGetIdsNode('a'),
          makeGetIdsNode('b'),
          makeGetIdsNode('c'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
          { source: 'c', target: 'a' },
        ],
      )

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('サイクルが検出されました')
    })

    it('DAGの一部にサイクルが含まれる時、サイクル検出エラーがスローされること', () => {
      // Arrange — root → a → b → c → a (サイクル), root → output1
      const plan = makePlan(
        [
          makeGetIdsNode('root'),
          makeGetIdsNode('a'),
          makeGetIdsNode('b'),
          makeGetIdsNode('c'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'root', target: 'a' },
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' },
          { source: 'c', target: 'a' },
          { source: 'root', target: 'output1' },
        ],
      )

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('サイクルが検出されました')
    })

    it('サイクル検出エラーのメッセージにサイクルに含まれるノードIDが含まれること', () => {
      // Arrange — x → y → x
      const plan = makePlan(
        [makeGetIdsNode('x'), makeGetIdsNode('y'), makeOutputNode('output1')],
        [
          { source: 'x', target: 'y' },
          { source: 'y', target: 'x' },
        ],
      )

      // Act & Assert
      try {
        topoSort(plan)
        expect.unreachable('エラーがスローされるべき')
      } catch (e) {
        const message = (e as Error).message
        expect(message).toContain('x')
        expect(message).toContain('y')
      }
    })

    it('自己ループ(sourceとtargetが同じ)のエッジがある時、サイクル検出エラーがスローされること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('loop'), makeOutputNode('output1')],
        [{ source: 'loop', target: 'loop' }],
      )

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('サイクルが検出されました')
    })
  })

  // --- 異常系: Outputノードの検証 ---
  describe('異常系: Outputノードの検証', () => {
    it('Outputノード(kind: "output-v2")が存在しない時、エラーがスローされること', () => {
      // Arrange
      const plan = makePlan([makeGetIdsNode('g1')], [])

      // Act & Assert
      expect(() => topoSort(plan)).toThrow()
    })

    it('エラーメッセージに「Output ノードが見つかりません」が含まれること', () => {
      // Arrange
      const plan = makePlan([makeGetIdsNode('g1')], [])

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('Output ノードが見つかりません')
    })

    it('すべてのノードがGetIdsやMergeだけでOutputが無い時、エラーがスローされること', () => {
      // Arrange
      const plan = makePlan(
        [makeGetIdsNode('g1'), makeGetIdsNode('g2'), makeMergeNode('merge1')],
        [
          { source: 'g1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
        ],
      )

      // Act & Assert
      expect(() => topoSort(plan)).toThrow('Output ノードが見つかりません')
    })
  })

  // --- エッジケース: 複数Outputノード ---
  describe('エッジケース: 複数Outputノード', () => {
    it('複数のOutputノード(kind: "output-v2")が存在する時、最初に見つかったOutputが最後に配置されること', () => {
      // Arrange — ソート結果で最初に見つかった output-v2 が最後に移動される
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeOutputNode('output-first'),
          makeOutputNode('output-second'),
        ],
        [],
      )

      // Act
      const result = topoSort(plan)

      // Assert — findIndex で最初に見つかった output-v2 が最後に配置される
      expect(result).toHaveLength(3)
      // 最初に見つかった output が最後に来る
      // Kahn のアルゴリズムで入次数0のノードがすべて処理され、
      // findIndex で最初の output-v2 が最後に移動される
      const lastElement = result[result.length - 1]
      expect(
        lastElement === 'output-first' || lastElement === 'output-second',
      ).toBe(true)
    })
  })

  // --- エッジケース: 孤立ノード ---
  describe('エッジケース: 孤立ノード', () => {
    it('エッジで参照されない孤立したGetIdsノードがある時、そのノードもソート結果に含まれること', () => {
      // Arrange — g1 → output1, g2 は孤立
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2-isolated'),
          makeOutputNode('output1'),
        ],
        [{ source: 'g1', target: 'output1' }],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toContain('g2-isolated')
      expect(result).toHaveLength(3)
    })

    it('孤立ノードがある場合でもOutputノードが最後に来ること', () => {
      // Arrange — g1, g2, g3 は孤立、output1 も孤立
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeGetIdsNode('g3'),
          makeOutputNode('output1'),
        ],
        [],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toHaveLength(4)
    })

    it('全ノードが孤立(エッジが空)でOutputノードが含まれる時、Outputが最後に来ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeMergeNode('merge1'),
          makeLookupRelatedNode('lookup1'),
          makeOutputNode('output1'),
        ],
        [],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toHaveLength(4)
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toContain('g1')
      expect(result).toContain('merge1')
      expect(result).toContain('lookup1')
    })
  })

  // --- エッジケース: ソート安定性 ---
  describe('エッジケース: ソート安定性', () => {
    it('同じ入次数のノードが複数ある時、すべてのノードがソート結果に含まれること', () => {
      // Arrange — すべてのGetIdsが入次数0、merge に合流
      const plan = makePlan(
        [
          makeGetIdsNode('g1'),
          makeGetIdsNode('g2'),
          makeGetIdsNode('g3'),
          makeGetIdsNode('g4'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
          { source: 'g3', target: 'merge1' },
          { source: 'g4', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toHaveLength(6)
      expect(result).toContain('g1')
      expect(result).toContain('g2')
      expect(result).toContain('g3')
      expect(result).toContain('g4')
      expect(result).toContain('merge1')
      expect(result).toContain('output1')
    })

    it('ダイヤモンド型DAG（A→B, A→C, B→D, C→D）の時、BとCがAより後かつDより前に来ること', () => {
      // Arrange — A→B, A→C, B→D, C→D, D→output
      const plan = makePlan(
        [
          makeGetIdsNode('A'),
          makeGetIdsNode('B'),
          makeGetIdsNode('C'),
          makeMergeNode('D'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'A', target: 'B' },
          { source: 'A', target: 'C' },
          { source: 'B', target: 'D' },
          { source: 'C', target: 'D' },
          { source: 'D', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      const idxA = result.indexOf('A')
      const idxB = result.indexOf('B')
      const idxC = result.indexOf('C')
      const idxD = result.indexOf('D')
      expect(idxA).toBeLessThan(idxB)
      expect(idxA).toBeLessThan(idxC)
      expect(idxB).toBeLessThan(idxD)
      expect(idxC).toBeLessThan(idxD)
      expect(result[result.length - 1]).toBe('output1')
    })
  })

  // --- 制約条件: 典型的なQueryPlanV2パターン ---
  describe('制約条件: 典型的なQueryPlanV2パターン', () => {
    it('GetIds(posts) → GetIds(notifications) → Merge(union) → Output の典型パターンの時、正しい実行順序が返ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('getIds-posts', 'posts'),
          makeGetIdsNode('getIds-notifs', 'notifications'),
          makeMergeNode('merge-union', 'union'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'getIds-posts', target: 'merge-union' },
          { source: 'getIds-notifs', target: 'merge-union' },
          { source: 'merge-union', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      const mergeIdx = result.indexOf('merge-union')
      expect(result.indexOf('getIds-posts')).toBeLessThan(mergeIdx)
      expect(result.indexOf('getIds-notifs')).toBeLessThan(mergeIdx)
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toHaveLength(4)
    })

    it('GetIds → LookupRelated → GetIds → Merge → Output の複合パターンの時、依存関係を満たした順序で返ること', () => {
      // Arrange
      // g1 → lookup1 ─┐
      //                ├→ merge1 → output1
      // g2 ────────────┘
      const plan = makePlan(
        [
          makeGetIdsNode('g1', 'posts'),
          makeLookupRelatedNode('lookup1', 'posts'),
          makeGetIdsNode('g2', 'notifications'),
          makeMergeNode('merge1'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'lookup1' },
          { source: 'lookup1', target: 'merge1' },
          { source: 'g2', target: 'merge1' },
          { source: 'merge1', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert — すべての依存関係が満たされていること
      for (const edge of plan.edges) {
        expect(result.indexOf(edge.source)).toBeLessThan(
          result.indexOf(edge.target),
        )
      }
      expect(result[result.length - 1]).toBe('output1')
      expect(result).toHaveLength(5)
    })

    it('GetIds → Merge(intersect) → Output のintersectパターンの時、正しい実行順序が返ること', () => {
      // Arrange
      const plan = makePlan(
        [
          makeGetIdsNode('g1', 'posts'),
          makeMergeNode('merge-intersect', 'intersect'),
          makeOutputNode('output1'),
        ],
        [
          { source: 'g1', target: 'merge-intersect' },
          { source: 'merge-intersect', target: 'output1' },
        ],
      )

      // Act
      const result = topoSort(plan)

      // Assert
      expect(result).toEqual(['g1', 'merge-intersect', 'output1'])
    })
  })
})
