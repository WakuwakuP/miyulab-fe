'use client'

import { useContext } from 'react'

import { DetailPanel } from 'app/_components/DetailPanel'
import { DynamicTimeline } from 'app/_components/DynamicTimeline'
import { GettingStarted } from 'app/_components/GettingStarted'
import { MainPanel } from 'app/_components/MainPanel'
import { MediaModal } from 'app/_components/MediaModal'
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
      <GettingStarted />
      <MainPanel />
      {visibleTimelines.map((timelineConfig) => (
        <DynamicTimeline
          key={timelineConfig.id}
          config={timelineConfig}
        />
      ))}
      <DetailPanel />
      <MediaModal />
      <Player />
    </main>
  )
}
