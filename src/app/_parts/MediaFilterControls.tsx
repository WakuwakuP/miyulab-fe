'use client'

import type { TimelineConfigV2 } from 'types/types'

export function MediaFilterControls({
  config,
  onChange,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center space-x-2 cursor-pointer text-xs">
        <input
          checked={config.onlyMedia ?? false}
          className="cursor-pointer"
          onChange={(e) => onChange({ onlyMedia: e.target.checked })}
          type="checkbox"
        />
        <span>📷 Only Media</span>
      </label>
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor="minMediaCount">Min count:</label>
        <input
          className="w-16 rounded bg-gray-700 px-2 py-1 text-xs text-white"
          id="minMediaCount"
          max={20}
          min={0}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onChange({
              minMediaCount: Number.isNaN(val) || val <= 0 ? undefined : val,
            })
          }}
          placeholder="0"
          type="number"
          value={config.minMediaCount ?? ''}
        />
      </div>
    </div>
  )
}
