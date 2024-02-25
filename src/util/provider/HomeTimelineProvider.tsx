'use client'

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import generator, { Entity } from 'megalodon'

import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { BACKEND_URL } from 'util/environment'

import { TokenContext } from './AppProvider'

export const HomeTimelineContext = createContext<
  Entity.Status[]
>([])

export const NotificationsContext = createContext<
  Entity.Notification[]
>([])

export const HomeTimelineProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const refFirstRef = useRef(true)
  const token = useContext(TokenContext)
  const [timeline, setTimeline] = useState<Entity.Status[]>(
    []
  )
  const [notifications, setNotifications] = useState<
    Entity.Notification[]
  >([])

  useEffect(() => {
    if (
      process.env.NODE_ENV === 'development' &&
      refFirstRef.current
    ) {
      refFirstRef.current = false
      return
    }
    if (token == null) return
    const client = generator(
      'pleroma',
      `https://${BACKEND_URL}`,
      token?.access_token
    )

    const streamClient = generator(
      'pleroma',
      `wss://${BACKEND_URL}`,
      token?.access_token
    )
    client.getHomeTimeline({ limit: 40 }).then((res) => {
      setTimeline(res.data)
    })

    client.getNotifications({ limit: 40 }).then((res) => {
      setNotifications(res.data)
    })

    const stream = streamClient.userSocket()

    stream.on('update', (status: Entity.Status) => {
      setTimeline((prev) =>
        ArrayLengthControl([status, ...prev])
      )
    })

    stream.on(
      'notification',
      (notification: Entity.Notification) => {
        setNotifications((prev) =>
          ArrayLengthControl([notification, ...prev])
        )
      }
    )
  }, [token])

  return (
    <HomeTimelineContext.Provider value={timeline}>
      <NotificationsContext.Provider value={notifications}>
        {children}
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
