'use client'

import { Handle, Position } from '@xyflow/react'
import { ArrowDownToLine, X } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useFlowActions } from '../FlowCanvas'
import type { OutputFlowNodeDataV2 } from '../types'

type Props = { id: string; data: OutputFlowNodeDataV2; selected?: boolean }

export const OutputFlowNodeV2 = memo(function OutputFlowNodeV2({
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

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[160px] shadow-md transition-all ${
        selected
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
    </div>
  )
})
