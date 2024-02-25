'use client'

import generator, { Entity } from 'megalodon'
import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Status } from 'app/_parts/Status'
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'
import { Panel } from 'app/_parts/Panel'

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
