'use client'

import { useContext, useRef } from 'react'

import { Virtuoso } from 'react-virtuoso'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { NotificationsContext } from 'util/provider/HomeTimelineProvider'

export const NotificationTimeline = () => {
  const notifications = useContext(NotificationsContext)
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
      name="Notification"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      <Virtuoso
        data={notifications}
        scrollerRef={(ref) => {
          scrollerRef.current = ref as HTMLElement
        }}
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
