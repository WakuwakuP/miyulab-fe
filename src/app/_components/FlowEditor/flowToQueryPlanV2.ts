// ============================================================
// FlowGraphState → QueryPlanV2
// ============================================================

import type { QueryPlanV2, QueryPlanV2Node } from 'util/db/query-ir/nodes'
import type { FlowGraphState } from './types'

export function flowToQueryPlanV2(graph: FlowGraphState): QueryPlanV2 {
  const nodes: QueryPlanV2Node[] = graph.nodes.map((fn) => {
    const d = fn.data as { nodeType: string; config: QueryPlanV2Node['node'] }
    switch (d.nodeType) {
      case 'get-ids':
        return { id: fn.id, node: d.config }
      case 'lookup-related':
        return { id: fn.id, node: d.config }
      case 'merge-v2':
        return { id: fn.id, node: d.config }
      case 'output-v2':
        return { id: fn.id, node: d.config }
      default:
        throw new Error(`V2 フローエディタで未対応のノード: ${d.nodeType}`)
    }
  })

  const edges = graph.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }))

  return {
    edges,
    nodes,
    version: 2,
  }
}
