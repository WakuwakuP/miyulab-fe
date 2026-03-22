'use client'

import { DetailPanel } from 'app/_components/DetailPanel'
import { DynamicTimeline } from 'app/_components/DynamicTimeline'
import { InitialProgressBar } from 'app/_components/InitialProgressBar'
import { MainPanel } from 'app/_components/MainPanel'
import { MediaModal } from 'app/_components/MediaModal'
import { TabbedTimeline } from 'app/_components/TabbedTimeline'
import { useContext, useMemo } from 'react'
import type { TimelineConfigV2 } from 'types/types'
import { TimelineContext } from 'util/provider/TimelineProvider'

import { Player } from './_components/Player'

/**
 * 表示可能なタイムラインをカラム単位にグループ化する。
 *
 * - tabGroup が未設定のタイムラインは単独カラムとして扱う
 * - 同じ tabGroup を持つタイムラインは1つのカラムにまとめる
 * - グループ内の順序は order 順を維持する
 * - グループの表示位置はグループ内の最小 order で決定する
 */
function groupTimelines(
  timelines: TimelineConfigV2[],
): (
  | { type: 'single'; config: TimelineConfigV2 }
  | { type: 'tabbed'; configs: TimelineConfigV2[]; groupKey: string }
)[] {
  const result: (
    | { type: 'single'; config: TimelineConfigV2; sortOrder: number }
    | {
        type: 'tabbed'
        configs: TimelineConfigV2[]
        groupKey: string
        sortOrder: number
      }
  )[] = []
  const groupMap = new Map<string, TimelineConfigV2[]>()

  for (const tl of timelines) {
    if (tl.tabGroup) {
      const existing = groupMap.get(tl.tabGroup)
      if (existing) {
        existing.push(tl)
      } else {
        groupMap.set(tl.tabGroup, [tl])
      }
    } else {
      result.push({ config: tl, sortOrder: tl.order, type: 'single' })
    }
  }

  for (const [groupKey, configs] of groupMap) {
    const sortedConfigs = [...configs].sort((a, b) => a.order - b.order)
    const sortOrder =
      sortedConfigs.length > 0
        ? sortedConfigs[0].order
        : Number.POSITIVE_INFINITY
    result.push({ configs: sortedConfigs, groupKey, sortOrder, type: 'tabbed' })
  }

  result.sort((a, b) => a.sortOrder - b.sortOrder)

  return result.map((item) => {
    if (item.type === 'single') {
      return { config: item.config, type: 'single' as const }
    }
    return {
      configs: item.configs,
      groupKey: item.groupKey,
      type: 'tabbed' as const,
    }
  })
}

export default function Home() {
  const timelineSettings = useContext(TimelineContext)

  // Sort timelines by order and filter visible ones
  const visibleTimelines = useMemo(
    () =>
      timelineSettings.timelines
        .filter((timeline) => timeline.visible)
        .sort((a, b) => a.order - b.order),
    [timelineSettings.timelines],
  )

  const columns = useMemo(
    () => groupTimelines(visibleTimelines),
    [visibleTimelines],
  )

  return (
    <main className="flex overflow-y-visible overflow-x-scroll *:w-[calc(100vw/6)] *:min-w-60 *:shrink-0">
      <InitialProgressBar />
      <MainPanel />
      {columns.map((column) => {
        if (column.type === 'single') {
          return (
            <DynamicTimeline config={column.config} key={column.config.id} />
          )
        }
        return <TabbedTimeline configs={column.configs} key={column.groupKey} />
      })}
      <DetailPanel />
      <MediaModal />
      <Player />
    </main>
  )
}
