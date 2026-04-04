'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { Switch } from 'components/ui/switch'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  getAllFilterableTables,
  getJoinableColumns,
  getTimeColumns,
} from 'util/db/query-ir/completion'
import type { TimeCondition } from 'util/db/query-ir/nodes'
import type { FlowNodePanelProps } from './flowNodePanelTypes'
import type { FlowEdge, FlowNode, LookupRelatedFlowNodeData } from './types'

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

type LookupRelatedPanelProps = {
  edges: FlowEdge[]
  node: FlowNode
  nodes: FlowNode[]
  onUpdate: FlowNodePanelProps['onUpdate']
}

export function LookupRelatedPanel({
  edges,
  node,
  nodes,
  onUpdate,
}: LookupRelatedPanelProps) {
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
  const updateJoinCondition = (
    idx: number,
    patch: Partial<import('util/db/query-ir/nodes').JoinCondition>,
  ) => {
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
          <SelectContent className="max-h-60">
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
            <div key={key}>
              <div className="flex items-center gap-1 mb-0.5">
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
                    <SelectContent className="max-h-60">
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
                    <SelectContent className="max-h-60">
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
              {(cond.inputColumn.includes('profile_id') ||
                cond.lookupColumn.includes('profile_id')) && (
                <div className="flex items-center gap-1.5 ml-1 mb-1">
                  <Switch
                    checked={cond.resolveIdentity ?? false}
                    className="scale-[0.6] origin-left"
                    onCheckedChange={(v) =>
                      updateJoinCondition(idx, { resolveIdentity: v })
                    }
                  />
                  <span className="text-[9px] text-gray-500">同一人物解決</span>
                </div>
              )}
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
                <SelectContent className="max-h-60">
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
                <SelectContent className="max-h-60">
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

      {/* 取得上限 */}
      <div className="rounded border border-gray-700 p-2">
        <span className="text-xs font-semibold text-gray-300 block mb-1.5">
          取得上限
        </span>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 w-14 shrink-0">
              件数
            </span>
            <input
              className="flex-1 rounded bg-gray-700 border border-gray-600 px-2 py-0.5 text-xs text-white"
              min={0}
              onChange={(e) => {
                const v =
                  e.target.value === ''
                    ? undefined
                    : Math.max(0, Number.parseInt(e.target.value, 10))
                updateConfig({ perLimit: Number.isNaN(v) ? undefined : v })
              }}
              placeholder="無制限"
              type="number"
              value={data.config.perLimit ?? ''}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 w-14 shrink-0">
              順序
            </span>
            <div className="flex gap-1">
              <button
                className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
                  data.config.perLimitOrder !== 'nearest'
                    ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400'
                }`}
                onClick={() => updateConfig({ perLimitOrder: 'furthest' })}
                type="button"
              >
                最遠
              </button>
              <button
                className={`rounded px-1.5 py-0.5 text-[10px] border transition-colors ${
                  data.config.perLimitOrder === 'nearest'
                    ? 'bg-sky-900/50 border-sky-700 text-sky-300'
                    : 'bg-gray-700 border-gray-600 text-gray-400'
                }`}
                onClick={() => updateConfig({ perLimitOrder: 'nearest' })}
                type="button"
              >
                最近
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
