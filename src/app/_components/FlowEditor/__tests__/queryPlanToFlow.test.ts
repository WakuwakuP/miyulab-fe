import type {
  GetIdsNode,
  LookupRelatedNode,
  MergeNodeV2,
  OutputNodeV2,
  QueryPlanV2,
  QueryPlanV2Edge,
  QueryPlanV2Node,
} from 'util/db/query-ir/nodes'
import { describe, expect, it } from 'vitest'
import { flowToQueryPlanV2 } from '../flowToQueryPlanV2'
import { queryPlanToFlow } from '../queryPlanToFlow'
import type { FlowGraphState } from '../types'

// ============================================================
// テストヘルパー: 最小限の QueryPlanV2 ノード/エッジ/プラン生成
// ============================================================

const makeGetIds = (id: string, table = 'posts'): QueryPlanV2Node => ({
  id,
  node: {
    filters: [],
    kind: 'get-ids',
    table,
  } satisfies GetIdsNode,
})

const makeLookup = (
  id: string,
  lookupTable = 'post_media',
): QueryPlanV2Node => ({
  id,
  node: {
    joinConditions: [{ inputColumn: 'id', lookupColumn: 'post_id' }],
    kind: 'lookup-related',
    lookupTable,
  } satisfies LookupRelatedNode,
})

const makeMerge = (
  id: string,
  strategy: MergeNodeV2['strategy'] = 'interleave-by-time',
  limit = 40,
): QueryPlanV2Node => ({
  id,
  node: {
    kind: 'merge-v2',
    limit,
    strategy,
  } satisfies MergeNodeV2,
})

const makeOutput = (id: string): QueryPlanV2Node => ({
  id,
  node: {
    kind: 'output-v2',
    pagination: { limit: 40 },
    sort: { direction: 'DESC', field: 'created_at_ms' },
  } satisfies OutputNodeV2,
})

const pe = (source: string, target: string): QueryPlanV2Edge => ({
  source,
  target,
})

const v2 = (
  nodes: QueryPlanV2Node[],
  edges: QueryPlanV2Edge[],
): QueryPlanV2 => ({
  edges,
  nodes,
  version: 2,
})

/** ID でノードを検索するヘルパー */
const findNode = (result: FlowGraphState, id: string) =>
  result.nodes.find((n) => n.id === id)

// ============================================================
// queryPlanToFlow: QueryPlan(V1/V2) → FlowGraphState
// ============================================================

