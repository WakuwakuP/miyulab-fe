'use client'

import { Handle, Position } from '@xyflow/react'
import { BarChart3, X } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useFlowActions } from '../FlowCanvas'
import type { GetIdsFlowNodeData } from '../types'

type Props = { id: string; data: GetIdsFlowNodeData; selected?: boolean }

export const GetIdsFlowNode = memo(function GetIdsFlowNode({
  id,
  data,
  selected,
}: Props) {
  const { deleteNode } = useFlowActions()

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteNode(id)
    },
    [deleteNode, id],
  )

  const bindings = data.config.inputBindings ?? []
  const outputIdColumn = data.config.outputIdColumn

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[180px] shadow-md transition-all ${
        selected
          ? 'border-sky-400 shadow-sky-400/20'
          : 'border-sky-600 shadow-black/20'
      } bg-gray-900 group`}
    >
      <Handle
        className="!w-3 !h-3 !border-2 !border-sky-400 !bg-gray-900"
        id="ids-in"
        position={Position.Left}
        type="target"
      />
      <div className="flex items-center gap-2 mb-1">
        <BarChart3 className="h-4 w-4 text-sky-400" />
        <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex-1">
          getIds
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
          onClick={handleDelete}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="text-sm font-medium text-white">{data.config.table}</div>
      <div className="text-[10px] text-gray-500 mt-0.5">
        {data.config.filters.length} 条件
        {data.config.orBranches?.length
          ? ` / OR ${data.config.orBranches.length} 枝`
          : ''}
      </div>
      {outputIdColumn && outputIdColumn !== 'id' && (
        <div className="text-[10px] text-emerald-400 mt-0.5">
          → {outputIdColumn}
        </div>
      )}
      {bindings.length > 0 && (
        <div className="text-[10px] text-sky-400 mt-0.5">
          ← {bindings.map((b) => b.column).join(', ')}
        </div>
      )}
      <Handle
        className="!w-3 !h-3 !bg-sky-400 !border-2 !border-sky-600"
        position={Position.Right}
        type="source"
      />
    </div>
  )
})
