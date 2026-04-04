'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { Trash2 } from 'lucide-react'
import type { TableOption } from 'util/db/query-ir/completion'
import type { ExistsCondition } from 'util/db/query-ir/nodes'
import { EXISTS_MODES } from './flowNodePanelTypes'

type ExistsConditionRowProps = {
  filter: ExistsCondition
  existsTables: TableOption[]
  onUpdate: (f: ExistsCondition) => void
  onDelete: () => void
}

export function ExistsConditionRow({
  filter,
  existsTables,
  onUpdate,
  onDelete,
}: ExistsConditionRowProps) {
  const showCount =
    filter.mode === 'count-gte' ||
    filter.mode === 'count-lte' ||
    filter.mode === 'count-eq'

  return (
    <div className="rounded border border-gray-700 bg-gray-800 p-2 mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-purple-400">
          EXISTS
        </span>
        <button
          className="p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-colors"
          onClick={onDelete}
          type="button"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="mb-1.5">
        <span className="text-[10px] text-gray-400 block mb-0.5">テーブル</span>
        <Select
          onValueChange={(table) => onUpdate({ ...filter, table })}
          value={filter.table}
        >
          <SelectTrigger className="w-full h-6 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {existsTables.map((t) => (
              <SelectItem key={t.table} textValue={t.label} value={t.table}>
                <span className="block">{t.label}</span>
                <span className="block text-[10px] text-gray-500 font-mono">
                  {t.table}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-0.5 text-[10px] text-gray-600 font-mono">
          {filter.table}
        </p>
      </div>

      <div className={showCount ? 'mb-1.5' : undefined}>
        <span className="text-[10px] text-gray-400 block mb-0.5">モード</span>
        <Select
          onValueChange={(mode) =>
            onUpdate({
              ...filter,
              countValue: undefined,
              mode: mode as ExistsCondition['mode'],
            })
          }
          value={filter.mode}
        >
          <SelectTrigger className="w-full h-6 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {EXISTS_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showCount && (
        <div>
          <span className="text-[10px] text-gray-400 block mb-0.5">件数</span>
          <input
            className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-0.5 text-xs text-white"
            min={0}
            onChange={(e) =>
              onUpdate({ ...filter, countValue: Number(e.target.value) })
            }
            type="number"
            value={filter.countValue ?? 1}
          />
        </div>
      )}
    </div>
  )
}
