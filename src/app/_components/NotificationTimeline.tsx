'use client'

import { useContext, useRef } from 'react'

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { NotificationsContext } from 'util/provider/HomeTimelineProvider'

export const NotificationTimeline = () => {
  const notifications = useContext(NotificationsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)

  const scrollToTop = () => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        index: 0,
        behavior: 'smooth',
      })
    }
  }

  return (
    <Panel
      name="Notification"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      <Virtuoso
        data={notifications}
        ref={scrollerRef}
        itemContent={(_, notification) => (
          <Notification
            key={notification.id}
            notification={notification}
          />
        )}
      />
    </Panel>
  )
}
