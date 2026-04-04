'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import {
  getAllFilterableTables,
  getDefaultTimeColumn,
  getExistsFilterTables,
  getFilterableColumns,
  getFilterableTables,
  getOutputIdColumns,
  getTimeColumns,
} from 'util/db/query-ir/completion'
import { migrateInputBindings } from 'util/db/query-ir/migrateInputBindings'
import type {
  ExistsCondition,
  FilterCondition,
  GetIdsFilter,
} from 'util/db/query-ir/nodes'
import { ExistsConditionRow } from './ExistsConditionRow'
import { FilterConditionRow } from './FilterConditionRow'
import type { FlowNodePanelProps } from './flowNodePanelTypes'
import { buildFlatColumns, isFilterCondition } from './flowNodePanelTypes'
import type { FlowEdge, FlowNode, GetIdsFlowNodeData } from './types'

type GetIdsPanelProps = {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: FlowNodePanelProps['onUpdate']
}

export function GetIdsPanel({
  edges,
  node,
  nodes,
  onUpdate,
}: GetIdsPanelProps) {
  const data = node.data as GetIdsFlowNodeData
  const tables = useMemo(() => getAllFilterableTables(), [])

  const sourceTable = data.config.table as 'posts' | 'notifications'
  const isKnownSource =
    sourceTable === 'posts' || sourceTable === 'notifications'

  const filterableTables = useMemo(
    () => (isKnownSource ? getFilterableTables(sourceTable) : tables),
    [isKnownSource, sourceTable, tables],
  )

  const existsTables = useMemo(
    () => (isKnownSource ? getExistsFilterTables(sourceTable) : tables),
    [isKnownSource, sourceTable, tables],
  )

  const flatColumns = useMemo(
    () =>
      buildFlatColumns(
        filterableTables.filter((t) => t.table === data.config.table),
      ),
    [filterableTables, data.config.table],
  )

  const outputIdColumns = useMemo(
    () => getOutputIdColumns(data.config.table),
    [data.config.table],
  )

  const outputTimeColumns = useMemo(
    () => getTimeColumns(data.config.table),
    [data.config.table],
  )

  // 上流接続ノード
  const upstreamNodes = useMemo(
    () =>
      edges
        .filter((e) => e.target === node.id)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is FlowNode => n != null),
    [edges, nodes, node.id],
  )

  // 旧 inputBindings → FilterCondition.upstreamSourceNodeId マイグレーション
  const migratedRef = useRef(false)
  useEffect(() => {
    if (migratedRef.current) return
    const bindings = data.config.inputBindings
    if (!bindings || bindings.length === 0) return
    migratedRef.current = true

    const migrated = migrateInputBindings(data.config)
    onUpdate(node.id, { ...data, config: migrated })
  }, [data, node.id, onUpdate])

  function updateConfig(patch: Partial<typeof data.config>) {
    onUpdate(node.id, { ...data, config: { ...data.config, ...patch } })
  }

  function updateFilters(filters: GetIdsFilter[]) {
    updateConfig({ filters })
  }

  function updateFilter(idx: number, filter: GetIdsFilter) {
    const next = [...data.config.filters]
    next[idx] = filter
    updateFilters(next)
  }

  function deleteFilter(idx: number) {
    const nextFilters = data.config.filters.filter((_, i) => i !== idx)
    updateConfig({ filters: nextFilters })
  }

  function addTableFilter() {
    const mainTableOption =
      filterableTables.find((t) => t.table === data.config.table) ??
      filterableTables[0]
    if (!mainTableOption) return
    const cols = getFilterableColumns(mainTableOption.table)
    const newFilter: FilterCondition = {
      column: cols[0]?.name ?? '',
      op: '=',
      table: mainTableOption.table,
    }
    updateFilters([...data.config.filters, newFilter])
  }

  function addExistsFilter() {
    const firstTable = existsTables[0]
    if (!firstTable) return
    const newFilter: ExistsCondition = {
      mode: 'exists',
      table: firstTable.table,
    }
    updateFilters([...data.config.filters, newFilter])
  }

  const currentOutputIdColumn =
    data.config.outputIdColumn ?? outputIdColumns[0]?.name ?? 'id'

  const currentOutputTimeColumn =
    data.config.outputTimeColumn ??
    getDefaultTimeColumn(data.config.table) ??
    null

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select
          onValueChange={(v) =>
            updateConfig({
              inputBinding: undefined,
              inputBindings: undefined,
              outputIdColumn: undefined,
              outputTimeColumn: undefined,
              table: v,
            })
          }
          value={data.config.table}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {tables.map((t) => (
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
          {data.config.table}
        </p>
      </div>

      {outputIdColumns.length > 1 && (
        <div>
          <span className="text-xs font-semibold text-gray-300 block mb-1">
            出力IDカラム
          </span>
          <Select
            onValueChange={(v) => updateConfig({ outputIdColumn: v })}
            value={currentOutputIdColumn}
          >
            <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {outputIdColumns.map((c) => (
                <SelectItem key={c.name} textValue={c.label} value={c.name}>
                  <span className="block">{c.label}</span>
                  <span className="block text-[10px] text-gray-500 font-mono">
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {outputTimeColumns.length > 1 && currentOutputTimeColumn && (
        <div>
          <span className="text-xs font-semibold text-gray-300 block mb-1">
            出力時刻カラム
          </span>
          <Select
            onValueChange={(v) => updateConfig({ outputTimeColumn: v })}
            value={currentOutputTimeColumn}
          >
            <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {outputTimeColumns.map((c) => (
                <SelectItem key={c.name} textValue={c.label} value={c.name}>
                  <span className="block">{c.label}</span>
                  <span className="block text-[10px] text-gray-500 font-mono">
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-300">
            フィルタ条件
            {data.config.filters.length > 0 && (
              <span className="ml-1 text-gray-500">
                ({data.config.filters.length})
              </span>
            )}
          </span>
          <div className="flex gap-1">
            <button
              className="flex items-center gap-0.5 rounded bg-blue-900/40 border border-blue-700/50 px-1.5 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/70 hover:text-blue-300 transition-colors"
              onClick={addTableFilter}
              title="列フィルタを追加"
              type="button"
            >
              <Plus className="h-2.5 w-2.5" />列
            </button>
            {existsTables.length > 0 && (
              <button
                className="flex items-center gap-0.5 rounded bg-purple-900/40 border border-purple-700/50 px-1.5 py-0.5 text-[10px] text-purple-400 hover:bg-purple-900/70 hover:text-purple-300 transition-colors"
                onClick={addExistsFilter}
                title="EXISTSフィルタを追加"
                type="button"
              >
                <Plus className="h-2.5 w-2.5" />
                EXISTS
              </button>
            )}
          </div>
        </div>

        {data.config.filters.length === 0 && (
          <p className="text-xs text-gray-600">条件なし（全件取得）</p>
        )}

        {data.config.filters.map((filter, idx) => {
          const key = isFilterCondition(filter)
            ? `fc-${idx}-${filter.table}-${filter.column}-${filter.op}`
            : `ec-${idx}-${filter.table}-${filter.mode}`
          return isFilterCondition(filter) ? (
            <FilterConditionRow
              filter={filter}
              flatColumns={flatColumns}
              key={key}
              onDelete={() => deleteFilter(idx)}
              onUpdate={(f) => updateFilter(idx, f)}
              upstreamNodes={upstreamNodes}
            />
          ) : (
            <ExistsConditionRow
              existsTables={existsTables}
              filter={filter}
              key={key}
              onDelete={() => deleteFilter(idx)}
              onUpdate={(f) => updateFilter(idx, f)}
            />
          )
        })}
      </div>
    </div>
  )
}
