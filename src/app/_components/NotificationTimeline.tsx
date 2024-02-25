'use client'

import generator, { Entity } from 'megalodon'
import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { NotificationsContext } from 'util/provider/HomeTimelineProvider'
import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'

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
