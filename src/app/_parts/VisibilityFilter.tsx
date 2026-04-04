'use client'

import type { VisibilityType } from 'types/types'

const VISIBILITY_OPTIONS: { label: string; value: VisibilityType }[] = [
  { label: 'Public', value: 'public' },
  { label: 'Unlisted', value: 'unlisted' },
  { label: 'Private', value: 'private' },
  { label: 'Direct', value: 'direct' },
]

export function VisibilityFilter({
  onChange,
  value,
}: {
  onChange: (filter: VisibilityType[] | undefined) => void
  value: VisibilityType[] | undefined
}) {
  // 未設定 = 全て選択状態
  const selected: VisibilityType[] = value ?? [
    'public',
    'unlisted',
    'private',
    'direct',
  ]

  const toggle = (v: VisibilityType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 全て選択 or 全て未選択 → undefined（フィルタなし）
    if (next.length === 0 || next.length === 4) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Visibility</span>
      <div className="flex flex-wrap gap-2">
        {VISIBILITY_OPTIONS.map((opt) => (
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
