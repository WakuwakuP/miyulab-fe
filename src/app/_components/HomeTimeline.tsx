'use client'

import { useContext, useRef } from 'react'

import { Virtuoso } from 'react-virtuoso'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'

export const HomeTimeline = () => {
  const timeline = useContext(HomeTimelineContext)
  const scrollerRef = useRef<HTMLElement | null>(null)

  const scrollToTop = () => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scroll({
        top: 0,
        behavior: 'smooth',
      })
    }
  }

  return (
    <Panel
      name="Home"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      <Virtuoso
        data={timeline}
        scrollerRef={(ref) => {
          scrollerRef.current = ref as HTMLElement
        }}
        itemContent={(_, status) => (
          <Status
            key={status.id}
            status={status}
          />
        )}
      />
    </Panel>
  )
}
