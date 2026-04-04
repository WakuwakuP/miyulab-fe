'use client'

import type { TimelineConfigV2 } from 'types/types'

const TOGGLE_FILTERS: {
  description: string
  key: keyof Pick<
    TimelineConfigV2,
    'excludeReblogs' | 'excludeReplies' | 'excludeSensitive' | 'excludeSpoiler'
  >
  label: string
}[] = [
  {
    description: 'Hide boosted posts',
    key: 'excludeReblogs',
    label: 'Exclude Reblogs',
  },
  {
    description: 'Show only top-level posts',
    key: 'excludeReplies',
    label: 'Exclude Replies',
  },
  {
    description: 'Hide posts with Content Warning',
    key: 'excludeSpoiler',
    label: 'Exclude CW',
  },
  {
    description: 'Hide sensitive posts',
    key: 'excludeSensitive',
    label: 'Exclude Sensitive',
  },
]

export function ToggleFilters({
  config,
  onChange,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}) {
  return (
    <div className="space-y-1">
      {TOGGLE_FILTERS.map((filter) => (
        <label
          className="flex items-center justify-between gap-2 text-xs cursor-pointer"
          key={filter.key}
        >
          <div>
            <span>{filter.label}</span>
            <span className="ml-2 text-gray-500">{filter.description}</span>
          </div>
          <input
            checked={config[filter.key] ?? false}
            className="cursor-pointer"
            onChange={(e) => onChange({ [filter.key]: e.target.checked })}
            type="checkbox"
          />
        </label>
      ))}
    </div>
  )
}
