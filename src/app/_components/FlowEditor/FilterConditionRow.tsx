'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { Switch } from 'components/ui/switch'
import { Link, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  getFilterableColumns,
  getKnownValues,
} from 'util/db/query-ir/completion'
import type { FilterCondition, FilterOp } from 'util/db/query-ir/nodes'
import { searchColumnValuesDirect } from 'util/db/sqlite/stores/statusReadStore'
import { ValueInput } from '../NodeEditor/ValueInput'
import {
  ALL_OPS,
  type FlatColumnOption,
  flatColumnKey,
  NO_VALUE_OPS,
  UPSTREAM_OPS,
} from './flowNodePanelTypes'
import type { FlowNode } from './types'
import { getNodeLabelV2 } from './types'

type FilterConditionRowProps = {
  filter: FilterCondition
  flatColumns: FlatColumnOption[]
  upstreamNodes: FlowNode[]
  onUpdate: (f: FilterCondition) => void
  onDelete: () => void
}

export function FilterConditionRow({
  filter,
  flatColumns,
  upstreamNodes,
  onUpdate,
  onDelete,
}: FilterConditionRowProps) {
  const knownValues = useMemo(
    () => getKnownValues(filter.table, filter.column),
    [filter.table, filter.column],
  )
  const currentType =
    getFilterableColumns(filter.table).find((c) => c.name === filter.column)
      ?.type ?? 'text'

  const hasUpstream = upstreamNodes.length > 0
  const isInputMode = hasUpstream && filter.upstreamSourceNodeId != null
  const boundUpstreamNode = upstreamNodes.find(
    (n) => n.id === filter.upstreamSourceNodeId,
  )
  const showValueArea = !NO_VALUE_OPS.has(filter.op)

  function handleColumnKey(key: string) {
    const [tbl, ...rest] = key.split(':')
    const col = rest.join(':')
    onUpdate({
      column: col,
      op: '=',
      table: tbl,
      upstreamSourceNodeId: undefined,
      value: undefined,
    })
  }

  function handleOpChange(op: FilterOp) {
    onUpdate({
      ...filter,
      op,
      value: NO_VALUE_OPS.has(op) ? undefined : filter.value,
    })
  }

  function handleBindToggle(checked: boolean) {
    if (checked && upstreamNodes.length > 0) {
      const op = filter.op === 'IN' || filter.op === 'NOT IN' ? filter.op : 'IN'
      onUpdate({
        ...filter,
        op,
        upstreamSourceNodeId: upstreamNodes[0].id,
        value: undefined,
      })
    } else {
      onUpdate({
        ...filter,
        upstreamSourceNodeId: undefined,
      })
    }
  }

  function handleSourceNodeChange(nodeId: string) {
    onUpdate({ ...filter, upstreamSourceNodeId: nodeId })
  }

  const selectedKey = flatColumnKey({
    columnName: filter.column,
    tableName: filter.table,
  })

  return (
    <div className="rounded border border-gray-700 bg-gray-800 p-2 mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-blue-400">
          列フィルタ
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
        <span className="text-[10px] text-gray-400 block mb-0.5">カラム</span>
        <Select onValueChange={handleColumnKey} value={selectedKey}>
          <SelectTrigger className="w-full h-6 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {flatColumns.map((c) => {
              const k = flatColumnKey(c)
              return (
                <SelectItem key={k} textValue={c.columnLabel} value={k}>
                  <span className="block">{c.columnLabel}</span>
                  <span className="block text-[10px] text-gray-500 font-mono">
                    {c.columnName}
                  </span>
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        <p className="mt-0.5 text-[10px] text-gray-600 font-mono">
          {filter.column}
        </p>
      </div>

      <div className={showValueArea ? 'mb-1.5' : undefined}>
        <span className="text-[10px] text-gray-400 block mb-0.5">演算子</span>
        <Select
          onValueChange={(v) => handleOpChange(v as FilterOp)}
          value={filter.op}
        >
          <SelectTrigger className="w-full h-6 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {(isInputMode ? UPSTREAM_OPS : ALL_OPS).map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showValueArea && (
        <div>
          {hasUpstream && (
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1 text-[10px] text-gray-400">
                <Link className="h-2.5 w-2.5" />
                上流バインド
              </div>
              <Switch
                checked={isInputMode}
                className="h-4 w-7 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
                onCheckedChange={handleBindToggle}
              />
            </div>
          )}
          {isInputMode ? (
            <div className="rounded bg-sky-950/40 border border-sky-800/50 px-2 py-1.5 space-y-1.5">
              <p className="text-[10px] text-sky-400">
                上流ノードの出力IDをバインド
              </p>
              {upstreamNodes.length === 1 ? (
                <span className="block rounded bg-gray-700 border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-300">
                  {getNodeLabelV2(upstreamNodes[0].data)}
                </span>
              ) : (
                <Select
                  onValueChange={handleSourceNodeChange}
                  value={filter.upstreamSourceNodeId ?? ''}
                >
                  <SelectTrigger className="w-full h-6 text-xs bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="上流ノードを選択…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {upstreamNodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {getNodeLabelV2(n.data)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!boundUpstreamNode && upstreamNodes.length > 1 && (
                <p className="text-[10px] text-amber-400">
                  上流ノードを選択してください
                </p>
              )}
            </div>
          ) : (
            <ValueInput
              column={filter.column}
              columnType={currentType}
              knownValues={knownValues}
              onChange={(value) => onUpdate({ ...filter, value })}
              op={filter.op}
              searchValues={searchColumnValuesDirect}
              table={filter.table}
              value={filter.value ?? null}
            />
          )}
        </div>
      )}
    </div>
  )
}
