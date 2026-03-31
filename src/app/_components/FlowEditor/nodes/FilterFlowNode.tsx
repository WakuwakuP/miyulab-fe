'use client'

import { Handle, Position } from '@xyflow/react'
import {
  BarChart3,
  Code,
  Eye,
  Filter,
  Globe,
  Hash,
  MessageSquare,
  Shield,
  User,
  X,
  Zap,
} from 'lucide-react'
import { memo, useCallback } from 'react'
import type { FilterNode } from 'util/db/query-ir/nodes'
import { useFlowActions } from '../FlowCanvas'
import type { FilterNodeData } from '../types'

type Props = { id: string; data: FilterNodeData; selected?: boolean }

function getFilterIcon(filter: FilterNode) {
  switch (filter.kind) {
    case 'timeline-scope':
      return <Globe className="h-4 w-4 text-emerald-400" />
    case 'backend-filter':
      return <Globe className="h-4 w-4 text-emerald-400" />
    case 'exists-filter':
      return <Eye className="h-4 w-4 text-indigo-400" />
    case 'table-filter': {
      switch (filter.table) {
        case 'notification_types':
          return <MessageSquare className="h-4 w-4 text-pink-400" />
        case 'hashtags':
          return <Hash className="h-4 w-4 text-teal-400" />
        case 'profiles':
          return <User className="h-4 w-4 text-purple-400" />
        case 'post_stats':
          return <BarChart3 className="h-4 w-4 text-amber-400" />
        case 'visibility_types':
          return <Eye className="h-4 w-4 text-yellow-400" />
        default:
          return <Filter className="h-4 w-4 text-gray-400" />
      }
    }
    case 'moderation-filter':
      return <Shield className="h-4 w-4 text-red-400" />
    case 'aerial-reply-filter':
      return <Zap className="h-4 w-4 text-yellow-400" />
    case 'raw-sql-filter':
      return <Code className="h-4 w-4 text-orange-400" />
    case 'or-group':
      return <Filter className="h-4 w-4 text-cyan-400" />
    default:
      return <Filter className="h-4 w-4 text-gray-400" />
  }
}

function getFilterColor(filter: FilterNode): string {
  switch (filter.kind) {
    case 'timeline-scope':
      return 'border-emerald-600'
    case 'backend-filter':
      return 'border-emerald-600'
    case 'exists-filter':
      return 'border-indigo-600'
    case 'table-filter':
      return 'border-purple-600'
    case 'moderation-filter':
      return 'border-red-600'
    case 'aerial-reply-filter':
      return 'border-yellow-600'
    case 'raw-sql-filter':
      return 'border-orange-600'
    case 'or-group':
      return 'border-cyan-600'
    default:
      return 'border-gray-600'
  }
}

export const FilterFlowNode = memo(function FilterFlowNode({
  id,
  data,
  selected,
}: Props) {
  const { deleteNode } = useFlowActions()
  const borderColor = getFilterColor(data.filter)

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteNode(id)
    },
    [deleteNode, id],
  )

  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 min-w-[200px] max-w-[280px] shadow-md transition-all ${
        selected
          ? `${borderColor} shadow-white/10 ring-1 ring-white/30`
          : borderColor
      } bg-gray-900 shadow-black/20 group`}
    >
      <Handle
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-600"
        position={Position.Left}
        type="target"
      />
      <div className="flex items-center gap-2 mb-1">
        {getFilterIcon(data.filter)}
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex-1">
          Filter
        </span>
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 transition-all"
          onClick={handleDelete}
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="text-sm font-medium text-white truncate">
        {data.label}
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5">{data.filter.kind}</div>
      <Handle
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-600"
        position={Position.Right}
        type="source"
      />
    </div>
  )
})
