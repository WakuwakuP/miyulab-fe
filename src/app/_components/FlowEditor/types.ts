// ============================================================
// FlowEditor — Visual query editor types (QueryPlanV2)
// ============================================================

import type { Edge, Node } from '@xyflow/react'
import type {
  GetIdsNode,
  LookupRelatedNode,
  MergeNodeV2,
  OutputNodeV2,
} from 'util/db/query-ir/nodes'

export type GetIdsFlowNodeData = {
  nodeType: 'get-ids'
  config: GetIdsNode
}

export type LookupRelatedFlowNodeData = {
  nodeType: 'lookup-related'
  config: LookupRelatedNode
}

export type MergeFlowNodeDataV2 = {
  nodeType: 'merge-v2'
  config: MergeNodeV2
}

export type OutputFlowNodeDataV2 = {
  nodeType: 'output-v2'
  config: OutputNodeV2
}

export type FlowNodeData =
  | GetIdsFlowNodeData
  | LookupRelatedFlowNodeData
  | MergeFlowNodeDataV2
  | OutputFlowNodeDataV2

export type FlowNode = Node<FlowNodeData>

export type FlowEdge = Edge

export type FlowGraphState = {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

// --------------- 実行状態 ---------------

/** ノード実行状態 */
export type NodeExecState = 'idle' | 'running' | 'done' | 'error'

/** テスト実行の全体状態 */
export type FlowExecStatus = {
  /** 各ノードの実行状態 */
  nodeStates: Record<string, NodeExecState>
  /** 各ノードの実行統計 (実行完了後) */
  nodeStats: Record<
    string,
    { cacheHit: boolean; durationMs: number; rowCount: number }
  >
  /** 全体の実行時間 (実行完了後) */
  totalDurationMs: number | null
  /** 実行中かどうか */
  running: boolean
  /** エラーメッセージ */
  error: string | null
  /** デバッグ結果 — ノード別 (実行完了後) */
  debugResultsByNode?: DebugNodeResult[]
}

// --------------- デバッグ結果 ---------------

/** ノード単位のデバッグ結果 */
export type DebugNodeResult = {
  nodeId: string
  nodeLabel: string
  items: DebugResultItem[]
}

/** テスト実行結果の1行（投稿 or 通知） */
export type DebugResultItem =
  | {
      table: 'posts'
      id: number
      acct: string
      contentPreview: string
      createdAt: string
      isReblog: boolean
    }
  | {
      table: 'notifications'
      id: number
      notificationType: string
      actorAcct: string
      relatedContentPreview: string
      createdAt: string
    }

export const FLOW_NODE_TYPES_V2 = {
  'get-ids': 'get-ids',
  'lookup-related': 'lookup-related',
  'merge-v2': 'merge-v2',
  'output-v2': 'output-v2',
} as const

export function getNodeLabelV2(
  data:
    | GetIdsFlowNodeData
    | LookupRelatedFlowNodeData
    | MergeFlowNodeDataV2
    | OutputFlowNodeDataV2,
): string {
  switch (data.nodeType) {
    case 'get-ids':
      return `getIds: ${data.config.table} (${data.config.filters.length}条件)`
    case 'lookup-related':
      return `lookup: ${data.config.lookupTable}`
    case 'merge-v2':
      return `merge: ${data.config.strategy}`
    case 'output-v2':
      return `output: ${data.config.sort.direction} LIMIT ${data.config.pagination.limit}`
    default:
      return 'node'
  }
}
