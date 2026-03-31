'use client'

// ============================================================
// NodeEditorPanel — ノードベースのクエリエディタ
// ============================================================
//
// FilterNode[] をビジュアルにカード表示し、追加・削除・編集を可能にする。
// 下部に SQL プレビューを表示する。

import { useCallback, useMemo } from 'react'
import type { ResolvedAccount } from 'util/accountResolver'
import { nodesToWhere } from 'util/db/query-ir/compat/nodesToWhere'
import type { FilterNode } from 'util/db/query-ir/nodes'
import { AddFilterMenu } from './AddFilterMenu'
import { NodeCard } from './NodeCard'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeEditorPanelProps = {
  /** 登録済みアカウント一覧 (BackendFilter 用) */
  accounts?: ReadonlyMap<string, ResolvedAccount>
  nodes: FilterNode[]
  onChange: (nodes: FilterNode[]) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodeEditorPanel({
  accounts,
  nodes,
  onChange,
}: NodeEditorPanelProps) {
  const handleUpdate = useCallback(
    (index: number, updated: FilterNode) => {
      const next = [...nodes]
      next[index] = updated
      onChange(next)
    },
    [nodes, onChange],
  )

  const handleRemove = useCallback(
    (index: number) => {
      onChange(nodes.filter((_, i) => i !== index))
    },
    [nodes, onChange],
  )

  const handleAddNode = useCallback(
    (node: FilterNode) => {
      onChange([...nodes, node])
    },
    [nodes, onChange],
  )

  const handleApplyPreset = useCallback(
    (presetNodes: FilterNode[]) => {
      onChange(presetNodes)
    },
    [onChange],
  )

  // SQL プレビュー
  const sqlPreview = useMemo(() => nodesToWhere(nodes), [nodes])

  return (
    <div className="space-y-2">
      {/* Node cards */}
      {nodes.length === 0 ? (
        <div className="text-center text-xs text-gray-500 py-4">
          フィルタを追加してクエリを構築しましょう
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node, index) => (
            <NodeCard
              accounts={accounts}
              // biome-ignore lint/suspicious/noArrayIndexKey: nodes don't have stable IDs
              key={index}
              node={node}
              onRemove={() => handleRemove(index)}
              onUpdate={(updated) => handleUpdate(index, updated)}
            />
          ))}
        </div>
      )}

      {/* Add filter button */}
      <AddFilterMenu
        onAddNode={handleAddNode}
        onApplyPreset={handleApplyPreset}
      />

      {/* SQL Preview */}
      {sqlPreview && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
            生成される SQL
          </summary>
          <pre className="mt-1 rounded bg-gray-900 border border-gray-700 p-2 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap">
            {sqlPreview}
          </pre>
        </details>
      )}
    </div>
  )
}
