// ============================================================
// Graph Executor — Merge ノードエグゼキュータ
//
// 複数の [{table, id, createdAtMs}] ストリームをインメモリで結合する。
// SQL は不要。strategy に応じて union / intersect / interleave-by-time を実行する。
// 重複排除は (table, id) の複合キーで行う。
// ============================================================

import type { MergeNodeV2 } from '../nodes'
import type { NodeOutputRow } from '../plan'
import type { NodeOutput } from './types'

/** (table, id) 複合キーを生成する */
function rowKey(row: NodeOutputRow): string {
  return `${row.table}\0${row.id}`
}

/** rows から sourceTable を導出する (全行同一 → そのテーブル, 混在 → 'mixed') */
function deriveSourceTable(rows: NodeOutputRow[], fallback: string): string {
  if (rows.length === 0) return fallback
  const tables = new Set(rows.map((r) => r.table))
  if (tables.size === 1) return rows[0].table
  return 'mixed'
}

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

  const sourceTable = deriveSourceTable(rows, inputs[0].sourceTable)

  const inputHashes = inputs.map((i) => i.hash).join('+')
  const hash = `merge:${node.strategy}:${inputHashes}:${rows.length}`

  return { hash, rows, sourceTable }
}

// --------------- Strategy 実装 ---------------

/** Union: 全入力の和集合（(table, id) 重複排除、createdAtMs DESC でソート） */
function mergeUnion(inputs: NodeOutput[]): NodeOutputRow[] {
  const seen = new Map<string, NodeOutputRow>()
  for (const input of inputs) {
    for (const row of input.rows) {
      const key = rowKey(row)
      if (!seen.has(key)) {
        seen.set(key, row)
      }
    }
  }
  const result = [...seen.values()]
  result.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return result
}

/** Intersect: 全入力の共通集合（全入力に存在する (table, id) のみ） */
function mergeIntersect(inputs: NodeOutput[]): NodeOutputRow[] {
  if (inputs.length === 0) return []
  if (inputs.length === 1) return [...inputs[0].rows]

  // 最初の入力のキーセットから開始
  let commonKeys = new Set(inputs[0].rows.map(rowKey))

  // 残りの入力と交差
  for (let i = 1; i < inputs.length; i++) {
    const currentKeys = new Set(inputs[i].rows.map(rowKey))
    commonKeys = new Set([...commonKeys].filter((k) => currentKeys.has(k)))
  }

  // 最初の入力から共通キーの行を取得
  const result = inputs[0].rows.filter((r) => commonKeys.has(rowKey(r)))
  result.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return result
}

/** Interleave-by-time: createdAtMs 降順で全入力をインターリーブ */
function mergeInterleaveByTime(inputs: NodeOutput[]): NodeOutputRow[] {
  const allRows: NodeOutputRow[] = []
  const seen = new Set<string>()

  for (const input of inputs) {
    for (const row of input.rows) {
      const key = rowKey(row)
      if (!seen.has(key)) {
        seen.add(key)
        allRows.push(row)
      }
    }
  }

  allRows.sort((a, b) => b.createdAtMs - a.createdAtMs)
  return allRows
}
