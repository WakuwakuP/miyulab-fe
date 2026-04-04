'use client'

import { X } from 'lucide-react'
import { useCallback } from 'react'
import type {
  AerialReplyFilter,
  ExistsFilter,
  FilterNode,
  BackendFilter as IRBackendFilter,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from 'util/db/query-ir/nodes'
import { AerialReplyBody } from './AerialReplyBody'
import { BackendFilterBody } from './BackendFilterBody'
import { ExistsFilterBody } from './ExistsFilterBody'
import { getNodeMeta } from './nodeCardMeta'
import type { NodeCardProps } from './nodeCardTypes'
import { RawSQLBody } from './RawSQLBody'
import { TableFilterBody } from './TableFilterBody'
import { TimelineScopeBody } from './TimelineScopeBody'

export function NodeCard({
  accounts,
  node,
  onRemove,
  onUpdate,
}: NodeCardProps) {
  const meta = getNodeMeta(node)

  const handleUpdate = useCallback(
    (updated: FilterNode) => onUpdate(updated),
    [onUpdate],
  )

  return (
    <div className={`rounded-lg border p-3 ${meta.color} transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {meta.icon}
          <span className="text-xs font-semibold text-gray-200">
            {meta.label}
          </span>
        </div>
        <button
          className="p-0.5 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200 transition-colors"
          onClick={onRemove}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body — kind-specific */}
      {node.kind === 'timeline-scope' && (
        <TimelineScopeBody
          node={node}
          onUpdate={handleUpdate as (n: TimelineScope) => void}
        />
      )}
      {node.kind === 'table-filter' && (
        <TableFilterBody
          node={node}
          onUpdate={handleUpdate as (n: TableFilter) => void}
        />
      )}
      {node.kind === 'exists-filter' && (
        <ExistsFilterBody
          node={node}
          onUpdate={handleUpdate as (n: ExistsFilter) => void}
        />
      )}
      {node.kind === 'raw-sql-filter' && (
        <RawSQLBody
          node={node}
          onUpdate={handleUpdate as (n: RawSQLFilter) => void}
        />
      )}
      {node.kind === 'backend-filter' && (
        <BackendFilterBody
          accounts={accounts}
          node={node}
          onUpdate={handleUpdate as (n: IRBackendFilter) => void}
        />
      )}
      {node.kind === 'moderation-filter' && (
        <div className="text-xs text-gray-400">
          適用: {node.apply.join(', ') || '(なし)'}
        </div>
      )}
      {node.kind === 'aerial-reply-filter' && (
        <AerialReplyBody
          node={node}
          onUpdate={handleUpdate as (n: AerialReplyFilter) => void}
        />
      )}
    </div>
  )
}
