// ============================================================
// Graph Executor — Merge ノードエグゼキュータ
//
// 複数の [{id, createdAtMs}] ストリームをインメモリで結合する。
// SQL は不要。strategy に応じて union / intersect / interleave-by-time を実行する。
// ============================================================

import type { MergeNodeV2 } from '../nodes'
import type { NodeOutputRow } from '../plan'
import type { NodeOutput } from './types'

/**
 * Merge ノードを実行し、NodeOutput を返す。
 *
 * @param node - Merge ノード定義
 * @param inputs - 上流ノードの出力リスト（接続順）
 */
export function executeMerge(
  node: MergeNodeV2,
  inputs: NodeOutput[],
): NodeOutput {
  if (inputs.length === 0) {
    return { hash: 'merge:empty', rows: [], sourceTable: 'posts' }
  }

  // sourceTable を推定: 全入力が同じなら共通、異なれば 'mixed' 扱いで posts を使用
  const sourceTables = new Set(inputs.map((i) => i.sourceTable))
  const sourceTable = sourceTables.size === 1 ? inputs[0].sourceTable : 'posts'

  let rows: NodeOutputRow[]

  switch (node.strategy) {
    case 'union':
      rows = mergeUnion(inputs)
      break
    case 'intersect':
      rows = mergeIntersect(inputs)
      break
    case 'interleave-by-time':
      rows = mergeInterleaveByTime(inputs)
      break
    default:
      rows = mergeUnion(inputs)
  }

  // limit 適用
  if (node.limit > 0 && rows.length > node.limit) {
    rows = rows.slice(0, node.limit)
  }

  const inputHashes = inputs.map((i) => i.hash).join('+')
  const hash = `merge:${node.strategy}:${inputHashes}:${rows.length}`

  return { hash, rows, sourceTable }
}

// --------------- Strategy 実装 ---------------

/** Union: 全入力の和集合（ID 重複排除、createdAtMs DESC でソート） */
function mergeUnion(inputs: NodeOutput[]): NodeOutputRow[] {
  const seen = new Map<number, NodeOutputRow>()
  for (const input of inputs) {
    for (const row of input.rows) {
      if (!seen.has(row.id)) {
        seen.set(row.id, row)
      }
    }
  }
  const result = [...seen.values()]
  result.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return result
}

/** Intersect: 全入力の共通集合（全入力に存在する ID のみ） */
function mergeIntersect(inputs: NodeOutput[]): NodeOutputRow[] {
  if (inputs.length === 0) return []
  if (inputs.length === 1) return [...inputs[0].rows]

  // 最初の入力の ID セットから開始
  let commonIds = new Set(inputs[0].rows.map((r) => r.id))

  // 残りの入力と交差
  for (let i = 1; i < inputs.length; i++) {
    const currentIds = new Set(inputs[i].rows.map((r) => r.id))
    commonIds = new Set([...commonIds].filter((id) => currentIds.has(id)))
  }

  // 最初の入力から共通 ID の行を取得
  const result = inputs[0].rows.filter((r) => commonIds.has(r.id))
  result.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return result
}

/** Interleave-by-time: createdAtMs 降順で全入力をインターリーブ */
function mergeInterleaveByTime(inputs: NodeOutput[]): NodeOutputRow[] {
  const allRows: NodeOutputRow[] = []
  const seen = new Set<number>()

  for (const input of inputs) {
    for (const row of input.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id)
        allRows.push(row)
      }
    }
  }

  allRows.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return allRows
}