describe('queryPlanToFlow', () => {
  describe('基本的な変換', () => {
    it('getIds → output の2ノード構成の時、ノード数2・エッジ数1のFlowGraphStateが返ること', () => {
      // Arrange
      const plan = v2([makeGetIds('a'), makeOutput('b')], [pe('a', 'b')])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toHaveLength(1)
    })

    it('getIds → output の2ノード構成の時、エッジのsource/targetが正しく設定されること', () => {
      // Arrange
      const plan = v2([makeGetIds('a'), makeOutput('b')], [pe('a', 'b')])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.edges[0].source).toBe('a')
      expect(result.edges[0].target).toBe('b')
    })

    it('getIds → lookupRelated → output の3ノード直列構成の時、ノード数3・エッジ数2が返ること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
        [pe('a', 'b'), pe('b', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.nodes).toHaveLength(3)
      expect(result.edges).toHaveLength(2)
    })

    it('2つのgetIds → merge → output の分岐合流構成の時、ノード数4・エッジ数3が返ること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeGetIds('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'c'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.nodes).toHaveLength(4)
      expect(result.edges).toHaveLength(3)
    })

    it('各ノードのtypeがQueryPlanV2Nodeのkindに対応した値で設定されること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'b'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.type).toBe('get-ids')
      expect(findNode(result, 'b')?.type).toBe('lookup-related')
      expect(findNode(result, 'c')?.type).toBe('merge-v2')
      expect(findNode(result, 'd')?.type).toBe('output-v2')
    })

    it('各ノードのdata.configに元のQueryPlanV2Nodeのnodeがそのまま格納されること', () => {
      // Arrange
      const getIdsEntry = makeGetIds('a')
      const outputEntry = makeOutput('b')
      const plan = v2([getIdsEntry, outputEntry], [pe('a', 'b')])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.data.config).toEqual(getIdsEntry.node)
      expect(findNode(result, 'b')?.data.config).toEqual(outputEntry.node)
    })

    it('各ノードのdata.nodeTypeがkindと一致すること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'b'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.data.nodeType).toBe('get-ids')
      expect(findNode(result, 'b')?.data.nodeType).toBe('lookup-related')
      expect(findNode(result, 'c')?.data.nodeType).toBe('merge-v2')
      expect(findNode(result, 'd')?.data.nodeType).toBe('output-v2')
    })

    it("エッジのidが 'e-{source}-{target}-{index}' の形式で生成されること", () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
        [pe('a', 'b'), pe('b', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.edges[0].id).toBe('e-a-b-0')
      expect(result.edges[1].id).toBe('e-b-c-1')
    })
  })

  describe('ノード位置計算', () => {
    it('outputノード（depth=0）はx = INITIAL_X + maxDepth * NODE_X_GAP の位置に配置されること', () => {
      // Arrange — 3ノード直列: maxDepth=2, INITIAL_X=50, NODE_X_GAP=280
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
        [pe('a', 'b'), pe('b', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert — output: x = 50 + 2 * 280 = 610
      expect(findNode(result, 'c')?.position.x).toBe(610)
    })

    it('getIds → output の2ノード構成の時、getIdsのxが50、outputのxが330であること', () => {
      // Arrange — maxDepth=1
      const plan = v2([makeGetIds('a'), makeOutput('b')], [pe('a', 'b')])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.position.x).toBe(50)
      expect(findNode(result, 'b')?.position.x).toBe(330)
    })

    it('getIds → lookupRelated → output の3ノード直列構成の時、各ノードのxが50, 330, 610であること', () => {
      // Arrange — maxDepth=2
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
        [pe('a', 'b'), pe('b', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.position.x).toBe(50)
      expect(findNode(result, 'b')?.position.x).toBe(330)
      expect(findNode(result, 'c')?.position.x).toBe(610)
    })

    it('同じ深さに複数ノードがある時、y座標がINITIAL_Y + index * NODE_Y_GAP で割り振られること', () => {
      // Arrange — 2つの getIds が同じ深さ(2)に配置される
      const plan = v2(
        [makeGetIds('a'), makeGetIds('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'c'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert — INITIAL_Y=50, NODE_Y_GAP=120
      expect(findNode(result, 'a')?.position.y).toBe(50)
      expect(findNode(result, 'b')?.position.y).toBe(170)
    })

    it('2つのgetIds → merge → output の構成で、2つのgetIdsのy座標が50と170であること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeGetIds('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'c'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(findNode(result, 'a')?.position.y).toBe(50)
      expect(findNode(result, 'b')?.position.y).toBe(170)
    })

    it('同じ深さのノードがIDの辞書順でソートされた順にy座標が割り振られること', () => {
      // Arrange — 'z-node' は配列では先だが辞書順では 'a-node' の後
      const plan = v2(
        [
          makeGetIds('z-node'),
          makeGetIds('a-node'),
          makeMerge('m'),
          makeOutput('out'),
        ],
        [pe('z-node', 'm'), pe('a-node', 'm'), pe('m', 'out')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert — 辞書順: 'a-node' < 'z-node'
      expect(findNode(result, 'a-node')?.position.y).toBe(50)
      expect(findNode(result, 'z-node')?.position.y).toBe(170)
    })
  })

  describe('深さ計算', () => {
    it('ダイヤモンド形状（A→C, B→C, C→output）の時、A・Bの深さが2、Cの深さが1であること', () => {
      // Arrange
      const plan = v2(
        [makeGetIds('a'), makeGetIds('b'), makeMerge('c'), makeOutput('d')],
        [pe('a', 'c'), pe('b', 'c'), pe('c', 'd')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert — maxDepth=2
      // depth=2: x = 50 + (2-2)*280 = 50
      // depth=1: x = 50 + (2-1)*280 = 330
      // depth=0: x = 50 + (2-0)*280 = 610
      expect(findNode(result, 'a')?.position.x).toBe(50)
      expect(findNode(result, 'b')?.position.x).toBe(50)
      expect(findNode(result, 'c')?.position.x).toBe(330)
      expect(findNode(result, 'd')?.position.x).toBe(610)
    })

    it('同一ノードに複数パスがある時、最も深いパスの値が採用されること', () => {
      // Arrange — A→B→output かつ A→output（Aは深さ1と深さ2の2つのパスを持つ）
      const plan = v2(
        [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
        [pe('a', 'b'), pe('b', 'c'), pe('a', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert — maxDepth=2, Aの深さは最大値の2が採用される
      // depth=2 → x=50, depth=1 → x=330, depth=0 → x=610
      expect(findNode(result, 'a')?.position.x).toBe(50)
      expect(findNode(result, 'b')?.position.x).toBe(330)
      expect(findNode(result, 'c')?.position.x).toBe(610)
    })
  })

  describe('境界値', () => {
    it('ノードが0件の時、空の { nodes: [], edges: [] } が返ること', () => {
      // Arrange
      const plan = v2([], [])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result).toEqual({ edges: [], nodes: [] })
    })

    it('output-v2ノードが存在しない時、空の { nodes: [], edges: [] } が返ること', () => {
      // Arrange — output ノードがない
      const plan = v2([makeGetIds('a')], [])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result).toEqual({ edges: [], nodes: [] })
    })

    it('エッジが0件でoutputノードのみ存在する時、ノード1件・エッジ0件が返ること', () => {
      // Arrange
      const plan = v2([makeOutput('out')], [])

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      expect(result.nodes).toHaveLength(1)
      expect(result.edges).toHaveLength(0)
      expect(result.nodes[0].id).toBe('out')
      expect(result.nodes[0].type).toBe('output-v2')
    })

    it('outputノードに接続されていない孤立ノードは含まれないこと', () => {
      // Arrange — 'b' はどのエッジにも含まれず output から到達不能
      const plan = v2(
        [makeGetIds('a'), makeGetIds('b'), makeOutput('c')],
        [pe('a', 'c')],
      )

      // Act
      const result = queryPlanToFlow(plan)

      // Assert
      const nodeIds = result.nodes.map((n) => n.id)
      expect(nodeIds).toContain('a')
      expect(nodeIds).toContain('c')
      expect(nodeIds).not.toContain('b')
      expect(result.nodes).toHaveLength(2)
    })
  })
})

// ============================================================
// flowToQueryPlanV2: FlowGraphState → QueryPlanV2
// ============================================================

describe('flowToQueryPlanV2', () => {
  describe('基本的な変換', () => {
    it('返却オブジェクトのversionが2であること', () => {
      // Arrange
      const graph = queryPlanToFlow(
        v2([makeGetIds('a'), makeOutput('b')], [pe('a', 'b')]),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      expect(result.version).toBe(2)
    })

    it('get-idsタイプのFlowNodeが正しくQueryPlanV2Nodeに変換されること', () => {
      // Arrange
      const getIdsEntry = makeGetIds('a', 'posts')
      const graph = queryPlanToFlow(
        v2([getIdsEntry, makeOutput('b')], [pe('a', 'b')]),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      const node = result.nodes.find((n) => n.id === 'a')
      expect(node).toBeDefined()
      expect(node?.node).toEqual(getIdsEntry.node)
      expect(node?.node.kind).toBe('get-ids')
    })

    it('lookup-relatedタイプのFlowNodeが正しくQueryPlanV2Nodeに変換されること', () => {
      // Arrange
      const lookupEntry = makeLookup('b')
      const graph = queryPlanToFlow(
        v2(
          [makeGetIds('a'), lookupEntry, makeOutput('c')],
          [pe('a', 'b'), pe('b', 'c')],
        ),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      const node = result.nodes.find((n) => n.id === 'b')
      expect(node).toBeDefined()
      expect(node?.node).toEqual(lookupEntry.node)
      expect(node?.node.kind).toBe('lookup-related')
    })

    it('merge-v2タイプのFlowNodeが正しくQueryPlanV2Nodeに変換されること', () => {
      // Arrange
      const mergeEntry = makeMerge('c', 'union', 100)
      const graph = queryPlanToFlow(
        v2(
          [makeGetIds('a'), makeGetIds('b'), mergeEntry, makeOutput('d')],
          [pe('a', 'c'), pe('b', 'c'), pe('c', 'd')],
        ),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      const node = result.nodes.find((n) => n.id === 'c')
      expect(node).toBeDefined()
      expect(node?.node).toEqual(mergeEntry.node)
      expect(node?.node.kind).toBe('merge-v2')
    })

    it('output-v2タイプのFlowNodeが正しくQueryPlanV2Nodeに変換されること', () => {
      // Arrange
      const outputEntry = makeOutput('b')
      const graph = queryPlanToFlow(
        v2([makeGetIds('a'), outputEntry], [pe('a', 'b')]),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      const node = result.nodes.find((n) => n.id === 'b')
      expect(node).toBeDefined()
      expect(node?.node).toEqual(outputEntry.node)
      expect(node?.node.kind).toBe('output-v2')
    })

    it('FlowEdge[]がsource・targetのみに変換され、idが除去されること', () => {
      // Arrange
      const graph = queryPlanToFlow(
        v2([makeGetIds('a'), makeOutput('b')], [pe('a', 'b')]),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      expect(result.edges).toHaveLength(1)
      expect(result.edges[0]).toEqual({ source: 'a', target: 'b' })
      expect(result.edges[0]).not.toHaveProperty('id')
    })

    it('ノードのidがFlowNode.idからそのまま引き継がれること', () => {
      // Arrange
      const graph = queryPlanToFlow(
        v2(
          [makeGetIds('node-alpha'), makeOutput('node-beta')],
          [pe('node-alpha', 'node-beta')],
        ),
      )

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      const ids = result.nodes.map((n) => n.id)
      expect(ids).toContain('node-alpha')
      expect(ids).toContain('node-beta')
    })
  })

  describe('境界値', () => {
    it('ノード0件・エッジ0件の時、{ version: 2, nodes: [], edges: [] } が返ること', () => {
      // Arrange
      const graph: FlowGraphState = { edges: [], nodes: [] }

      // Act
      const result = flowToQueryPlanV2(graph)

      // Assert
      expect(result).toEqual({ edges: [], nodes: [], version: 2 })
    })
  })

  describe('異常系', () => {
    it('未知のnodeTypeを持つFlowNodeが含まれる時、エラーがスローされること', () => {
      // Arrange
      const graph = {
        edges: [],
        nodes: [
          {
            data: { config: {}, nodeType: 'unknown-type' },
            id: 'bad',
            position: { x: 0, y: 0 },
            type: 'unknown-type',
          },
        ],
      } as unknown as FlowGraphState

      // Act & Assert
      expect(() => flowToQueryPlanV2(graph)).toThrow()
    })
  })
})

// ============================================================
// ラウンドトリップ
// ============================================================

describe('ラウンドトリップ（queryPlanToFlow ↔ flowToQueryPlanV2）', () => {
  it('V2プラン → Flow → V2プランの変換で、元のノードIDがすべて保持されること', () => {
    // Arrange
    const original = v2(
      [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
      [pe('a', 'b'), pe('b', 'c')],
    )

    // Act
    const flow = queryPlanToFlow(original)
    const result = flowToQueryPlanV2(flow)

    // Assert
    const resultIds = result.nodes.map((n) => n.id).sort()
    const originalIds = original.nodes.map((n) => n.id).sort()
    expect(resultIds).toEqual(originalIds)
  })

  it('V2プラン → Flow → V2プランの変換で、元のエッジが保持されること', () => {
    // Arrange
    const original = v2(
      [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
      [pe('a', 'b'), pe('b', 'c')],
    )

    // Act
    const flow = queryPlanToFlow(original)
    const result = flowToQueryPlanV2(flow)

    // Assert
    const sortEdges = (edges: { source: string; target: string }[]) =>
      [...edges].sort((a, b) =>
        `${a.source}-${a.target}`.localeCompare(`${b.source}-${b.target}`),
      )
    expect(sortEdges(result.edges)).toEqual(sortEdges(original.edges))
  })

  it('V2プラン → Flow → V2プランの変換で、各ノードのconfigが同一であること', () => {
    // Arrange
    const original = v2(
      [makeGetIds('a'), makeLookup('b'), makeOutput('c')],
      [pe('a', 'b'), pe('b', 'c')],
    )

    // Act
    const flow = queryPlanToFlow(original)
    const result = flowToQueryPlanV2(flow)

    // Assert
    for (const origNode of original.nodes) {
      const resultNode = result.nodes.find((n) => n.id === origNode.id)
      expect(resultNode?.node).toEqual(origNode.node)
    }
  })

  it('分岐合流プランでラウンドトリップが成立すること', () => {
    // Arrange
    const original = v2(
      [makeGetIds('g1'), makeGetIds('g2'), makeMerge('m'), makeOutput('out')],
      [pe('g1', 'm'), pe('g2', 'm'), pe('m', 'out')],
    )

    // Act
    const flow = queryPlanToFlow(original)
    const result = flowToQueryPlanV2(flow)

    // Assert — ノード ID
    const resultIds = result.nodes.map((n) => n.id).sort()
    const originalIds = original.nodes.map((n) => n.id).sort()
    expect(resultIds).toEqual(originalIds)

    // Assert — エッジ
    const sortEdges = (edges: { source: string; target: string }[]) =>
      [...edges].sort((a, b) =>
        `${a.source}-${a.target}`.localeCompare(`${b.source}-${b.target}`),
      )
    expect(sortEdges(result.edges)).toEqual(sortEdges(original.edges))

    // Assert — ノード config
    for (const origNode of original.nodes) {
      const resultNode = result.nodes.find((n) => n.id === origNode.id)
      expect(resultNode?.node).toEqual(origNode.node)
    }

    // Assert — version
    expect(result.version).toBe(2)
  })
})
