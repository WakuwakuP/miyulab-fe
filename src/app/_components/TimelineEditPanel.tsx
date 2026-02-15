'use client'

import { BackendFilterSelector } from 'app/_components/BackendFilterSelector'
import { MediaFilterToggle } from 'app/_components/MediaFilterToggle'
import { TagConfigEditor } from 'app/_components/TagConfigEditor'
import { useCallback, useState } from 'react'
import type { BackendFilter, TagConfig, TimelineConfigV2 } from 'types/types'

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

  const isTagTimeline = config.type === 'tag'
  const isNotification = config.type === 'notification'

  // バリデーション: tag タイムラインは最低1つのタグが必要
  const isValid = !isTagTimeline || tagConfig.tags.length > 0

  const handleSave = useCallback(() => {
    if (!isValid) return

    const updates: Partial<TimelineConfigV2> = {
      backendFilter,
      label: label.trim() || undefined,
      onlyMedia,
    }

    if (isTagTimeline) {
      updates.tagConfig = tagConfig
    }

    onSave(updates)
  }, [
    backendFilter,
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

      {/* Media Filter (notification 以外) */}
      {!isNotification && (
        <MediaFilterToggle onChange={setOnlyMedia} value={onlyMedia} />
      )}

      {/* Tag Config (tag タイムラインのみ) */}
      {isTagTimeline && (
        <TagConfigEditor onChange={setTagConfig} value={tagConfig} />
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
