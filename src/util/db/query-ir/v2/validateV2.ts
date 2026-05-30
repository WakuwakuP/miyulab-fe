// ============================================================
// QueryPlanV2 バリデーション
// ============================================================

import type { GetIdsNode, LookupRelatedNode, QueryPlanV2 } from '../nodes'
import { TABLE_REGISTRY } from '../registry'

export type ValidateV2Result = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function tableExists(name: string): boolean {
  return name in TABLE_REGISTRY
}

function validateOutputNodes(outCount: number, errors: string[]): void {
  if (outCount === 0) {
    errors.push('output ノードが1つ必要です')
  }
  if (outCount > 1) {
    errors.push('output ノードは1つのみにしてください')
  }
}

function validateGetIdsNode(
  id: string,
  node: GetIdsNode,
  errors: string[],
  warnings: string[],
): void {
  if (!tableExists(node.table)) {
    errors.push(`getIds: 不明なテーブル "${node.table}" (${id})`)
  }
  if (node.filters.length === 0 && !node.orBranches?.length) {
    warnings.push(`getIds (${id}): フィルタが空です`)
  }
}

function validateLookupRelatedNode(
  id: string,
  node: LookupRelatedNode,
  plan: QueryPlanV2,
  errors: string[],
): void {
  if (!tableExists(node.lookupTable)) {
    errors.push(`lookupRelated: 不明なテーブル "${node.lookupTable}" (${id})`)
  }
  const inc = plan.edges.filter((e) => e.target === id)
  if (inc.length === 0) {
    errors.push(`lookupRelated (${id}): 入力エッジがありません`)
  }
}

function validatePlanNodes(
  plan: QueryPlanV2,
  errors: string[],
  warnings: string[],
): void {
  for (const { id, node } of plan.nodes) {
    if (node.kind === 'get-ids') {
      validateGetIdsNode(id, node, errors, warnings)
    }
    if (node.kind === 'lookup-related') {
      validateLookupRelatedNode(id, node, plan, errors)
    }
  }
}

function graphHasCycle(plan: QueryPlanV2): boolean {
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
  return cycle
}

function collectIsolatedNodeWarnings(
  plan: QueryPlanV2,
  warnings: string[],
): void {
  const connected = new Set<string>()
  for (const e of plan.edges) {
    connected.add(e.source)
    connected.add(e.target)
  }
  if (plan.nodes.length <= 1) return
  for (const { id } of plan.nodes) {
    if (!connected.has(id)) {
      warnings.push(`孤立ノード: ${id}`)
    }
  }
}

export function validateQueryPlanV2(plan: QueryPlanV2): ValidateV2Result {
  const errors: string[] = []
  const warnings: string[] = []

  const outNodes = plan.nodes.filter((n) => n.node.kind === 'output-v2')
  validateOutputNodes(outNodes.length, errors)
  validatePlanNodes(plan, errors, warnings)

  if (graphHasCycle(plan)) {
    errors.push('グラフに循環があります')
  }
  collectIsolatedNodeWarnings(plan, warnings)

  return {
    errors,
    valid: errors.length === 0,
    warnings,
  }
}
