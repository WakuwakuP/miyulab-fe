'use client'

import { useContext } from 'react'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { NotificationsContext } from 'util/provider/HomeTimelineProvider'

export const NotificationTimeline = () => {
  const notifications = useContext(NotificationsContext)

  return (
    <Panel name="Notification">
      {notifications.map((notification) => (
        <Notification
          key={notification.id}
          notification={notification}
        />
      ))}
    </Panel>
  )
}
