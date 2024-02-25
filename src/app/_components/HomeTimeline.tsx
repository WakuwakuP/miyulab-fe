'use client'

import { useContext } from 'react'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'

export const HomeTimeline = () => {
  const timeline = useContext(HomeTimelineContext)

  return (
    <Panel name="Home">
      {timeline.map((status) => (
        <Status
          key={status.id}
          status={status}
        />
      ))}
    </Panel>
  )
}
