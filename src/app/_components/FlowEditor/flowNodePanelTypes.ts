import type { TableOption } from 'util/db/query-ir/completion'
import { getFilterableColumns } from 'util/db/query-ir/completion'
import type { FilterOp, GetIdsFilter } from 'util/db/query-ir/nodes'
import type { FlowEdge, FlowNode } from './types'

// --------------- Shared Props ---------------

export type FlowNodePanelProps = {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: (id: string, data: FlowNode['data']) => void
  onDelete: () => void
  onClose: () => void
}

// --------------- Flat column option for FilterConditionRow ---------------

export type FlatColumnOption = {
  columnLabel: string
  columnName: string
  tableLabel: string
  tableName: string
}

/** filterableTables から全カラムをフラット展開する */
export function buildFlatColumns(
  filterableTables: TableOption[],
): FlatColumnOption[] {
  const result: FlatColumnOption[] = []
  for (const t of filterableTables) {
    for (const col of getFilterableColumns(t.table)) {
      result.push({
        columnLabel: col.label,
        columnName: col.name,
        tableLabel: t.label,
        tableName: t.table,
      })
    }
  }
  return result
}

export function flatColumnKey(
  opt: Pick<FlatColumnOption, 'tableName' | 'columnName'>,
) {
  return `${opt.tableName}:${opt.columnName}`
}

// --------------- Constants ---------------

export const ALL_OPS: FilterOp[] = [
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
  'LIKE',
  'NOT LIKE',
  'GLOB',
]

export const NO_VALUE_OPS = new Set<FilterOp>(['IS NULL', 'IS NOT NULL'])

/** 上流バインド時に選択可能な演算子 */
export const UPSTREAM_OPS: FilterOp[] = ['IN', 'NOT IN']

export const EXISTS_MODES = [
  { label: '存在する', value: 'exists' },
  { label: '存在しない', value: 'not-exists' },
  { label: '件数 >= N', value: 'count-gte' },
  { label: '件数 <= N', value: 'count-lte' },
  { label: '件数 = N', value: 'count-eq' },
] as const

// --------------- Type guard ---------------

export function isFilterCondition(
  f: GetIdsFilter,
): f is import('util/db/query-ir/nodes').FilterCondition {
  return 'op' in f
}
