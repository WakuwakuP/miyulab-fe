'use client'

// ============================================================
// FlowNodePanel — QueryPlanV2 ノード用プロパティパネル
// ============================================================

import { X } from 'lucide-react'
import type { FlowNodePanelProps } from './flowNodePanelTypes'
import { GetIdsPanel } from './GetIdsPanel'
import { LookupRelatedPanel } from './LookupRelatedPanel'
import { MergePanelV2 } from './MergePanelV2'
import { OutputPanelV2 } from './OutputPanelV2'

export function FlowNodePanel({
  edges,
  node,
  nodes,
  onUpdate,
  onDelete,
  onClose,
}: FlowNodePanelProps) {
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
