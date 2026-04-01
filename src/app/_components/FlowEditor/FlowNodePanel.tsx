'use client'

// ============================================================
// FlowNodePanel — QueryPlanV2 ノード用プロパティパネル
// ============================================================

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { Link, Plus, Trash2, X } from 'lucide-react'
import { useMemo } from 'react'
import type { TableOption } from 'util/db/query-ir/completion'
import {
  getAllFilterableTables,
  getExistsFilterTables,
  getFilterableColumns,
  getFilterableTables,
  getJoinableColumns,
  getKnownValues,
  getTimeColumns,
} from 'util/db/query-ir/completion'
import type {
  ExistsCondition,
  FilterCondition,
  FilterOp,
  GetIdsFilter,
  GetIdsInputBinding,
  JoinCondition,
  TimeCondition,
} from 'util/db/query-ir/nodes'
import { ValueInput } from '../NodeEditor/ValueInput'
import type {
  FlowEdge,
  FlowNode,
  GetIdsFlowNodeData,
  LookupRelatedFlowNodeData,
  MergeFlowNodeDataV2,
  OutputFlowNodeDataV2,
} from './types'
import { getNodeLabelV2 } from './types'

// --------------- Flat column option for FilterConditionRow ---------------

type FlatColumnOption = {
  columnLabel: string
  columnName: string
  tableLabel: string
  tableName: string
}

