'use client'

import { Handle, Position } from '@xyflow/react'
import { Link2, X } from 'lucide-react'
import { memo, useCallback } from 'react'
import { useFlowActions } from '../FlowCanvas'
import type { LookupRelatedFlowNodeData } from '../types'
import { NodeExecBadge } from './NodeExecBadge'

type Props = { id: string; data: LookupRelatedFlowNodeData; selected?: boolean }

export const LookupRelatedFlowNode = memo(function LookupRelatedFlowNode({
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

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[180px] shadow-md transition-all ${
        isRunning
          ? 'border-amber-400 shadow-amber-400/20'
          : selected
            ? 'border-violet-400 shadow-violet-400/20'
            : 'border-violet-600 shadow-black/20'
      } bg-gray-900 group`}
    >
      <Handle
        className="!w-3 !h-3 !bg-violet-400 !border-2 !border-violet-600"
        position={Position.Left}
        type="target"
      />
      <div className="flex items-center gap-2 mb-1">
        <Link2 className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-bold text-violet-400 uppercase tracking-wider flex-1">
          lookup
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
        {data.config.lookupTable}
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">
        結合 {data.config.joinConditions.length} 件
      </div>
      {(data.config.limit != null || data.config.order) && (
        <div className="text-[10px] text-violet-300 mt-0.5">
          {data.config.order === 'nearest' ? '最近' : '最遠'}
          {data.config.limit != null && ` ${data.config.limit}件まで`}
        </div>
      )}
      <NodeExecBadge execStatus={execStatus} nodeId={id} />
      <Handle
        className="!w-3 !h-3 !bg-violet-400 !border-2 !border-violet-600"
        position={Position.Right}
        type="source"
      />
    </div>
  )
})
