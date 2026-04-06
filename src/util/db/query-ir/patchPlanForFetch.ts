/**
 * QueryPlanV2 にカーソルと limit をパッチする純粋関数
 *
 * useTimelineDataSource から抽出。
 * ストリーミング差分取得やスクロールバックで使用される。
 *
 * パッチ対象:
 * - output-v2: カーソルと limit を設定（最終フィルタ＋ページング）
 * - get-ids: カーソル条件を WHERE に push down して、
 *   SQL レベルで対象範囲のみ取得する（LIMIT 拡張は不要）
 * - merge-v2: limit が不足していれば引き上げ
 */

import { getDefaultTimeColumn } from './completion'
import type { PaginationCursor, QueryPlanV2, QueryPlanV2Node } from './nodes'

export function patchPlanForFetch(
  plan: QueryPlanV2,
  limit: number,
  cursor?: PaginationCursor,
): QueryPlanV2 {
  // カーソル方向を SQL 演算子に変換
  const cursorOp = cursor?.direction === 'before' ? '<' : '>'

  return {
    ...plan,
    nodes: plan.nodes.map((entry): QueryPlanV2Node => {
      if (entry.node.kind === 'output-v2') {
        return {
          ...entry,
          node: {
            ...entry.node,
            pagination: { ...entry.node.pagination, cursor, limit },
          },
        }
      }
      if (entry.node.kind === 'merge-v2') {
        const mergeLimit = Math.max(entry.node.limit, limit)
        return {
          ...entry,
          node: { ...entry.node, limit: mergeLimit },
        }
      }
      // get-ids: カーソル条件を WHERE に push down
      if (entry.node.kind === 'get-ids' && cursor) {
        const node = entry.node
        // カーソルフィールドを実カラム名に変換
        const col =
          cursor.field === 'id'
            ? (node.outputIdColumn ?? 'id')
            : node.outputTimeColumn !== null
              ? (node.outputTimeColumn ??
                getDefaultTimeColumn(node.table) ??
                undefined)
              : undefined

        if (col) {
          return {
            ...entry,
            node: {
              ...node,
              cursor: {
                column: col,
                op: cursorOp as '<' | '>',
                value: cursor.value,
              },
            },
          }
        }
      }
      return entry
    }),
  }
}
