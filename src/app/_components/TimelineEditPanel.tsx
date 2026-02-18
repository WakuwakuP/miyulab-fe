'use client'

import { BackendFilterSelector } from 'app/_components/BackendFilterSelector'
import { QueryEditor } from 'app/_components/QueryEditor'
import { TagConfigEditor } from 'app/_components/TagConfigEditor'
import { FilterControls, MuteBlockControls } from 'app/_parts/FilterControls'
import { InstanceBlockManager } from 'app/_parts/InstanceBlockManager'
import { MuteManager } from 'app/_parts/MuteManager'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackendFilter, TagConfig, TimelineConfigV2 } from 'types/types'
import {
  buildQueryFromConfig,
  canParseQuery,
  parseQueryToConfig,
} from 'util/queryBuilder'

type TimelineEditPanelProps = {
  config: TimelineConfigV2
  onCancel: () => void
  onSave: (updates: Partial<TimelineConfigV2>) => void
}

export const TimelineEditPanel = ({
  config,
  onCancel,
  onSave,
}: TimelineEditPanelProps) => {
  const [label, setLabel] = useState(config.label ?? '')
  const [tabGroup, setTabGroup] = useState(config.tabGroup ?? '')
  const [backendFilter, setBackendFilter] = useState<BackendFilter>(
    config.backendFilter ?? { mode: 'all' },
  )
  const [onlyMedia, setOnlyMedia] = useState(config.onlyMedia ?? false)
  const [tagConfig, setTagConfig] = useState<TagConfig>(
    config.tagConfig ?? { mode: 'or', tags: [] },
  )
  // Advanced Query モードの永続化: config から初期値を復元
  const [showAdvanced, setShowAdvanced] = useState(
    config.advancedQuery ?? false,
  )

  // Advanced Query → 通常UI 切替時の復元不可警告
  const [parseWarning, setParseWarning] = useState(false)

  // v2 フィルタオプションのローカル状態
  const [filterUpdates, setFilterUpdates] = useState<Partial<TimelineConfigV2>>(
    {},
  )

  // MuteManager / InstanceBlockManager モーダルの表示状態
  const [showMuteManager, setShowMuteManager] = useState(false)
  const [showBlockManager, setShowBlockManager] = useState(false)

  // フィルタ変更ハンドラ: 差分を蓄積する
  const handleFilterChange = useCallback(
    (updates: Partial<TimelineConfigV2>) => {
      setFilterUpdates((prev) => ({ ...prev, ...updates }))
      // onlyMedia は既存の独立状態と同期
      if (updates.onlyMedia !== undefined) {
        setOnlyMedia(updates.onlyMedia)
      }
    },
    [],
  )

  // 現在のフィルタ状態をマージした config
  const mergedConfig = useMemo(
    () => ({
      ...config,
      backendFilter,
      onlyMedia,
      ...filterUpdates,
    }),
    [backendFilter, config, onlyMedia, filterUpdates],
  )

  // UI 設定から構築されたクエリ
  const builtQuery = useMemo(
    () =>
      buildQueryFromConfig({
        ...mergedConfig,
        tagConfig,
      }),
    [mergedConfig, tagConfig],
  )

  // カスタムクエリ: 初期値は保存済みクエリ or UI から構築
  const [customQuery, setCustomQuery] = useState(
    config.customQuery ?? builtQuery,
  )

  // 通常UIモード時は UI 変更に連動してクエリを更新
  useEffect(() => {
    if (!showAdvanced) {
      setCustomQuery(builtQuery)
    }
  }, [builtQuery, showAdvanced])

  // Advanced Query トグル
  const handleToggleAdvanced = useCallback(() => {
    setShowAdvanced((prev) => {
      const next = !prev
      if (next) {
        // 通常UI → Advanced: 現在の UI 設定からクエリを生成して反映
        setCustomQuery(builtQuery)
        setParseWarning(false)
      } else {
        // Advanced → 通常UI: クエリから UI 設定を逆算（ベストエフォート）
        const parseable = canParseQuery(customQuery, mergedConfig)
        setParseWarning(!parseable)

        const parsed = parseQueryToConfig(customQuery)
        if (parsed) {
          if (parsed.onlyMedia !== undefined) setOnlyMedia(parsed.onlyMedia)
          if (parsed.tagConfig) setTagConfig(parsed.tagConfig)
          // backendFilter も逆算
          if (parsed.backendFilter) {
            setBackendFilter(parsed.backendFilter)
          } else {
            setBackendFilter({ mode: 'all' })
          }
          // v2 フィルタオプションも逆算
          const restoredUpdates: Partial<TimelineConfigV2> = {}
          if (parsed.timelineTypes !== undefined)
            restoredUpdates.timelineTypes = parsed.timelineTypes
          if (parsed.excludeReblogs !== undefined)
            restoredUpdates.excludeReblogs = parsed.excludeReblogs
          if (parsed.excludeReplies !== undefined)
            restoredUpdates.excludeReplies = parsed.excludeReplies
          if (parsed.excludeSpoiler !== undefined)
            restoredUpdates.excludeSpoiler = parsed.excludeSpoiler
          if (parsed.excludeSensitive !== undefined)
            restoredUpdates.excludeSensitive = parsed.excludeSensitive
          if (parsed.visibilityFilter !== undefined)
            restoredUpdates.visibilityFilter = parsed.visibilityFilter
          if (parsed.languageFilter !== undefined)
            restoredUpdates.languageFilter = parsed.languageFilter
          if (parsed.accountFilter !== undefined)
            restoredUpdates.accountFilter = parsed.accountFilter
          if (parsed.minMediaCount !== undefined)
            restoredUpdates.minMediaCount = parsed.minMediaCount
          if (parsed.notificationFilter !== undefined)
            restoredUpdates.notificationFilter = parsed.notificationFilter
          setFilterUpdates((prev) => ({ ...prev, ...restoredUpdates }))
        }
      }
      return next
    })
  }, [builtQuery, customQuery, mergedConfig])

  const handleSave = useCallback(() => {
    const updates: Partial<TimelineConfigV2> = {
      advancedQuery: showAdvanced,
      // Advanced Query モードでは backendFilter はクエリに含まれるため all にリセット
      backendFilter: showAdvanced ? { mode: 'all' } : backendFilter,
      customQuery: customQuery.trim() || undefined,
      label: label.trim() || undefined,
      onlyMedia,
      tabGroup: tabGroup.trim() || undefined,
      tagConfig,
      // v2 フィルタオプション
      ...filterUpdates,
    }

    onSave(updates)
  }, [
    backendFilter,
    customQuery,
    filterUpdates,
    label,
    onSave,
    onlyMedia,
    showAdvanced,
    tabGroup,
    tagConfig,
  ])

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

      {/* Tab Group */}
      <div className="space-y-1">
        <label
          className="text-xs font-semibold text-gray-300"
          htmlFor={`tabGroup-${config.id}`}
        >
          Tab Group
        </label>
        <input
          className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white"
          id={`tabGroup-${config.id}`}
          onChange={(e) => setTabGroup(e.target.value)}
          placeholder="Empty = standalone column"
          type="text"
          value={tabGroup}
        />
        <p className="text-xs text-gray-500">
          同じグループ名を持つタイムラインがタブで切り替え可能になります
        </p>
      </div>

      {/* Advanced Query トグルスイッチ（表示名の直下） */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300">
          Advanced Query
        </span>
        <button
          aria-checked={showAdvanced}
          aria-label="Advanced Query"
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
            showAdvanced ? 'bg-blue-600' : 'bg-gray-600'
          }`}
          onClick={handleToggleAdvanced}
          role="switch"
          type="button"
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-0.5 ${
              showAdvanced ? 'translate-x-4 ml-0.5' : 'translate-x-0 ml-0.5'
            }`}
          />
        </button>
      </div>

      {/* クエリ復元不可警告 */}
      {!showAdvanced && parseWarning && (
        <div className="rounded border border-yellow-600 bg-yellow-900/30 px-3 py-2 text-xs text-yellow-300">
          ⚠️ The query could not be fully restored to UI settings. Some
          conditions may have been lost.
        </div>
      )}

      {/* 通常UIモード: Backend Filter + Filters + Tag Config */}
      {!showAdvanced && (
        <>
          {/* Backend Filter */}
          <BackendFilterSelector
            onChange={setBackendFilter}
            value={backendFilter}
          />

          {/* v2 フィルタコントロール（Media, Visibility, Language, Toggle, Account） */}
          <FilterControls config={mergedConfig} onChange={handleFilterChange} />

          <TagConfigEditor onChange={setTagConfig} value={tagConfig} />

          {/* Mute / Block コントロール */}
          <MuteBlockControls
            config={mergedConfig}
            onChange={handleFilterChange}
            onOpenBlockManager={() => setShowBlockManager(true)}
            onOpenMuteManager={() => setShowMuteManager(true)}
          />
        </>
      )}

      {/* Advanced Query エディタ */}
      {showAdvanced && (
        <QueryEditor onChange={setCustomQuery} value={customQuery} />
      )}

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
    </div>
  )
}
