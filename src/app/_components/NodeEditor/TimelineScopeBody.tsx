'use client'

import { Checkbox } from 'components/ui/checkbox'
import { useCallback, useId } from 'react'
import type { TimelineScope } from 'util/db/query-ir/nodes'

const TIMELINE_KEYS = [
  { key: 'home', label: 'ホーム' },
  { key: 'local', label: 'ローカル' },
  { key: 'public', label: '連合' },
  { key: 'bubble', label: 'バブル' },
]

export function TimelineScopeBody({
  node,
  onUpdate,
}: {
  node: TimelineScope
  onUpdate: (n: TimelineScope) => void
}) {
  const idPrefix = useId()
  const toggle = useCallback(
    (key: string) => {
      const keys = new Set(node.timelineKeys)
      if (keys.has(key)) {
        keys.delete(key)
      } else {
        keys.add(key)
      }
      if (keys.size > 0) {
        onUpdate({ ...node, timelineKeys: [...keys] })
      }
    },
    [node, onUpdate],
  )

  return (
    <div className="flex flex-wrap gap-2">
      {TIMELINE_KEYS.map(({ key, label }) => (
        <div
          className="flex items-center gap-1.5 text-xs text-gray-300"
          key={key}
        >
          <Checkbox
            checked={node.timelineKeys.includes(key)}
            id={`${idPrefix}-timeline-scope-${key}`}
            onCheckedChange={() => toggle(key)}
          />
          <label
            className="cursor-pointer"
            htmlFor={`${idPrefix}-timeline-scope-${key}`}
          >
            {label}
          </label>
        </div>
      ))}
    </div>
  )
}
