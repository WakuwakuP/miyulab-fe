'use client'

import { Checkbox } from 'components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { useCallback } from 'react'
import type { AerialReplyFilter } from 'util/db/query-ir/nodes'

const NOTIFICATION_TYPES_FOR_AERIAL = [
  { key: 'favourite', label: 'ふぁぼ' },
  { key: 'emoji_reaction', label: 'リアクション' },
  { key: 'reblog', label: 'ブースト' },
  { key: 'mention', label: 'メンション' },
]

const TIME_WINDOW_OPTIONS = [
  { label: '1分', value: 60000 },
  { label: '3分', value: 180000 },
  { label: '5分', value: 300000 },
  { label: '10分', value: 600000 },
]

export function AerialReplyBody({
  node,
  onUpdate,
}: {
  node: AerialReplyFilter
  onUpdate: (n: AerialReplyFilter) => void
}) {
  const toggleType = useCallback(
    (key: string) => {
      const types = new Set(node.notificationTypes)
      if (types.has(key)) {
        types.delete(key)
      } else {
        types.add(key)
      }
      if (types.size > 0) {
        onUpdate({ ...node, notificationTypes: [...types] })
      }
    },
    [node, onUpdate],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_TYPES_FOR_AERIAL.map(({ key, label }) => (
          <span
            className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
            key={key}
            onClick={() => toggleType(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') toggleType(key)
            }}
          >
            <Checkbox
              checked={node.notificationTypes.includes(key)}
              onCheckedChange={() => toggleType(key)}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">時間窓:</span>
        <Select
          onValueChange={(v) => onUpdate({ ...node, timeWindowMs: Number(v) })}
          value={String(node.timeWindowMs)}
        >
          <SelectTrigger className="h-7 w-20 text-xs bg-gray-800 border-gray-600">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_WINDOW_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
