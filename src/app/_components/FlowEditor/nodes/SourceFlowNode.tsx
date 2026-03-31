'use client'

import { Handle, Position } from '@xyflow/react'
import { Database, X } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useFlowActions } from '../FlowCanvas'
import type { SourceNodeData } from '../types'

type Props = { id: string; data: SourceNodeData; selected?: boolean }

export const SourceFlowNode = memo(function SourceFlowNode({
  id,
  data,
  selected,
}: Props) {
  const { deleteNode } = useFlowActions()
  const isNotification = data.config.table === 'notifications'

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteNode(id)
    },
    [deleteNode, id],
  )

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[180px] shadow-md transition-all ${
        selected
          ? 'border-blue-400 shadow-blue-400/20'
          : 'border-blue-600 shadow-black/20'
      } bg-gray-900 group`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4 text-blue-400" />
        <span className="text-xs font-bold text-blue-400 uppercase tracking-wider flex-1">
          Source
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
        {isNotification ? '🔔 通知' : '📝 投稿'}
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">
        {data.config.table}
      </div>
      <Handle
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-blue-600"
        position={Position.Right}
        type="source"
      />
    </div>
  )
})
