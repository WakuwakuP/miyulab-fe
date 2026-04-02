// ============================================================
// Graph Executor — DAG トポロジカルソート
//
// Kahn のアルゴリズムで QueryPlanV2 のノードを実行順序に並べる。
// サイクル検出付き。Output ノードが最後に来ることを保証する。
// ============================================================

import type { SerializedGraphPlan } from './types'

/**
 * DAG をトポロジカルソートし、ノード ID の実行順序を返す。
 *
 * @throws サイクルが検出された場合
 * @throws Output ノードが存在しない場合
 */
export function topoSort(plan: SerializedGraphPlan): string[] {
  const nodeIds = new Set(plan.nodes.map((n) => n.id))
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }

  for (const edge of plan.edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  // Kahn's algorithm
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    sorted.push(current)

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) queue.push(neighbor)
    }
  }

  if (sorted.length !== nodeIds.size) {
    const remaining = [...nodeIds].filter((id) => !sorted.includes(id))
    throw new Error(`グラフにサイクルが検出されました: ${remaining.join(', ')}`)
  }

  // Output ノードが最後に来るように安定化
  // (Kahn's は入次数0のノードから処理するため、通常 output は最後になるが明示的に保証)
  const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]))
  const outputIndex = sorted.findIndex(
    (id) => nodeMap.get(id)?.node.kind === 'output-v2',
  )
  if (outputIndex === -1) {
    throw new Error('Output ノードが見つかりません')
  }
  if (outputIndex !== sorted.length - 1) {
    const [outputId] = sorted.splice(outputIndex, 1)
    sorted.push(outputId)
  }

  return sorted
}
