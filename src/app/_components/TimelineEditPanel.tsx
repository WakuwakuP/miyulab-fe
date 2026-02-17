'use client'

import { BackendFilterSelector } from 'app/_components/BackendFilterSelector'
import { MediaFilterToggle } from 'app/_components/MediaFilterToggle'
import { QueryEditor } from 'app/_components/QueryEditor'
import { TagConfigEditor } from 'app/_components/TagConfigEditor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BackendFilter, TagConfig, TimelineConfigV2 } from 'types/types'
import { buildQueryFromConfig, parseQueryToConfig } from 'util/queryBuilder'

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
  const [backendFilter, setBackendFilter] = useState<BackendFilter>(
    config.backendFilter ?? { mode: 'all' },
  )
  const [onlyMedia, setOnlyMedia] = useState(config.onlyMedia ?? false)
  const [tagConfig, setTagConfig] = useState<TagConfig>(
    config.tagConfig ?? { mode: 'or', tags: [] },
  )
  const [showAdvanced, setShowAdvanced] = useState(false)

  // UI 設定から構築されたクエリ
  const builtQuery = useMemo(
    () =>
      buildQueryFromConfig({
        ...config,
        onlyMedia,
        tagConfig,
      }),
    [config, onlyMedia, tagConfig],
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

  const isTagTimeline = config.type === 'tag'
  const isNotification = config.type === 'notification'

  // バリデーション: tag タイムラインは最低1つのタグが必要（カスタムクエリがない場合）
  const isValid =
    !isTagTimeline || tagConfig.tags.length > 0 || Boolean(customQuery.trim())

  // Advanced Query トグル
  const handleToggleAdvanced = useCallback(() => {
    setShowAdvanced((prev) => {
      const next = !prev
      if (next) {
        // 通常UI → Advanced: 現在の UI 設定からクエリを生成して反映
        setCustomQuery(builtQuery)
      } else {
        // Advanced → 通常UI: クエリから UI 設定を逆算（ベストエフォート）
        const parsed = parseQueryToConfig(customQuery)
        if (parsed) {
          if (parsed.onlyMedia !== undefined) setOnlyMedia(parsed.onlyMedia)
          if (parsed.tagConfig) setTagConfig(parsed.tagConfig)
        }
      }
      return next
    })
  }, [builtQuery, customQuery])

  const handleSave = useCallback(() => {
    if (!isValid) return

    const updates: Partial<TimelineConfigV2> = {
      backendFilter,
      customQuery: customQuery.trim() || undefined,
      label: label.trim() || undefined,
      onlyMedia,
    }

    if (isTagTimeline) {
      updates.tagConfig = tagConfig
    }

    onSave(updates)
  }, [
    backendFilter,
    customQuery,
    isTagTimeline,
    isValid,
    label,
    onSave,
    onlyMedia,
    tagConfig,
  ])

  return (
    <div className="border border-gray-600 rounded-md p-3 mt-2 space-y-3 bg-gray-800">
      <h4 className="text-sm font-semibold text-gray-200">
        Edit: {config.label || config.type}
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

      {/* Backend Filter */}
      <BackendFilterSelector
        onChange={setBackendFilter}
        value={backendFilter}
      />

      {/* 通常UIモード: Media Filter + Tag Config */}
      {!isNotification && !showAdvanced && (
        <>
          <MediaFilterToggle onChange={setOnlyMedia} value={onlyMedia} />

          {isTagTimeline && (
            <TagConfigEditor onChange={setTagConfig} value={tagConfig} />
          )}
        </>
      )}

      {/* Advanced Query トグル */}
      {!isNotification && (
        <div className="space-y-1">
          <label className="flex items-center space-x-2 cursor-pointer text-sm">
            <input
              checked={showAdvanced}
              className="cursor-pointer"
              onChange={handleToggleAdvanced}
              type="checkbox"
            />
            <span className="text-xs font-semibold text-gray-300">
              Advanced Query
            </span>
          </label>
          {showAdvanced && (
            <QueryEditor onChange={setCustomQuery} value={customQuery} />
          )}
        </div>
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
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
          disabled={!isValid}
          onClick={handleSave}
          type="button"
        >
          Save
        </button>
      </div>

      {!isValid && (
        <p className="text-xs text-red-400">
          Tag timeline requires at least one tag.
        </p>
      )}
    </div>
  )
}
