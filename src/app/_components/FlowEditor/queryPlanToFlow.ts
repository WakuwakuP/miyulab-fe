// ============================================================
// QueryPlan → FlowGraph conversion
// ============================================================

import type { QueryPlan } from 'util/db/query-ir/nodes'
import type {
  FilterNodeData,
  FlowEdge,
  FlowGraphState,
  FlowNode,
  MergeNodeData,
  OutputNodeData,
  SourceNodeData,
} from './types'
import { getFilterLabel } from './types'

// --------------- Layout constants ---------------

const NODE_X_GAP = 280
const NODE_Y_GAP = 120
const INITIAL_X = 50
const INITIAL_Y = 50

let nodeIdCounter = 0
function nextId(): string {
  return `flow-${++nodeIdCounter}`
}

/** カウンタリセット (テスト用) */
export function resetIdCounter(): void {
  nodeIdCounter = 0
}

// --------------- Main conversion ---------------

export function queryPlanToFlow(plan: QueryPlan): FlowGraphState {
  nodeIdCounter = 0
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  // Check for merge composite
  const mergeComposite = plan.composites.find((c) => c.kind === 'merge')

  if (mergeComposite && mergeComposite.kind === 'merge') {
    // Mixed query: multiple sources → merge → output
    const mergeInputIds: string[] = []

    mergeComposite.sources.forEach((subPlan, sourceIdx) => {
      const yOffset = INITIAL_Y + sourceIdx * NODE_Y_GAP * 3
      const lastNodeId = layoutSinglePipeline(
        subPlan,
        nodes,
        edges,
        INITIAL_X,
        yOffset,
      )
      mergeInputIds.push(lastNodeId)
    })

    // C-6: Merge ノードの X 座標を最長パイプラインに基づいて動的計算
    const maxPipelineLength = Math.max(
      ...mergeComposite.sources.map((subPlan) => 1 + subPlan.filters.length),
      1,
    )
    const mergeX = INITIAL_X + NODE_X_GAP * (maxPipelineLength + 1)

    // Merge node
    const mergeId = nextId()
    const mergeY =
      INITIAL_Y + ((mergeComposite.sources.length - 1) * NODE_Y_GAP * 3) / 2
    nodes.push({
      data: {
        limit: mergeComposite.limit,
        nodeType: 'merge',
        strategy: mergeComposite.strategy,
      } satisfies MergeNodeData,
      id: mergeId,
      position: { x: mergeX, y: mergeY },
      type: 'merge',
    })

    for (const inputId of mergeInputIds) {
      edges.push({
        id: `e-${inputId}-${mergeId}`,
        source: inputId,
        target: mergeId,
      })
    }

    // Output node
    const outputId = nextId()
    nodes.push({
      data: {
        nodeType: 'output',
        pagination: plan.pagination,
        sort: plan.sort,
      } satisfies OutputNodeData,
      id: outputId,
      position: { x: mergeX + NODE_X_GAP, y: mergeY },
      type: 'output',
    })

    edges.push({
      id: `e-${mergeId}-${outputId}`,
      source: mergeId,
      target: outputId,
    })
  } else {
    // Single source pipeline
    const lastNodeId = layoutSinglePipeline(
      plan,
      nodes,
      edges,
      INITIAL_X,
      INITIAL_Y,
    )

    // Output node
    const outputId = nextId()
    const outputX = INITIAL_X + NODE_X_GAP * (plan.filters.length + 1)
    nodes.push({
      data: {
        nodeType: 'output',
        pagination: plan.pagination,
        sort: plan.sort,
      } satisfies OutputNodeData,
      id: outputId,
      position: { x: outputX, y: INITIAL_Y },
      type: 'output',
    })

    edges.push({
      id: `e-${lastNodeId}-${outputId}`,
      source: lastNodeId,
      target: outputId,
    })
  }

  return { edges, nodes }
}

// --------------- Pipeline layout ---------------

function layoutSinglePipeline(
  plan: QueryPlan,
  nodes: FlowNode[],
  edges: FlowEdge[],
  startX: number,
  startY: number,
): string {
  let currentX = startX

  // Source node
  const sourceId = nextId()
  nodes.push({
    data: {
      config: plan.source,
      nodeType: 'source',
    } satisfies SourceNodeData,
    id: sourceId,
    position: { x: currentX, y: startY },
    type: 'source',
  })

  let lastId = sourceId
  currentX += NODE_X_GAP

  // Filter nodes
  for (const filter of plan.filters) {
    const filterId = nextId()
    nodes.push({
      data: {
        filter,
        label: getFilterLabel(filter),
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id: filterId,
      position: { x: currentX, y: startY },
      type: 'filter',
    })

    edges.push({
      id: `e-${lastId}-${filterId}`,
      source: lastId,
      target: filterId,
    })

    lastId = filterId
    currentX += NODE_X_GAP
  }

  return lastId
}
