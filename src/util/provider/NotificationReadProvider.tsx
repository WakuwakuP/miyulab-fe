'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import toast from 'react-hot-toast'
import type { App } from 'types/types'
import {
  type NotificationReadTask,
  runNotificationReadTask,
  supportsNotificationRead,
  syncNotificationReadState,
} from 'util/notificationReadService'
import { AppsContext } from './AppsProvider'
import { StartupCoordinatorContext } from './StartupCoordinator'

export const NotificationReadContext = createContext({
  available: false,
  isRunning: false,
  markAllRead: () => {},
  sync: (_app: App) => {},
})

export function NotificationReadProvider({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const apps = useContext(AppsContext)
  const { isPhaseReached } = useContext(StartupCoordinatorContext)
  const ready = isPhaseReached('rest-fetched')
  const appsRef = useRef(apps)
  appsRef.current = apps
  const running = useRef(false)
  const syncs = useRef(new Set<App>())
  const [isRunning, setIsRunning] = useState(false)

  const isCurrent = useCallback(
    (app: App) =>
      appsRef.current.some(
        (current) =>
          current.backendUrl === app.backendUrl &&
          current.backend === app.backend &&
          current.tokenData?.access_token === app.tokenData?.access_token,
      ),
    [],
  )

  const sync = useCallback(
    (app: App) => {
      if (running.current || syncs.current.has(app) || !isCurrent(app)) return
      syncs.current.add(app)
      const requestApp = {
        ...app,
        tokenData: app.tokenData ? { ...app.tokenData } : null,
      }
      void syncNotificationReadState(requestApp, () => isCurrent(requestApp))
        .catch(() => console.warn('通知の既読状態を同期できませんでした'))
        .finally(() => syncs.current.delete(app))
    },
    [isCurrent],
  )

  useEffect(() => {
    if (!ready) return
    apps.forEach(sync)
    const onVisible = () => {
      if (document.visibilityState === 'visible') appsRef.current.forEach(sync)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [apps, ready, sync])

  const run = useCallback(
    async (tasks: NotificationReadTask[], unsupported: number) => {
      if (running.current || tasks.length === 0) return
      running.current = true
      setIsRunning(true)
      try {
        const results = await Promise.allSettled(
          tasks.map((task) =>
            runNotificationReadTask(task, () => isCurrent(task.app)),
          ),
        )
        const failed = tasks.filter(
          (_, index) => results[index].status === 'rejected',
        )
        const descriptions = results.flatMap((result, index) =>
          result.status === 'rejected'
            ? [
                `${tasks[index].app.backendUrl}: ${result.reason instanceof Error ? result.reason.message : '既読操作に失敗しました'}`,
              ]
            : [],
        )
        const unsupportedText =
          unsupported > 0 ? `（非対応 ${unsupported}件）` : ''
        if (failed.length === 0)
          toast.success(`通知をすべて既読にしました${unsupportedText}`)
        else
          toast(
            (notification) => (
              <div aria-live="polite" className="max-w-sm text-sm">
                <p>
                  完了 {tasks.length - failed.length}件・失敗 {failed.length}件
                  {unsupportedText}
                </p>
                {descriptions.map((description) => (
                  <p className="break-all" key={description}>
                    {description}
                  </p>
                ))}
                <button
                  className="mt-2 min-h-[44px] rounded border px-3"
                  onClick={() => {
                    toast.dismiss(notification.id)
                    void run(failed, unsupported)
                  }}
                  type="button"
                >
                  再試行
                </button>
              </div>
            ),
            { duration: Infinity },
          )
      } finally {
        running.current = false
        setIsRunning(false)
      }
    },
    [isCurrent],
  )

  const markAllRead = useCallback(() => {
    const authenticated = appsRef.current.filter(
      (app) => app.tokenData?.access_token,
    )
    const unique = [
      ...new Map(
        authenticated.map((app) => [
          `${app.backendUrl}:${app.tokenData?.access_token}`,
          app,
        ]),
      ).values(),
    ]
    const supported = unique.filter(supportsNotificationRead)
    void run(
      supported.map((app) => ({
        app: { ...app, tokenData: app.tokenData ? { ...app.tokenData } : null },
        stage: 'write',
      })),
      unique.length - supported.length,
    )
  }, [run])

  const value = useMemo(
    () => ({
      available:
        ready &&
        apps.some(
          (app) => app.tokenData?.access_token && supportsNotificationRead(app),
        ),
      isRunning,
      markAllRead,
      sync,
    }),
    [apps, isRunning, markAllRead, ready, sync],
  )

  return (
    <NotificationReadContext.Provider value={value}>
      {children}
    </NotificationReadContext.Provider>
  )
}
