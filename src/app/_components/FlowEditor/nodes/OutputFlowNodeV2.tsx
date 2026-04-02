'use client'

import { Handle, Position } from '@xyflow/react'
import { ArrowDownToLine, Loader2, X } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useFlowActions } from '../FlowCanvas'
import type { OutputFlowNodeDataV2 } from '../types'

type Props = { id: string; data: OutputFlowNodeDataV2; selected?: boolean }

export const OutputFlowNodeV2 = memo(function OutputFlowNodeV2({
  id,
  data,
  selected,
}: Props) {
  const { deleteNode, execStatus } = useFlowActions()

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteNode(id)
    },
    [deleteNode, id],
  )

  const isRunning = execStatus?.nodeStates[id] === 'running'
  const stat = execStatus?.nodeStats[id]
  const totalMs = execStatus?.totalDurationMs

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[160px] shadow-md transition-all ${
        isRunning
          ? 'border-amber-400 shadow-amber-400/20'
          : selected
            ? 'border-green-400 shadow-green-400/20'
            : 'border-green-600 shadow-black/20'
      } bg-gray-900 group`}
    >
      <Handle
        className="!w-3 !h-3 !bg-green-400 !border-2 !border-green-600"
        position={Position.Left}
        type="target"
      />
      <div className="flex items-center gap-2 mb-1">
        <ArrowDownToLine className="h-4 w-4 text-green-400" />
        <span className="text-xs font-bold text-green-400 uppercase tracking-wider flex-1">
          output
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
          onClick={handleDelete}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="text-sm font-medium text-white">
        {data.config.sort.direction === 'DESC' ? '新しい順' : '古い順'}
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">
        {data.config.pagination.limit} 件
      </div>
      {/* 実行状態: running */}
      {isRunning && (
        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Phase2/3 実行中…</span>
        </div>
      )}
      {/* 実行状態: error */}
      {execStatus?.nodeStates[id] === 'error' && (
        <div className="mt-1.5 text-[10px] text-red-400">
          ❌ {execStatus.error ?? 'エラー'}
        </div>
      )}
      {/* 実行状態: done — 結果サマリー */}
      {execStatus?.nodeStates[id] === 'done' && stat && (
        <div className="mt-1.5 space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full">
              ✅ {stat.rowCount.toLocaleString()} 件取得
            </span>
          </div>
          {totalMs != null && (
            <div className="text-[10px] text-gray-400">
              合計: {totalMs.toFixed(0)}ms
            </div>
          )}
        </div>
      )}
    </div>
  )
})
