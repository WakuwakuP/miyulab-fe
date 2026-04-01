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
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { getAllFilterableTables } from 'util/db/query-ir/completion'
import type {
  FlowNode,
  GetIdsFlowNodeData,
  LookupRelatedFlowNodeData,
  MergeFlowNodeDataV2,
  OutputFlowNodeDataV2,
} from './types'

type Props = {
  node: FlowNode
  onUpdate: (id: string, data: FlowNode['data']) => void
  onDelete: () => void
  onClose: () => void
}

export function FlowNodePanel({ node, onUpdate, onDelete, onClose }: Props) {
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
        <GetIdsPanel node={node} onUpdate={onUpdate} />
      )}
      {data.nodeType === 'lookup-related' && (
        <LookupRelatedPanel node={node} onUpdate={onUpdate} />
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
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as GetIdsFlowNodeData
  const tables = useMemo(() => getAllFilterableTables(), [])

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: { ...data.config, table: v },
            })
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
      <p className="text-xs text-gray-500">
        フィルタ詳細は今後の編集で拡張予定です（現在は{' '}
        {data.config.filters.length} 件）。
      </p>
    </div>
  )
}

function LookupRelatedPanel({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as LookupRelatedFlowNodeData
  const tables = useMemo(() => getAllFilterableTables(), [])

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          検索先テーブル
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: { ...data.config, lookupTable: v },
            })
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
    </div>
  )
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
