'use client'

import type { NotificationType } from 'types/types'

const NOTIFICATION_TYPE_OPTIONS: {
  label: string
  value: NotificationType
}[] = [
  { label: '👤 Follow', value: 'follow' },
  { label: '👤❓ Follow Request', value: 'follow_request' },
  { label: '💬 Mention', value: 'mention' },
  { label: '🔁 Reblog', value: 'reblog' },
  { label: '⭐ Favourite', value: 'favourite' },
  { label: '😀 Reaction', value: 'emoji_reaction' },
  { label: '📊 Poll Expired', value: 'poll_expired' },
  { label: '📝 Status', value: 'status' },
]

export function NotificationTypeFilter({
  onChange,
  value,
}: {
  onChange: (filter: NotificationType[] | undefined) => void
  value: NotificationType[] | undefined
}) {
  // 未設定 = 全てオフ状態（通知を取得しない）
  const selected: NotificationType[] = value ?? []

  const allTypes = NOTIFICATION_TYPE_OPTIONS.map((o) => o.value)

  const toggle = (v: NotificationType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 空配列 → undefined（通知なし）
    if (next.length === 0) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  const toggleAll = () => {
    if (selected.length === allTypes.length) {
      // 全選択 → 全解除
      onChange(undefined)
    } else {
      // 一部選択 or 全解除 → 全選択
      onChange([...allTypes])
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Notification Types</span>
        <button
          className="text-xs text-gray-500 hover:text-gray-300"
          onClick={toggleAll}
          type="button"
        >
          {selected.length === allTypes.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_TYPE_OPTIONS.map((opt) => (
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
