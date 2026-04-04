'use client'

import { Badge } from 'components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { useCallback, useMemo } from 'react'
import {
  getAllFilterableTables,
  getFilterableColumns,
  getKnownValues,
} from 'util/db/query-ir/completion'
import type { FilterOp, TableFilter } from 'util/db/query-ir/nodes'
import { searchColumnValuesDirect } from 'util/db/sqlite/stores/statusReadStore'
import { ValueInput } from './ValueInput'

const FILTER_OPS: { label: string; value: FilterOp }[] = [
  { label: '=', value: '=' },
  { label: '≠', value: '!=' },
  { label: '>', value: '>' },
  { label: '≥', value: '>=' },
  { label: '<', value: '<' },
  { label: '≤', value: '<=' },
  { label: 'IN', value: 'IN' },
  { label: 'NOT IN', value: 'NOT IN' },
  { label: 'IS NULL', value: 'IS NULL' },
  { label: 'IS NOT NULL', value: 'IS NOT NULL' },
  { label: 'LIKE', value: 'LIKE' },
  { label: 'GLOB', value: 'GLOB' },
]

export function TableFilterBody({
  node,
  onUpdate,
}: {
  node: TableFilter
  onUpdate: (n: TableFilter) => void
}) {
  const isNullOp = node.op === 'IS NULL' || node.op === 'IS NOT NULL'

  // テーブル一覧
  const tableOptions = useMemo(() => getAllFilterableTables(), [])
  // カラム一覧
  const columnOptions = useMemo(
    () => getFilterableColumns(node.table),
    [node.table],
  )
  // 既知値候補
  const knownValues = useMemo(
    () => getKnownValues(node.table, node.column),
    [node.table, node.column],
  )
  // カラムメタデータ
  const columnMeta = useMemo(
    () => columnOptions.find((c) => c.name === node.column),
    [columnOptions, node.column],
  )

  const handleTableChange = useCallback(
    (table: string) => {
      const cols = getFilterableColumns(table)
      const firstCol = cols[0]?.name ?? ''
      onUpdate({ ...node, column: firstCol, table, value: '' })
    },
    [node, onUpdate],
  )

  const handleColumnChange = useCallback(
    (column: string) => {
      onUpdate({ ...node, column, value: '' })
    },
    [node, onUpdate],
  )

  return (
    <div className="space-y-2">
      {/* テーブル・カラム選択行 */}
      <div className="flex items-center gap-2">
        <Select onValueChange={handleTableChange} value={node.table}>
          <SelectTrigger className="h-7 w-36 text-xs bg-gray-800 border-gray-600">
            <SelectValue placeholder="テーブル" />
          </SelectTrigger>
          <SelectContent>
            {tableOptions.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {columnOptions.length > 0 ? (
          <Select onValueChange={handleColumnChange} value={node.column}>
            <SelectTrigger className="h-7 w-36 text-xs bg-gray-800 border-gray-600">
              <SelectValue placeholder="カラム" />
            </SelectTrigger>
            <SelectContent>
              {columnOptions.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge className="text-xs shrink-0" variant="outline">
            {node.column}
          </Badge>
        )}
      </div>

      {/* 演算子 + 値入力行 */}
      <div className="flex items-center gap-2">
        <Select
          onValueChange={(v) => onUpdate({ ...node, op: v as FilterOp })}
          value={node.op}
        >
          <SelectTrigger className="h-7 w-28 text-xs bg-gray-800 border-gray-600 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isNullOp && (
          <ValueInput
            column={node.column}
            columnType={columnMeta?.type ?? 'text'}
            knownValues={knownValues}
            onChange={(value) => onUpdate({ ...node, value })}
            op={node.op}
            searchValues={searchColumnValuesDirect}
            table={node.table}
            value={node.value ?? ''}
          />
        )}
      </div>
    </div>
  )
}
