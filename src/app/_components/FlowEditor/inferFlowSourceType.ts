// ============================================================
// FlowEditor — Output ノードのタイムライン種別を静的推定
// ============================================================

import { resolveOutputTable } from 'util/db/query-ir/completion'
import type { FlowEdge, FlowNode, FlowNodeData } from './types'

export type FlowSourceType = 'post' | 'notification' | 'mixed' | 'unknown'

/**
 * フローグラフを静的解析し、Output ノードが生成するタイムライン種別を推定する。
 *
 * Output ノードから上流をエッジ経由で辿り、各 get-ids / lookup-related ノードの
 * 出力テーブルを収集して判定する。
 */
export function inferFlowSourceType(
  outputNodeId: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
): FlowSourceType {
  // 上流エッジマップ: target → source[]
  const incoming = new Map<string, string[]>()
  for (const e of edges) {
    const list = incoming.get(e.target) ?? []
    list.push(e.source)
    incoming.set(e.target, list)
  }

  const nodeMap = new Map<string, FlowNodeData>()
  for (const n of nodes) {
    nodeMap.set(n.id, n.data)
  }

  // BFS で上流を辿り出力テーブルを収集
  const tables = new Set<string>()
  const visited = new Set<string>()
  const queue = [outputNodeId]

  while (queue.length > 0) {
    const current = queue.shift()
    if (current == null || visited.has(current)) continue
    visited.add(current)

    const data = nodeMap.get(current)
    if (data) {
      const table = resolveNodeOutputTable(data)
      if (table) tables.add(table)
    }

    for (const src of incoming.get(current) ?? []) {
      queue.push(src)
    }
  }

  return classifyTables(tables)
}

function resolveNodeOutputTable(data: FlowNodeData): string | null {
  switch (data.nodeType) {
    case 'get-ids':
      return resolveOutputTable(
        data.config.table,
        data.config.outputIdColumn ?? 'id',
      )
    case 'lookup-related':
      return data.config.lookupTable
    case 'merge-v2':
    case 'output-v2':
      return null
  }
}

function classifyTables(tables: Set<string>): FlowSourceType {
  if (tables.size === 0) return 'unknown'
  const hasPosts = tables.has('posts')
  const hasNotifications = tables.has('notifications')
  if (hasPosts && hasNotifications) return 'mixed'
  if (hasNotifications) return 'notification'
  if (hasPosts) return 'post'
  return 'unknown'
}
