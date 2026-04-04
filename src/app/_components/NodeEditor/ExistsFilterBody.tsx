'use client'

import { Input } from 'components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { useMemo } from 'react'
import { getExistsFilterTables } from 'util/db/query-ir/completion'
import type { ExistsFilter } from 'util/db/query-ir/nodes'

const EXISTS_MODES = [
  { label: '存在する', value: 'exists' },
  { label: '存在しない', value: 'not-exists' },
  { label: '件数 ≥', value: 'count-gte' },
  { label: '件数 ≤', value: 'count-lte' },
  { label: '件数 =', value: 'count-eq' },
] as const

export function ExistsFilterBody({
  node,
  onUpdate,
}: {
  node: ExistsFilter
  onUpdate: (n: ExistsFilter) => void
}) {
  const isCountMode = node.mode.startsWith('count-')
  const existsTableOptions = useMemo(() => getExistsFilterTables(), [])

  return (
    <div className="space-y-2">
      {/* テーブル選択 */}
      <Select
        onValueChange={(v) => onUpdate({ ...node, table: v })}
        value={node.table}
      >
        <SelectTrigger className="h-7 w-44 text-xs bg-gray-800 border-gray-600">
          <SelectValue placeholder="テーブル" />
        </SelectTrigger>
        <SelectContent>
          {existsTableOptions.map((t) => (
            <SelectItem key={t.table} value={t.table}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* モード + 件数 */}
      <div className="flex items-center gap-2">
        <Select
          onValueChange={(v) =>
            onUpdate({
              ...node,
              mode: v as ExistsFilter['mode'],
            })
          }
          value={node.mode}
        >
          <SelectTrigger className="h-7 w-32 text-xs bg-gray-800 border-gray-600">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXISTS_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isCountMode && (
          <Input
            className="h-7 w-16 text-xs bg-gray-800 border-gray-600"
            min={0}
            onChange={(e) =>
              onUpdate({
                ...node,
                countValue: Number.parseInt(e.target.value, 10) || 0,
              })
            }
            type="number"
            value={node.countValue ?? 0}
          />
        )}
      </div>
    </div>
  )
}
