'use client'

import { DynamicTimeline } from 'app/_components/DynamicTimeline'
import { useCallback, useState } from 'react'
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

  const handleTabClick = useCallback((index: number) => {
    setActiveIndex(index)
  }, [])

  // activeIndex が範囲外になった場合の安全策
  const safeIndex = activeIndex < configs.length ? activeIndex : 0
  const activeConfig = configs[safeIndex]

  if (configs.length === 0 || !activeConfig) {
    return null
  }

  return (
    <section>
      {/* タブヘッダー */}
      <div className="flex bg-slate-800 overflow-x-auto h-8 items-end">
        {configs.map((config, index) => {
          const displayName = config.label || getDefaultTimelineName(config)
          const isActive = index === safeIndex
          return (
            <button
              className={`px-3 py-1 text-sm whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
              key={config.id}
              onClick={() => handleTabClick(index)}
              type="button"
            >
              {displayName}
            </button>
          )
        })}
      </div>
      {/* アクティブなタイムライン */}
      <DynamicTimeline
        config={activeConfig}
        headerOffset="2rem"
        key={activeConfig.id}
      />
    </section>
  )
}
