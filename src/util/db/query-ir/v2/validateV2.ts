// ============================================================
// QueryPlanV2 バリデーション
// ============================================================

import type { QueryPlanV2 } from '../nodes'
import { TABLE_REGISTRY } from '../registry'

export type ValidateV2Result = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function tableExists(name: string): boolean {
  return name in TABLE_REGISTRY
}

export function validateQueryPlanV2(plan: QueryPlanV2): ValidateV2Result {
  const errors: string[] = []
  const warnings: string[] = []

  const outNodes = plan.nodes.filter((n) => n.node.kind === 'output-v2')
  if (outNodes.length === 0) {
    errors.push('output ノードが1つ必要です')
  }
  if (outNodes.length > 1) {
    errors.push('output ノードは1つのみにしてください')
  }

  const _byId = new Map(plan.nodes.map((n) => [n.id, n]))

  for (const { id, node } of plan.nodes) {
    if (node.kind === 'get-ids') {
      if (!tableExists(node.table)) {
        errors.push(`getIds: 不明なテーブル "${node.table}" (${id})`)
      }
      if (node.filters.length === 0 && !node.orBranches?.length) {
        warnings.push(`getIds (${id}): フィルタが空です`)
      }
    }
    if (node.kind === 'lookup-related') {
      if (!tableExists(node.lookupTable)) {
        errors.push(
          `lookupRelated: 不明なテーブル "${node.lookupTable}" (${id})`,
        )
      }
      const inc = plan.edges.filter((e) => e.target === id)
      if (inc.length === 0) {
        errors.push(`lookupRelated (${id}): 入力エッジがありません`)
      }
    }
  }

  // 循環検出（簡易 DFS）
  const adj = new Map<string, string[]>()
  for (const e of plan.edges) {
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  let cycle = false
  function dfs(u: string): void {
    if (visited.has(u)) return
    if (visiting.has(u)) {
      cycle = true
      return
    }
    visiting.add(u)
    for (const v of adj.get(u) ?? []) {
      dfs(v)
    }
    visiting.delete(u)
    visited.add(u)
  }
  for (const { id } of plan.nodes) {
    if (!visited.has(id)) dfs(id)
  }
  if (cycle) {
    errors.push('グラフに循環があります')
  }

  // 孤立ノード
  const connected = new Set<string>()
  for (const e of plan.edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  for (const { id } of plan.nodes) {
    if (!connected.has(id) && plan.nodes.length > 1) {
      warnings.push(`孤立ノード: ${id}`)
    }
  }

  return {
    errors,
    valid: errors.length === 0,
    warnings,
  }
}
