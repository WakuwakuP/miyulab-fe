'use client'

import { DynamicTimeline } from 'app/_components/DynamicTimeline'
import { useCallback, useRef, useState } from 'react'
import type { TimelineConfigV2 } from 'types/types'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/**
 * タブ付きタイムラインコンポーネント
 *
 * 同じ tabGroup を持つ複数のタイムラインをタブUIで切り替えて
 * 1つのカラム内に表示する。
 */
export const TabbedTimeline = ({
  configs,
}: {
  configs: TimelineConfigV2[]
}) => {
  const [activeIndex, setActiveIndex] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleTabClick = useCallback((index: number) => {
    setActiveIndex(index)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex: number | null = null
      if (e.key === 'ArrowRight') {
        nextIndex = (index + 1) % configs.length
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (index - 1 + configs.length) % configs.length
      }
      if (nextIndex != null) {
        e.preventDefault()
        setActiveIndex(nextIndex)
        tabRefs.current[nextIndex]?.focus()
      }
    },
    [configs.length],
  )

  // activeIndex が範囲外になった場合の安全策
  const safeIndex = activeIndex < configs.length ? activeIndex : 0
  const activeConfig = configs[safeIndex]

  if (configs.length === 0 || !activeConfig) {
    return null
  }

  const panelId = `tabpanel-${activeConfig.id}`

  return (
    <section>
      {/* タブヘッダー */}
      <div
        className="flex bg-slate-800 overflow-x-auto h-8 items-end"
        role="tablist"
      >
        {configs.map((config, index) => {
          const displayName = config.label || getDefaultTimelineName(config)
          const isActive = index === safeIndex
          return (
            <button
              aria-controls={isActive ? panelId : undefined}
              aria-selected={isActive}
              className={`px-3 py-1 text-sm whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
              key={config.id}
              onClick={() => handleTabClick(index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {displayName}
            </button>
          )
        })}
      </div>
      {/* アクティブなタイムライン */}
      <div id={panelId} role="tabpanel">
        <DynamicTimeline config={activeConfig} headerOffset="2rem" />
      </div>
    </section>
  )
}
