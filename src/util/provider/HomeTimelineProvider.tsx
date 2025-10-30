'use client'

import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { type Entity } from 'megalodon'

import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { GetClient } from 'util/GetClient'
import {
  SetTagsContext,
  SetUsersContext,
} from 'util/provider/ResourceProvider'
import { usePageLifecycle } from 'util/usePageLifecycle'

import { AppsContext } from './AppsProvider'

type StatusAddAppIndex = Entity.Status & {
  appIndex: number
}

type NotificationAddAppIndex = Entity.Notification & {
  appIndex: number
}

export const HomeTimelineContext = createContext<
  StatusAddAppIndex[]
>([])

export const NotificationsContext = createContext<
  NotificationAddAppIndex[]
>([])

type SetActions = {
  setReblogged: (
    appIndex: number,
    statusId: string,
    reblogged: boolean
  ) => void
  setFavourited: (
    appIndex: number,
    statusId: string,
    favourited: boolean
  ) => void
  setBookmarked: (
    appIndex: number,
    statusId: string,
    bookmarked: boolean
  ) => void
}

export const SetActionsContext = createContext<SetActions>({
  setReblogged: () => {},
  setFavourited: () => {},
  setBookmarked: () => {},
})

export const HomeTimelineProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const refFirstRef = useRef(true)
  const apps = useContext(AppsContext)
  const setUsers = useContext(SetUsersContext)
  const setTags = useContext(SetTagsContext)
  const isVisible = usePageLifecycle()
  const streamsRef = useRef<{
    [key: string]: Awaited<
      ReturnType<
        ReturnType<typeof GetClient>['userStreaming']
      >
    >
  }>({})

  const [timelines, setTimelines] = useState<{
    [key: string]: StatusAddAppIndex[]
  }>({})

  const [notifications, setNotifications] = useState<{
    [key: string]: NotificationAddAppIndex[]
  }>({})

  const margeTimeline = useMemo(() => {
    if (Object.values(timelines).length !== apps.length) {
      return []
    }
    return Object.values(timelines)
      .reduce((prev, current) => [...prev, ...current], [])
      .sort((a, b) => {
        return (
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
        )
      })
  }, [apps.length, timelines])

  const margeNotifications = useMemo(() => {
    if (
      Object.values(notifications).length !== apps.length
    ) {
      return []
    }

    return Object.values(notifications)
      .reduce((prev, current) => [...prev, ...current], [])
      .sort((a, b) => {
        return (
          new Date(b.created_at).getTime() -
          new Date(a.created_at).getTime()
        )
      })
  }, [apps.length, notifications])

  const setReblogged = (
    appIndex: number,
    statusId: string,
    reblogged: boolean
  ) => {
    setTimelines((prev) => {
      prev[apps[appIndex].backendUrl].forEach((status) => {
        if (status.id === statusId) {
          status.reblogged = reblogged
        }
        if (
          status.reblog != null &&
          status.reblog.id === statusId
        ) {
          status.reblog.reblogged = reblogged
        }
      })
      return prev
    })

    setNotifications((prev) => {
      prev[apps[appIndex].backendUrl].forEach(
        (notification) => {
          if (notification.status?.id === statusId) {
            notification.status.reblogged = reblogged
          }
        }
      )
      return prev
    })
  }

  const setFavourited = (
    appIndex: number,
    statusId: string,
    favourited: boolean
  ) => {
    setTimelines((prev) => {
      prev[apps[appIndex].backendUrl].forEach((status) => {
        if (status.id === statusId) {
          status.favourited = favourited
        }
        if (
          status.reblog != null &&
          status.reblog.id === statusId
        ) {
          status.reblog.favourited = favourited
        }
      })
      return prev
    })

    setNotifications((prev) => {
      prev[apps[appIndex].backendUrl].forEach(
        (notification) => {
          if (notification.status?.id === statusId) {
            notification.status.favourited = favourited
          }
        }
      )
      return prev
    })
  }

  const setBookmarked = (
    appIndex: number,
    statusId: string,
    bookmarked: boolean
  ) => {
    setTimelines((prev) => {
      prev[apps[appIndex].backendUrl].forEach((status) => {
        if (status.id === statusId) {
          status.bookmarked = bookmarked
        }
        if (
          status.reblog != null &&
          status.reblog.id === statusId
        ) {
          status.reblog.bookmarked = bookmarked
        }
      })
      return prev
    })

    setNotifications((prev) => {
      prev[apps[appIndex].backendUrl].forEach(
        (notification) => {
          if (notification.status?.id === statusId) {
            notification.status.bookmarked = bookmarked
          }
        }
      )
      return prev
    })
  }

  useEffect(() => {
    if (
      process.env.NODE_ENV === 'development' &&
      refFirstRef.current
    ) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    apps.forEach((app, index) => {
      const client = GetClient(app)
      const getHome = client
        .getHomeTimeline({ limit: 40 })
        .then((res) => {
          setUsers((prev) =>
            [
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
              ...prev,
            ].filter(
              (element, index, self) =>
                self.findIndex(
                  (e) => e.acct === element.acct
                ) === index
            )
          )
          setTimelines((prev) => {
            return {
              ...prev,
              [app.backendUrl]: res.data.map((status) => ({
                ...status,
                appIndex: index,
              })),
            }
          })
        })

      const getNotifications = client
        .getNotifications({ limit: 40 })
        .then((res) => {
          setNotifications((prev) => {
            return {
              ...prev,
              [app.backendUrl]: res.data.map(
                (notification) => ({
                  ...notification,
                  appIndex: index,
                })
              ),
            }
          })

          const accounts = res.data
            .map((notification) => {
              if (notification.account == null) return null
              return {
                id: notification.account.id,
                acct: notification.account.acct,
                avatar: notification.account.avatar,
                display_name:
                  notification.account.display_name,
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

      Promise.all([getHome, getNotifications]).then(() => {
        client.userStreaming().then((stream) => {
          // Store stream reference for lifecycle management
          streamsRef.current[app.backendUrl] = stream

          // If page is hidden when stream is created, stop it immediately
          if (!isVisible) {
            stream.stop()
          }

          stream.on('update', (status: Entity.Status) => {
            setTags((prev) =>
              Array.from(
                new Set([
                  ...prev,
                  ...status.tags.map((tag) => tag.name),
                ])
              )
            )
            setUsers((prev) =>
              [
                status.reblog != null
                  ? status.reblog.account
                  : status.account,
                ...prev,
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
            const statusWithBackendUrl = {
              ...status,
              appIndex: index,
            }
            setTimelines((prev) => {
              const index = prev[app.backendUrl].findIndex(
                (s) => s.id == statusWithBackendUrl.id
              )
              // 同一IDのStatusが存在する場合は更新
              if (index === -1) {
                return {
                  ...prev,
                  [app.backendUrl]: ArrayLengthControl([
                    statusWithBackendUrl,
                    ...prev[app.backendUrl],
                  ]),
                }
              }
              const next = [...prev[app.backendUrl]]
              next[index] = statusWithBackendUrl
              return {
                ...prev,
                [app.backendUrl]: next,
              }
            })
          })

          stream.on(
            'status_update',
            (status: Entity.Status) => {
              const statusWithBackendUrl = {
                ...status,
                appIndex: index,
              }
              setTimelines((prev) => {
                const index = prev[
                  app.backendUrl
                ].findIndex(
                  (prevStatus) =>
                    prevStatus.id ===
                    statusWithBackendUrl.id
                )
                if (index === -1) {
                  return {
                    ...prev,
                    [app.backendUrl]: ArrayLengthControl([
                      statusWithBackendUrl,
                      ...prev[app.backendUrl],
                    ]),
                  }
                }
                const next = [...prev[app.backendUrl]]
                next[index] = statusWithBackendUrl
                return {
                  ...prev,
                  [app.backendUrl]: next,
                }
              })
            }
          )

          stream.on(
            'notification',
            (notification: Entity.Notification) => {
              setNotifications((prev) => {
                const newNotification = {
                  ...notification,
                  appIndex: index,
                }
                return {
                  ...prev,
                  [app.backendUrl]: ArrayLengthControl([
                    newNotification,
                    ...prev[app.backendUrl],
                  ]),
                }
              })
              if (notification.account == null) return

              const account = {
                id: notification.account.id,
                acct: notification.account.acct,
                avatar: notification.account.avatar,
                display_name:
                  notification.account.display_name,
              } as Pick<
                Entity.Account,
                'id' | 'acct' | 'avatar' | 'display_name'
              >

              setUsers((prev) =>
                [account, ...prev].filter(
                  (element, index, self) =>
                    self.findIndex(
                      (e) => e.acct === element.acct
                    ) === index
                )
              )
            }
          )

          stream.on('delete', (id: string) => {
            setTimelines((prev) => {
              return {
                ...prev,
                [app.backendUrl]: prev[
                  app.backendUrl
                ].filter((status) => status.id !== id),
              }
            })
          })

          stream.on('error', (err: Error) => {
            console.error(err)

            stream.stop()
            const timeout = setTimeout(() => {
              stream.start()
              // eslint-disable-next-line no-console
              console.info('reconnected userSocket')
              clearTimeout(timeout)
            }, 1000)
          })

          stream.on('connect', () => {
            // eslint-disable-next-line no-console
            console.info('connected userStreaming')
          })
        })
      })
    })
    // isVisible is intentionally not in deps - we only check it once when stream is created
    // to determine initial state. Visibility changes are handled by separate useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, setTags, setUsers])

  // Handle page visibility changes using Page Lifecycle API
  useEffect(() => {
    const streams = Object.values(streamsRef.current)

    if (streams.length === 0) return

    if (isVisible) {
      // Resume all streams when page becomes visible
      streams.forEach((stream) => {
        stream.start()
      })
      // eslint-disable-next-line no-console
      console.info(
        'Resumed WebSocket streams (page visible)'
      )
    } else {
      // Pause all streams when page becomes hidden
      streams.forEach((stream) => {
        stream.stop()
      })
      // eslint-disable-next-line no-console
      console.info('Paused WebSocket streams (page hidden)')
    }
  }, [isVisible])

  return (
    <HomeTimelineContext.Provider value={margeTimeline}>
      <NotificationsContext.Provider
        value={margeNotifications}
      >
        <SetActionsContext.Provider
          value={{
            setReblogged,
            setFavourited,
            setBookmarked,
          }}
        >
          {children}
        </SetActionsContext.Provider>
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
