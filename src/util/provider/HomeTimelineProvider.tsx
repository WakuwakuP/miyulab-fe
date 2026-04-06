'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { AppsContext } from './AppsProvider'
import { StartupCoordinatorContext } from './StartupCoordinator'
import { StatusStoreActionsContext } from './StatusStoreProvider'

// 既存のContext定義（後方互換性）
export const HomeTimelineContext = createContext<StatusAddAppIndex[]>([])

export const NotificationsContext = createContext<NotificationAddAppIndex[]>([])

// SetActionsContextは既存のまま維持（互換性）
type SetActions = {
  setReblogged: (appIndex: number, statusId: string, reblogged: boolean) => void
  setFavourited: (
    appIndex: number,
    statusId: string,
    favourited: boolean,
  ) => void
  setBookmarked: (
    appIndex: number,
    statusId: string,
    bookmarked: boolean,
  ) => void
}

export const SetActionsContext = createContext<SetActions>({
  setBookmarked: () => {},
  setFavourited: () => {},
  setReblogged: () => {},
})

/**
 * 改修後のHomeTimelineProvider
 * IndexedDBベースのデータを提供
 *
 * Phase 2 ゲート: db-ready になるまでデータ取得を無効化。
 * 初回データ取得成功時に advanceTo('timeline-displayed') を呼ぶ。
 *
 * ※ SetActionsContext は既存APIとの互換性のため appIndex を受け取るが、
 *    内部では apps[appIndex].backendUrl に変換して StatusStoreActions に委譲する。
 */
export const HomeTimelineProvider = ({ children }: { children: ReactNode }) => {
  const apps = useContext(AppsContext)
  const storeActions = useContext(StatusStoreActionsContext)
  const { isPhaseReached, advanceTo } = useContext(StartupCoordinatorContext)

  const dbReady = isPhaseReached('db-ready')

  // home と notification の両方の初回フェッチ完了を追跡
  const homeReadyRef = useRef(false)
  const notifReadyRef = useRef(false)
  const advancedRef = useRef(false)

  const maybeAdvance = useCallback(() => {
    if (!advancedRef.current && homeReadyRef.current && notifReadyRef.current) {
      advancedRef.current = true
      advanceTo('timeline-displayed')
    }
  }, [advanceTo])

  const onHomeFirstFetch = useCallback(() => {
    homeReadyRef.current = true
    maybeAdvance()
  }, [maybeAdvance])

  const onNotifFirstFetch = useCallback(() => {
    notifReadyRef.current = true
    maybeAdvance()
  }, [maybeAdvance])

  // useTimelineData用の安定した設定オブジェクト
  const homeConfig = useMemo<TimelineConfigV2>(
    () => ({ id: '__legacy_home', order: 0, type: 'home', visible: true }),
    [],
  )

  const notifConfig = useMemo<TimelineConfigV2>(
    () => ({
      id: '__legacy_notifications',
      order: 0,
      type: 'notification',
      visible: true,
    }),
    [],
  )

  // グラフ実行エンジン経由でデータ取得
  // db-ready になるまで disabled で遅延
  const { data: homeTimeline } = useTimelineData(homeConfig, {
    disabled: !dbReady,
    onFirstFetch: onHomeFirstFetch,
  })
  const { data: notifications } = useTimelineData(notifConfig, {
    disabled: !dbReady,
    onFirstFetch: onNotifFirstFetch,
  })

  // 既存APIとの互換性を保つためのラッパー
  // appIndex → backendUrl への変換をここで行う
  const setReblogged = useCallback(
    (appIndex: number, statusId: string, reblogged: boolean) => {
      const backendUrl = apps[appIndex]?.backendUrl
      if (backendUrl) {
        storeActions.setReblogged(backendUrl, statusId, reblogged)
      }
    },
    [apps, storeActions],
  )

  const setFavourited = useCallback(
    (appIndex: number, statusId: string, favourited: boolean) => {
      const backendUrl = apps[appIndex]?.backendUrl
      if (backendUrl) {
        storeActions.setFavourited(backendUrl, statusId, favourited)
      }
    },
    [apps, storeActions],
  )

  const setBookmarked = useCallback(
    (appIndex: number, statusId: string, bookmarked: boolean) => {
      const backendUrl = apps[appIndex]?.backendUrl
      if (backendUrl) {
        storeActions.setBookmarked(backendUrl, statusId, bookmarked)
      }
    },
    [apps, storeActions],
  )

  const setActionsValue = useMemo(
    () => ({ setBookmarked, setFavourited, setReblogged }),
    [setBookmarked, setFavourited, setReblogged],
  )

  return (
    <HomeTimelineContext.Provider value={homeTimeline as StatusAddAppIndex[]}>
      <NotificationsContext.Provider
        value={notifications as NotificationAddAppIndex[]}
      >
        <SetActionsContext.Provider value={setActionsValue}>
          {children}
        </SetActionsContext.Provider>
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
