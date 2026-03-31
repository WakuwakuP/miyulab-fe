// ============================================================
// FlowGraph → QueryPlan conversion
// ============================================================

import type {
  FilterNode,
  Pagination,
  QueryPlan,
  SortSpec,
  SourceNode,
} from 'util/db/query-ir/nodes'
import type {
  FilterNodeData,
  FlowEdge,
  FlowGraphState,
  FlowNode,
  MergeNodeData,
  OutputNodeData,
  SourceNodeData,
} from './types'

// --------------- Helpers ---------------

function findNodeById(nodes: FlowNode[], id: string): FlowNode | undefined {
  return nodes.find((n) => n.id === id)
}

function findIncomingEdges(edges: FlowEdge[], targetId: string): FlowEdge[] {
  return edges.filter((e) => e.target === targetId)
}

// --------------- Default values ---------------

const DEFAULT_SORT: SortSpec = {
  direction: 'DESC',
  field: 'created_at_ms',
  kind: 'sort',
}

const DEFAULT_PAGINATION: Pagination = {
  kind: 'pagination',
  limit: 50,
}

const DEFAULT_SOURCE: SourceNode = {
  kind: 'source',
  table: 'posts',
}

// --------------- Main conversion ---------------

/**
 * FlowGraphState → QueryPlan に変換する。
 *
 * グラフを output ノードから逆方向にトラバースし、
 * ソース・フィルタ・マージの構造を再構築する。
 */
export function flowToQueryPlan(graph: FlowGraphState): QueryPlan {
  const { nodes, edges } = graph

  // Find output node
  const outputNode = nodes.find(
    (n) => (n.data as { nodeType: string }).nodeType === 'output',
  )

  const sort = outputNode
    ? (outputNode.data as OutputNodeData).sort
    : DEFAULT_SORT
  const pagination = outputNode
    ? (outputNode.data as OutputNodeData).pagination
    : DEFAULT_PAGINATION

  if (!outputNode) {
    return {
      composites: [],
      filters: [],
      pagination,
      sort,
      source: DEFAULT_SOURCE,
    }
  }

  // Trace backwards from output
  const incoming = findIncomingEdges(edges, outputNode.id)

  if (incoming.length === 0) {
    return {
      composites: [],
      filters: [],
      pagination,
      sort,
      source: DEFAULT_SOURCE,
    }
  }

  // C-1: 単一入力の場合
  if (incoming.length === 1) {
    const prevNode = findNodeById(nodes, incoming[0].source)
    if (
      prevNode &&
      (prevNode.data as { nodeType: string }).nodeType === 'merge'
    ) {
      return buildMergePlan(prevNode, nodes, edges, sort, pagination)
    }

    // Single pipeline: trace back to source
    const pipeline = traceBackPipeline(incoming[0].source, nodes, edges)
    return {
      composites: [],
      filters: pipeline.filters,
      pagination,
      sort,
      source: pipeline.source,
    }
  }

  // C-1: 複数入力エッジ → 暗黙 Merge として処理
  const subPlans: QueryPlan[] = incoming.map((edge) => {
    const prevNode = findNodeById(nodes, edge.source)

    // 入力元が Merge ノードの場合はそのまま Merge を展開
    if (
      prevNode &&
      (prevNode.data as { nodeType: string }).nodeType === 'merge'
    ) {
      return buildMergePlan(prevNode, nodes, edges, sort, pagination)
    }

    const pipeline = traceBackPipeline(edge.source, nodes, edges)
    return {
      composites: [],
      filters: pipeline.filters,
      pagination: { ...pagination },
      sort: { ...sort },
      source: pipeline.source,
    }
  })

  return {
    composites: [
      {
        kind: 'merge',
        limit: pagination.limit,
        sources: subPlans,
        strategy: 'interleave-by-time' as const,
      },
    ],
    filters: [],
    pagination,
    sort,
    source: subPlans[0]?.source ?? DEFAULT_SOURCE,
  }
}

// --------------- Pipeline tracing ---------------

type PipelineResult = {
  source: SourceNode
  filters: FilterNode[]
}

function traceBackPipeline(
  startNodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): PipelineResult {
  const filters: FilterNode[] = []
  let currentId: string | null = startNodeId

  while (currentId) {
    const node = findNodeById(nodes, currentId)
    if (!node) break

    const data = node.data as { nodeType: string }

    if (data.nodeType === 'source') {
      const sourceData = node.data as SourceNodeData
      return {
        filters: filters.reverse(),
        source: sourceData.config,
      }
    }

    if (data.nodeType === 'filter') {
      const filterData = node.data as FilterNodeData
      filters.push(filterData.filter)
    }

    // C-2: merge ノードに到達した場合はトレースを停止
    if (data.nodeType === 'merge') {
      break
    }

    // Move to previous node
    const incoming = findIncomingEdges(edges, currentId)
    currentId = incoming.length > 0 ? incoming[0].source : null
  }

  return {
    filters: filters.reverse(),
    source: DEFAULT_SOURCE,
  }
}

// --------------- Merge plan building ---------------

function buildMergePlan(
  mergeNode: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
  sort: SortSpec,
  pagination: Pagination,
): QueryPlan {
  const mergeData = mergeNode.data as MergeNodeData
  const incoming = findIncomingEdges(edges, mergeNode.id)

  // C-3: 空 Merge ガード
  if (incoming.length === 0) {
    return {
      composites: [],
      filters: [],
      pagination,
      sort,
      source: DEFAULT_SOURCE,
    }
  }

  const subPlans: QueryPlan[] = incoming.map((edge) => {
    const pipeline = traceBackPipeline(edge.source, nodes, edges)
    return {
      composites: [],
      filters: pipeline.filters,
      pagination: { ...pagination },
      sort: { ...sort },
      source: pipeline.source,
    }
  })

  // C-3: ソースの整合性チェック — 全サブプランが同一テーブルなら採用、
  // 異なる場合は安全なデフォルトを使用
  const allSourceTables = new Set(subPlans.map((p) => p.source.table))
  const topSource: SourceNode =
    allSourceTables.size === 1
      ? subPlans[0].source
      : { kind: 'source', table: 'posts' }

  return {
    composites: [
      {
        kind: 'merge',
        limit: mergeData.limit,
        sources: subPlans,
        strategy: mergeData.strategy,
      },
    ],
    filters: [],
    pagination,
    sort,
    source: topSource,
  }
}
