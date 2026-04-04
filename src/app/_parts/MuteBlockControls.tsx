'use client'

import type { TimelineConfigV2 } from 'types/types'

export function MuteBlockControls({
  config,
  onChange,
  onOpenBlockManager,
  onOpenMuteManager,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
  onOpenBlockManager: () => void
  onOpenMuteManager: () => void
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          checked={config.applyMuteFilter ?? true}
          className="cursor-pointer"
          onChange={(e) => onChange({ applyMuteFilter: e.target.checked })}
          type="checkbox"
        />
        Apply Mute Filter
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          checked={config.applyInstanceBlock ?? true}
          className="cursor-pointer"
          onChange={(e) => onChange({ applyInstanceBlock: e.target.checked })}
          type="checkbox"
        />
        Apply Instance Block
      </label>
      <div className="flex gap-2">
        <button
          className="rounded border border-slate-600 px-3 py-1 text-xs hover:bg-slate-700"
          onClick={onOpenMuteManager}
          type="button"
        >
          Manage Mutes
        </button>
        <button
          className="rounded border border-slate-600 px-3 py-1 text-xs hover:bg-slate-700"
          onClick={onOpenBlockManager}
          type="button"
        >
          Manage Blocks
        </button>
      </div>
    </div>
  )
}
