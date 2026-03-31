// ============================================================
// FlowEditor — Visual query editor types
// ============================================================

import type { Edge, Node } from '@xyflow/react'
import type {
  FilterNode,
  Pagination,
  SortSpec,
  SourceNode,
} from 'util/db/query-ir/nodes'

// --------------- Visual Node Data Types ---------------

/** ソースノードのデータ */
export type SourceNodeData = {
  nodeType: 'source'
  config: SourceNode
}

/** フィルタノードのデータ (任意の FilterNode を保持) */
export type FilterNodeData = {
  nodeType: 'filter'
  filter: FilterNode
  /** UI表示用ラベル */
  label: string
}

/** OR分岐ノードのデータ */
export type OrBranchNodeData = {
  nodeType: 'or-branch'
  /** ブランチ数 (入力ハンドル数を決定) */
  branchCount: number
}

/** マージノードのデータ (異なるソーステーブルの合成) */
export type MergeNodeData = {
  nodeType: 'merge'
  strategy: 'interleave-by-time'
  limit: number
}

/** 出力ノードのデータ */
export type OutputNodeData = {
  nodeType: 'output'
  sort: SortSpec
  pagination: Pagination
}

/** 全ビジュアルノードデータの Union */
export type FlowNodeData =
  | SourceNodeData
  | FilterNodeData
  | OrBranchNodeData
  | MergeNodeData
  | OutputNodeData

/** React Flow ノードの型 */
export type FlowNode = Node<FlowNodeData>

/** React Flow エッジの型 */
export type FlowEdge = Edge

// --------------- Flow Graph ↔ QueryPlan ---------------

/** フローグラフの状態 */
export type FlowGraphState = {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

// --------------- Node type identifiers for React Flow ---------------

export const FLOW_NODE_TYPES = {
  filter: 'filter',
  merge: 'merge',
  orBranch: 'or-branch',
  output: 'output',
  source: 'source',
} as const

// --------------- Filter label generation ---------------

/** FilterNode から UI 表示用ラベルを生成 */
export function getFilterLabel(filter: FilterNode): string {
  switch (filter.kind) {
    case 'timeline-scope':
      return `TL: ${filter.timelineKeys.join(', ')}`
    case 'backend-filter':
      return `アカウント: ${filter.localAccountIds.length > 0 ? filter.localAccountIds.join(', ') : '未選択'}`
    case 'exists-filter':
      return `${filter.mode === 'not-exists' ? '非' : ''}存在: ${filter.table}`
    case 'table-filter':
      return `${filter.table}.${filter.column} ${filter.op}${filter.value !== undefined ? ` ${String(filter.value)}` : ''}`
    case 'moderation-filter':
      return `モデレーション: ${filter.apply.join(', ')}`
    case 'raw-sql-filter':
      return `SQL: ${filter.where.slice(0, 30)}${filter.where.length > 30 ? '...' : ''}`
    case 'aerial-reply-filter':
      return `空中リプ (${filter.timeWindowMs / 1000}秒)`
    case 'or-group':
      return `OR分岐 (${filter.branches.length}条件)`
    default:
      return 'フィルタ'
  }
}
