'use client'

import { FlowQueryEditorModal } from 'app/_components/FlowEditor'
import { InstanceBlockManager } from 'app/_parts/InstanceBlockManager'
import { MuteManager } from 'app/_parts/MuteManager'
import { Pencil, Shield, VolumeX } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { BackendFilter, TimelineConfigV2 } from 'types/types'
import { resolveBackendUrlFromAccountId } from 'util/accountResolver'
import type { ConfigToNodesContext } from 'util/db/query-ir/compat/configToNodes'
import { configToQueryPlan } from 'util/db/query-ir/compat/configToNodes'
import { nodesToWhere } from 'util/db/query-ir/compat/nodesToWhere'
import type { QueryPlan } from 'util/db/query-ir/nodes'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TimelineEditPanelProps = {
  config: TimelineConfigV2
  onCancel: () => void
  onCopyExplain?: () => Promise<void>
  onSave: (updates: Partial<TimelineConfigV2>) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TimelineEditPanel = ({
  config,
  onCancel,
  onSave,
}: TimelineEditPanelProps) => {
  const [label, setLabel] = useState(config.label ?? '')
  const [showFlowEditor, setShowFlowEditor] = useState(false)
  const [showMuteManager, setShowMuteManager] = useState(false)
  const [showBlockManager, setShowBlockManager] = useState(false)

  // 現在の config から QueryPlan を構築（フローエディタの初期状態用）
  // S-3: 保存済み queryPlan があればそのまま復元（ラウンドトリップ保持）
  const initialPlan = useMemo<QueryPlan>(() => {
    if (config.queryPlan) {
      return config.queryPlan
    }
    // フォールバック: 構造化フィールドから構築
    const ctx: ConfigToNodesContext = {
      localAccountIds: [],
      queryLimit: 50,
      serverIds: [],
    }
    return configToQueryPlan(config, ctx)
  }, [config])

  // フローエディタで保存された QueryPlan を TimelineConfigV2 の更新差分に変換する
  const handleFlowSave = useCallback(
    (plan: QueryPlan) => {
      // S-1: plan.filters からモデレーション設定を抽出
      const moderationNode = plan.filters.find(
        (f) => f.kind === 'moderation-filter',
      )
      const applyMute =
        moderationNode?.kind === 'moderation-filter' &&
        moderationNode.apply.includes('mute')
      const applyBlock =
        moderationNode?.kind === 'moderation-filter' &&
        moderationNode.apply.includes('instance-block')

      // S-2: plan.filters からバックエンドフィルタを抽出
      const backendNode = plan.filters.find((f) => f.kind === 'backend-filter')
      let backendFilter: BackendFilter | undefined
      if (
        backendNode?.kind === 'backend-filter' &&
        backendNode.localAccountIds.length > 0
      ) {
        const urls = backendNode.localAccountIds
          .map((id) => resolveBackendUrlFromAccountId(id))
          .filter((u): u is string => u != null)
        if (urls.length === 0) {
          backendFilter = { mode: 'all' }
        } else if (urls.length === 1) {
          backendFilter = { backendUrl: urls[0], mode: 'single' }
        } else {
          backendFilter = { backendUrls: urls, mode: 'composite' }
        }
      } else {
        backendFilter = { mode: 'all' }
      }

      // 後方互換: customQuery テキストも生成（useCustomQueryTimeline で実行するため）
      const customQuery = nodesToWhere(plan.filters)

      const updates: Partial<TimelineConfigV2> = {
        // S-4: ゴーストフィルタを明示的にクリア
        accountFilter: undefined,
        advancedQuery: true,
        applyInstanceBlock: applyBlock || undefined,
        applyMuteFilter: applyMute || undefined,
        backendFilter,
        customQuery: customQuery.trim() || undefined,
        excludeReblogs: undefined,
        excludeReplies: undefined,
        excludeSensitive: undefined,
        excludeSpoiler: undefined,
        followsOnly: undefined,
        label: label.trim() || undefined,
        languageFilter: undefined,
        minMediaCount: undefined,
        notificationFilter: undefined,
        onlyMedia: undefined,
        queryPlan: plan,
        tagConfig: undefined,
        timelineTypes: undefined,
        visibilityFilter: undefined,
      }

      onSave(updates)
      setShowFlowEditor(false)
    },
    [label, onSave],
  )

  // Label のみ変更して保存
  const handleSave = useCallback(() => {
    onSave({ label: label.trim() || undefined })
  }, [label, onSave])

  return (
    <div className="border border-gray-600 rounded-md p-3 mt-2 space-y-3 bg-gray-800">
      <h4 className="text-sm font-semibold text-gray-200">
        Edit:{' '}
        {config.label ||
          config.type.charAt(0).toUpperCase() + config.type.slice(1)}
      </h4>

      {/* Label */}
      <div className="space-y-1">
        <label
          className="text-xs font-semibold text-gray-300"
          htmlFor={`label-${config.id}`}
        >
          Display Name
        </label>
        <input
          className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white"
          id={`label-${config.id}`}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Auto-generated if empty"
          type="text"
          value={label}
        />
      </div>

      {/* フローエディタを開くボタン (メインの編集手段) */}
      <button
        className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-700 bg-cyan-900/30 px-4 py-3 text-sm font-medium text-cyan-300 hover:bg-cyan-900/50 hover:border-cyan-600 transition-colors"
        onClick={() => setShowFlowEditor(true)}
        type="button"
      >
        <Pencil className="h-4 w-4" />
        フローエディタでクエリを編集
      </button>

      {/* ミュート / インスタンスブロック管理 */}
      <div className="flex gap-2">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
          onClick={() => setShowMuteManager(true)}
          type="button"
        >
          <VolumeX className="h-3.5 w-3.5" />
          ミュート管理
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600 transition-colors"
          onClick={() => setShowBlockManager(true)}
          type="button"
        >
          <Shield className="h-3.5 w-3.5" />
          ブロック管理
        </button>
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-2 pt-1">
        <button
          className="rounded bg-gray-600 px-3 py-1 text-sm hover:bg-gray-500"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          onClick={handleSave}
          type="button"
        >
          Save
        </button>
      </div>

      {/* MuteManager モーダル */}
      {showMuteManager && (
        <MuteManager onClose={() => setShowMuteManager(false)} />
      )}

      {/* InstanceBlockManager モーダル */}
      {showBlockManager && (
        <InstanceBlockManager onClose={() => setShowBlockManager(false)} />
      )}

      {/* FlowQueryEditorModal */}
      <FlowQueryEditorModal
        initialPlan={initialPlan}
        onOpenChange={setShowFlowEditor}
        onSave={handleFlowSave}
        open={showFlowEditor}
      />
    </div>
  )
}
