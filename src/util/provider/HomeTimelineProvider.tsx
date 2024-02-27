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
import { TokenContext } from 'util/provider/AppProvider'
import { SetUsersContext } from 'util/provider/ResourceProvider'

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
  const setUsers = useContext(SetUsersContext)
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
      setUsers((prev) =>
        [
          ...prev,
          ...res.data
            .map((status) =>
              status.reblog != null
                ? status.reblog.account
                : status.account
            )
            .map((account) => {
              return {
                id: account.id,
                acct: account.acct,
                avatar: account.avatar,
                display_name: account.display_name,
              }
            }),
        ].filter(
          (element, index, self) =>
            self.findIndex(
              (e) => e.acct === element.acct
            ) === index
        )
      )
      setTimeline(res.data)
    })

    client.getNotifications({ limit: 40 }).then((res) => {
      setNotifications(res.data)

      const accounts = res.data
        .map((notification) => {
          if (notification.account == null) return null
          return {
            id: notification.account.id,
            acct: notification.account.acct,
            avatar: notification.account.avatar,
            display_name: notification.account.display_name,
          } as Pick<
            Entity.Account,
            'id' | 'acct' | 'avatar' | 'display_name'
          >
        })
        .filter((account) => account != null) as Pick<
        Entity.Account,
        'id' | 'acct' | 'avatar' | 'display_name'
      >[]

      setUsers((prev) =>
        [...prev, ...accounts].filter(
          (element, index, self) =>
            self.findIndex(
              (e) => e.acct === element.acct
            ) === index
        )
      )
    })

    const stream = streamClient.userSocket()

    stream.on('update', (status: Entity.Status) => {
      setUsers((prev) =>
        [
          ...prev,
          status.reblog != null
            ? status.reblog.account
            : status.account,
        ]
          .filter(
            (element, index, self) =>
              self.findIndex(
                (e) => e.acct === element.acct
              ) === index
          )
          .map((account) => {
            return {
              id: account.id,
              acct: account.acct,
              avatar: account.avatar,
              display_name: account.display_name,
            }
          })
      )
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
        if (notification.account == null) return

        const account = {
          id: notification.account.id,
          acct: notification.account.acct,
          avatar: notification.account.avatar,
          display_name: notification.account.display_name,
        } as Pick<
          Entity.Account,
          'id' | 'acct' | 'avatar' | 'display_name'
        >

        setUsers((prev) =>
          [...prev, account].filter(
            (element, index, self) =>
              self.findIndex(
                (e) => e.acct === element.acct
              ) === index
          )
        )
      }
    )

    stream.on('delete', (id: string) => {
      setTimeline((prev) =>
        prev.filter((status) => status.id !== id)
      )
    })

    stream.on('error', (err: Error) => {
      console.error(err)

      stream.stop()
      setTimeout(() => {
        stream.start()
      }, 1000)
    })

    stream.on('connect', () => {
      // eslint-disable-next-line no-console
      console.info('connected userSocket')
    })
  }, [setUsers, token])

  return (
    <HomeTimelineContext.Provider value={timeline}>
      <NotificationsContext.Provider value={notifications}>
        {children}
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
