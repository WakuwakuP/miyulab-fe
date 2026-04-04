'use client'

import type { StatusTimelineType, TimelineConfigV2 } from 'types/types'

const TIMELINE_TYPE_OPTIONS: {
  label: string
  value: StatusTimelineType
}[] = [
  { label: '🏠 Home', value: 'home' },
  { label: '👥 Local', value: 'local' },
  { label: '🌐 Public', value: 'public' },
]

export function TimelineTypeSelector({
  configType,
  onChange,
  value,
}: {
  configType: TimelineConfigV2['type']
  onChange: (types: StatusTimelineType[] | undefined) => void
  value: StatusTimelineType[] | undefined
}) {
  // 未設定時は config.type から推定
  const defaultTypes: StatusTimelineType[] =
    configType === 'home' || configType === 'local' || configType === 'public'
      ? [configType]
      : []
  const selected: StatusTimelineType[] = value ?? defaultTypes

  const toggle = (v: StatusTimelineType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 空配列 → undefined（タイムラインなし）
    if (next.length === 0) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Timeline Sources</span>
      <div className="flex flex-wrap gap-2">
        {TIMELINE_TYPE_OPTIONS.map((opt) => (
          <label
            className="flex items-center gap-1 text-xs cursor-pointer"
            key={opt.value}
          >
            <input
              checked={selected.includes(opt.value)}
              className="cursor-pointer"
              onChange={() => toggle(opt.value)}
              type="checkbox"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}
