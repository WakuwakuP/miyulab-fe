'use client'

import { DetailPanel } from 'app/_components/DetailPanel'
import { DynamicTimeline } from 'app/_components/DynamicTimeline'
import { MainPanel } from 'app/_components/MainPanel'
import { MediaModal } from 'app/_components/MediaModal'
import { useContext } from 'react'
import { TimelineContext } from 'util/provider/TimelineProvider'

import { Player } from './_components/Player'

export default function Home() {
  const timelineSettings = useContext(TimelineContext)

  // Sort timelines by order and filter visible ones
  const visibleTimelines = timelineSettings.timelines
    .filter((timeline) => timeline.visible)
    .sort((a, b) => a.order - b.order)

  return (
    <main className="flex overflow-y-visible overflow-x-scroll *:w-[calc(100vw/6)] *:min-w-60 *:shrink-0">
      <MainPanel />
      {visibleTimelines.map((timelineConfig) => (
        <DynamicTimeline config={timelineConfig} key={timelineConfig.id} />
      ))}
      <DetailPanel />
      <MediaModal />
      <Player />
    </main>
  )
}