/** filterableTables から全カラムをフラット展開する */
function buildFlatColumns(filterableTables: TableOption[]): FlatColumnOption[] {
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

function flatColumnKey(
  opt: Pick<FlatColumnOption, 'tableName' | 'columnName'>,
) {
  return `${opt.tableName}:${opt.columnName}`
}

const ALL_OPS: FilterOp[] = [
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

const NO_VALUE_OPS = new Set<FilterOp>(['IS NULL', 'IS NOT NULL'])

const EXISTS_MODES = [
  { label: '存在する', value: 'exists' },
  { label: '存在しない', value: 'not-exists' },
  { label: '件数 >= N', value: 'count-gte' },
  { label: '件数 <= N', value: 'count-lte' },
  { label: '件数 = N', value: 'count-eq' },
] as const

function isFilterCondition(f: GetIdsFilter): f is FilterCondition {
  return 'op' in f
}

type Props = {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: (id: string, data: FlowNode['data']) => void
  onDelete: () => void
  onClose: () => void
}

export function FlowNodePanel({
  edges,
  node,
  nodes,
  onUpdate,
  onDelete,
  onClose,
}: Props) {
  const data = node.data as { nodeType: string }

  return (
    <div className="w-72 border-l border-gray-700 bg-gray-850 p-4 overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">ノード設定</h3>
        <button
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {data.nodeType === 'get-ids' && (
        <GetIdsPanel
          edges={edges}
          node={node}
          nodes={nodes}
          onUpdate={onUpdate}
        />
      )}
      {data.nodeType === 'lookup-related' && (
        <LookupRelatedPanel
          edges={edges}
          node={node}
          nodes={nodes}
          onUpdate={onUpdate}
        />
      )}
      {data.nodeType === 'merge-v2' && (
        <MergePanelV2 node={node} onUpdate={onUpdate} />
      )}
      {data.nodeType === 'output-v2' && (
        <OutputPanelV2 node={node} onUpdate={onUpdate} />
      )}

      <div className="mt-auto pt-4 border-t border-gray-700">
        <button
          className="w-full rounded bg-red-900/40 border border-red-700/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/70 hover:text-red-300 transition-colors"
          onClick={onDelete}
          type="button"
        >
          このノードを削除
        </button>
      </div>
    </div>
  )
}

function GetIdsPanel({
  edges,
  node,
  nodes,
  onUpdate,
}: {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: Props['onUpdate']
}) {
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

  // 上流接続ノード
  const upstreamNodes = useMemo(
    () =>
      edges
        .filter((e) => e.target === node.id)
        .map((e) => nodes.find((n) => n.id === e.source))
        .filter((n): n is FlowNode => n != null),
    [edges, nodes, node.id],
  )

  // このテーブルのフィルタ可能カラム（inputBinding 用）は FilterConditionRow 内で参照する

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
    const f = data.config.filters[idx]
    const isFC = f && 'op' in f
    const clearBinding =
      isFC && data.config.inputBinding?.column === (f as FilterCondition).column
    const nextFilters = data.config.filters.filter((_, i) => i !== idx)
    if (clearBinding) {
      updateConfig({ filters: nextFilters, inputBinding: undefined })
    } else {
      updateFilters(nextFilters)
    }
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

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select
          onValueChange={(v) =>
            updateConfig({ inputBinding: undefined, table: v })
          }
          value={data.config.table}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
              inputBinding={data.config.inputBinding}
              key={key}
              onDelete={() => deleteFilter(idx)}
              onSetInputBinding={(col) =>
                updateConfig({
                  inputBinding: col ? { column: col } : undefined,
                })
              }
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

function FilterConditionRow({
  filter,
  flatColumns,
  upstreamNodes,
  inputBinding,
  onSetInputBinding,
  onUpdate,
  onDelete,
}: {
  filter: FilterCondition
  flatColumns: FlatColumnOption[]
  upstreamNodes: FlowNode[]
  inputBinding: GetIdsInputBinding | undefined
  onSetInputBinding: (column: string | undefined) => void
  onUpdate: (f: FilterCondition) => void
  onDelete: () => void
}) {
  const knownValues = useMemo(
    () => getKnownValues(filter.table, filter.column),
    [filter.table, filter.column],
  )
  const currentType =
    getFilterableColumns(filter.table).find((c) => c.name === filter.column)
      ?.type ?? 'text'

  const hasUpstream = upstreamNodes.length > 0
  const isInputMode = hasUpstream && inputBinding?.column === filter.column
  const showValueArea = !NO_VALUE_OPS.has(filter.op)

  function handleColumnKey(key: string) {
    const [tbl, ...rest] = key.split(':')
    const col = rest.join(':')
    if (isInputMode) onSetInputBinding(undefined)
    onUpdate({
      column: col,
      op: '=',
      table: tbl,
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

  function toggleInputMode() {
    if (isInputMode) {
      onSetInputBinding(undefined)
    } else {
      onSetInputBinding(filter.column)
      onUpdate({ ...filter, value: undefined })
    }
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
          <SelectContent>
            {flatColumns.map((c) => {
              const k = flatColumnKey(c)
              return (
                <SelectItem key={k} value={k}>
                  {c.columnLabel}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
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
          <SelectContent>
            {ALL_OPS.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showValueArea && (
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] text-gray-400">値</span>
            {hasUpstream && (
              <button
                className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] border transition-colors ${
                  isInputMode
                    ? 'bg-sky-900/60 border-sky-700/70 text-sky-300'
                    : 'bg-gray-700/60 border-gray-600 text-gray-500 hover:text-sky-400 hover:border-sky-700/50'
                }`}
                onClick={toggleInputMode}
                title={isInputMode ? '手動入力に戻す' : '入力から割り当て'}
                type="button"
              >
                <Link className="h-2.5 w-2.5" />
                入力
              </button>
            )}
          </div>
          {isInputMode ? (
            <div className="rounded bg-sky-950/40 border border-sky-800/50 px-2 py-1.5">
              <p className="text-[10px] text-sky-400 mb-1">
                上流ノードの出力を使用
              </p>
              <div className="flex flex-wrap gap-1">
                {upstreamNodes.map((n) => (
                  <span
                    className="rounded bg-gray-700 border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-300"
                    key={n.id}
                  >
                    {getNodeLabelV2(n.data)}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <ValueInput
              column={filter.column}
              columnType={currentType}
              knownValues={knownValues}
              onChange={(value) => onUpdate({ ...filter, value })}
              op={filter.op}
              table={filter.table}
              value={filter.value ?? null}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ExistsConditionRow({
  filter,
  existsTables,
  onUpdate,
  onDelete,
}: {
  filter: ExistsCondition
  existsTables: TableOption[]
  onUpdate: (f: ExistsCondition) => void
  onDelete: () => void
}) {
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
          <SelectContent>
            {existsTables.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          <SelectContent>
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

function LookupRelatedPanel({
  edges,
  node,
  nodes,
  onUpdate,
}: {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as LookupRelatedFlowNodeData
  const tables = useMemo(() => getAllFilterableTables(), [])

  // 上流ノードのテーブルを取得
  const upstreamTable = useMemo(() => {
    const srcId = edges.find((e) => e.target === node.id)?.source
    if (!srcId) return undefined
    const src = nodes.find((n) => n.id === srcId)
    if (!src) return undefined
    const d = src.data as { config?: { table?: string } }
    return d.config?.table
  }, [edges, node.id, nodes])

  const inputColumns = useMemo(
    () => (upstreamTable ? getJoinableColumns(upstreamTable) : []),
    [upstreamTable],
  )

  const lookupColumns = useMemo(
    () => getJoinableColumns(data.config.lookupTable),
    [data.config.lookupTable],
  )

  const inputTimeColumns = useMemo(
    () => (upstreamTable ? getTimeColumns(upstreamTable) : []),
    [upstreamTable],
  )

  const lookupTimeColumns = useMemo(
    () => getTimeColumns(data.config.lookupTable),
    [data.config.lookupTable],
  )

  const updateConfig = (patch: Partial<LookupRelatedFlowNodeData['config']>) =>
    onUpdate(node.id, {
      ...data,
      config: { ...data.config, ...patch },
    })

  // ---- Join conditions ----
  const updateJoinCondition = (idx: number, patch: Partial<JoinCondition>) => {
    const next = data.config.joinConditions.map((c, i) =>
      i === idx ? { ...c, ...patch } : c,
    )
    updateConfig({ joinConditions: next })
  }

  const addJoinCondition = () =>
    updateConfig({
      joinConditions: [
        ...data.config.joinConditions,
        { inputColumn: '', lookupColumn: '' },
      ],
    })

  const removeJoinCondition = (idx: number) =>
    updateConfig({
      joinConditions: data.config.joinConditions.filter((_, i) => i !== idx),
    })

  // ---- Time condition ----
  const hasTime = !!data.config.timeCondition

  const updateTimeCondition = (patch: Partial<TimeCondition>) =>
    updateConfig({
      timeCondition: {
        ...defaultTimeCondition(inputTimeColumns, lookupTimeColumns),
        ...data.config.timeCondition,
        ...patch,
      },
    })

  const toggleTime = () => {
    if (hasTime) {
      updateConfig({ timeCondition: undefined })
    } else {
      updateConfig({
        timeCondition: defaultTimeCondition(
          inputTimeColumns,
          lookupTimeColumns,
        ),
      })
    }
  }

  return (
    <div className="space-y-3">
      {/* 検索先テーブル */}
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          検索先テーブル
        </span>
        <Select
          onValueChange={(v) =>
            updateConfig({ lookupTable: v, timeCondition: undefined })
          }
          value={data.config.lookupTable}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* JOIN 条件 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-300">
            結合条件
            {data.config.joinConditions.length > 0 && (
              <span className="ml-1 text-gray-500">
                ({data.config.joinConditions.length})
              </span>
            )}
          </span>
          <button
            className="flex items-center gap-0.5 rounded bg-blue-900/40 border border-blue-700/50 px-1.5 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/70 hover:text-blue-300 transition-colors"
            onClick={addJoinCondition}
            type="button"
          >
            <Plus className="h-2.5 w-2.5" />
            追加
          </button>
        </div>
        {data.config.joinConditions.length === 0 && (
          <p className="text-[10px] text-gray-600">条件なし</p>
        )}
        {data.config.joinConditions.map((cond, idx) => {
          const key = `jc-${idx}-${cond.inputColumn}-${cond.lookupColumn}`
          return (
            <div className="flex items-center gap-1 mb-1" key={key}>
              <div className="flex-1 min-w-0">
                <Select
                  onValueChange={(v) =>
                    updateJoinCondition(idx, { inputColumn: v })
                  }
                  value={cond.inputColumn}
                >
                  <SelectTrigger className="w-full h-6 text-[10px] bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="入力側" />
                  </SelectTrigger>
                  <SelectContent>
                    {inputColumns.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-[10px] text-gray-500 shrink-0">→</span>
              <div className="flex-1 min-w-0">
                <Select
                  onValueChange={(v) =>
                    updateJoinCondition(idx, { lookupColumn: v })
                  }
                  value={cond.lookupColumn}
                >
                  <SelectTrigger className="w-full h-6 text-[10px] bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="検索先側" />
                  </SelectTrigger>
                  <SelectContent>
                    {lookupColumns.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                className="shrink-0 p-0.5 rounded hover:bg-red-900/40 text-gray-500 hover:text-red-400 transition-colors"
                onClick={() => removeJoinCondition(idx)}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* 時刻条件 */}
      <div className="rounded border border-gray-700 p-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-300">時刻条件</span>
          <button
            className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
              hasTime
                ? 'bg-sky-900/50 border-sky-700/60 text-sky-300'
                : 'bg-gray-700 border-gray-600 text-gray-500'
            }`}
            onClick={toggleTime}
            type="button"
          >
            {hasTime ? '有効' : '無効'}
          </button>
        </div>
        {hasTime && data.config.timeCondition && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-14 shrink-0">
                入力側
              </span>
              <Select
                onValueChange={(v) =>
                  updateTimeCondition({ inputTimeColumn: v })
                }
                value={data.config.timeCondition.inputTimeColumn}
              >
                <SelectTrigger className="flex-1 h-6 text-[10px] bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inputTimeColumns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-14 shrink-0">
                検索先側
              </span>
              <Select
                onValueChange={(v) =>
                  updateTimeCondition({ lookupTimeColumn: v })
                }
                value={data.config.timeCondition.lookupTimeColumn}
              >
                <SelectTrigger className="flex-1 h-6 text-[10px] bg-gray-700 border-gray-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lookupTimeColumns.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-14 shrink-0">
                方向
              </span>
              <div className="flex gap-1">
                <button
                  className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
                    data.config.timeCondition.afterInput
                      ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                      : 'bg-gray-700 border-gray-600 text-gray-400'
                  }`}
                  onClick={() => updateTimeCondition({ afterInput: true })}
                  type="button"
                >
                  後
                </button>
                <button
                  className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
                    !data.config.timeCondition.afterInput
                      ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                      : 'bg-gray-700 border-gray-600 text-gray-400'
                  }`}
                  onClick={() => updateTimeCondition({ afterInput: false })}
                  type="button"
                >
                  前
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-14 shrink-0">
                窓（分）
              </span>
              <input
                className="flex-1 rounded bg-gray-700 border border-gray-600 px-2 py-0.5 text-xs text-white"
                min={0}
                onChange={(e) =>
                  updateTimeCondition({
                    windowMs: Math.max(0, Number(e.target.value)) * 60000,
                  })
                }
                step={0.5}
                type="number"
                value={data.config.timeCondition.windowMs / 60000}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function defaultTimeCondition(
  inputCols: { name: string }[],
  lookupCols: { name: string }[],
): TimeCondition {
  return {
    afterInput: true,
    inputTimeColumn: inputCols[0]?.name ?? 'created_at_ms',
    lookupTimeColumn: lookupCols[0]?.name ?? 'created_at_ms',
    windowMs: 180000,
  }
}

function MergePanelV2({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as MergeFlowNodeDataV2

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          戦略
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: {
                ...data.config,
                strategy: v as MergeFlowNodeDataV2['config']['strategy'],
              },
            })
          }
          value={data.config.strategy}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="union">union</SelectItem>
            <SelectItem value="intersect">intersect</SelectItem>
            <SelectItem value="interleave-by-time">
              interleave-by-time
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          limit
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                config: {
                  ...data.config,
                  limit: Number(e.target.value),
                },
              })
            }
            type="number"
            value={data.config.limit}
          />
        </label>
      </div>
    </div>
  )
}

function OutputPanelV2({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as OutputFlowNodeDataV2

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          ソート方向
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: {
                ...data.config,
                sort: {
                  ...data.config.sort,
                  direction: v as 'ASC' | 'DESC',
                },
              },
            })
          }
          value={data.config.sort.direction}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DESC">新しい順 (DESC)</SelectItem>
            <SelectItem value="ASC">古い順 (ASC)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          取得件数
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                config: {
                  ...data.config,
                  pagination: {
                    ...data.config.pagination,
                    limit: Number(e.target.value),
                  },
                },
              })
            }
            type="number"
            value={data.config.pagination.limit}
          />
        </label>
      </div>
    </div>
  )
}
