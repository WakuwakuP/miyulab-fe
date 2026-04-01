// ============================================================
// QueryPlan(V1) / QueryPlanV2 → FlowGraph（表示は常に V2 ノード）
// ============================================================

import type {
  QueryPlan,
  QueryPlanV2,
  QueryPlanV2Node,
} from 'util/db/query-ir/nodes'
import { isQueryPlanV2 } from 'util/db/query-ir/nodes'
import { migrateQueryPlanV1ToV2 } from 'util/db/query-ir/v2/migrateV1ToV2'
import type {
  FlowEdge,
  FlowGraphState,
  FlowNode,
  GetIdsFlowNodeData,
  LookupRelatedFlowNodeData,
  MergeFlowNodeDataV2,
  OutputFlowNodeDataV2,
} from './types'

const NODE_X_GAP = 280
const NODE_Y_GAP = 120
const INITIAL_X = 50
const INITIAL_Y = 50

function queryPlanV2ToFlow(plan: QueryPlanV2): FlowGraphState {
  const incoming = new Map<string, string[]>()
  for (const e of plan.edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source])
  }

  const outEntry = plan.nodes.find((n) => n.node.kind === 'output-v2')
  if (!outEntry) {
    return { edges: [], nodes: [] }
  }

  const depth = new Map<string, number>()
  function assignDepth(id: string, d: number): void {
    const cur = depth.get(id)
    if (cur != null && cur >= d) return
    depth.set(id, d)
    for (const p of incoming.get(id) ?? []) {
      assignDepth(p, d + 1)
    }
  }
  assignDepth(outEntry.id, 0)

  const maxDepth = Math.max(0, ...depth.values())

  const byDepth = new Map<number, string[]>()
  for (const [id, d] of depth) {
    const list = byDepth.get(d) ?? []
    list.push(id)
    byDepth.set(d, list)
  }

  const flowNodeFromEntry = (
    entry: QueryPlanV2Node,
    pos: { x: number; y: number },
  ): FlowNode => {
    const node = entry.node
    switch (node.kind) {
      case 'get-ids':
        return {
          data: {
            config: node,
            nodeType: 'get-ids',
          } satisfies GetIdsFlowNodeData,
          id: entry.id,
          position: pos,
          type: 'get-ids',
        }
      case 'lookup-related':
        return {
          data: {
            config: node,
            nodeType: 'lookup-related',
          } satisfies LookupRelatedFlowNodeData,
          id: entry.id,
          position: pos,
          type: 'lookup-related',
        }
      case 'merge-v2':
        return {
          data: {
            config: node,
            nodeType: 'merge-v2',
          } satisfies MergeFlowNodeDataV2,
          id: entry.id,
          position: pos,
          type: 'merge-v2',
        }
      case 'output-v2':
        return {
          data: {
            config: node,
            nodeType: 'output-v2',
          } satisfies OutputFlowNodeDataV2,
          id: entry.id,
          position: pos,
          type: 'output-v2',
        }
    }
  }

  const nodes: FlowNode[] = []
  for (const [d, ids] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort()
    ids.forEach((id, idx) => {
      const entry = plan.nodes.find((n) => n.id === id)
      if (!entry) return
      const x = INITIAL_X + (maxDepth - d) * NODE_X_GAP
      const y = INITIAL_Y + idx * NODE_Y_GAP
      nodes.push(flowNodeFromEntry(entry, { x, y }))
    })
  }

  const edges: FlowEdge[] = plan.edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
  }))

  return { edges, nodes }
}

/** V1 はマイグレートしてから V2 キャンバスとして描画する */
export function queryPlanToFlow(plan: QueryPlan | QueryPlanV2): FlowGraphState {
  const v2 = isQueryPlanV2(plan) ? plan : migrateQueryPlanV1ToV2(plan)
  return queryPlanV2ToFlow(v2)
}
