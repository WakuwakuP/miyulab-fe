'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useFilteredTimeline } from 'util/hooks/useFilteredTimeline'
import { useNotifications } from 'util/hooks/useNotifications'
import { AppsContext } from './AppsProvider'
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
 * ※ SetActionsContext は既存APIとの互換性のため appIndex を受け取るが、
 *    内部では apps[appIndex].backendUrl に変換して StatusStoreActions に委譲する。
 */
export const HomeTimelineProvider = ({ children }: { children: ReactNode }) => {
  const apps = useContext(AppsContext)
  const storeActions = useContext(StatusStoreActionsContext)

  // useFilteredTimeline用の安定した設定オブジェクト
  const homeConfig = useMemo<TimelineConfigV2>(
    () => ({ id: '__legacy_home', order: 0, type: 'home', visible: true }),
    [],
  )

  // IndexedDBからリアクティブにデータ取得（2-phase query）
  const { data: homeTimeline } = useFilteredTimeline(homeConfig)
  const { data: notifications } = useNotifications()

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
    <HomeTimelineContext.Provider value={homeTimeline}>
      <NotificationsContext.Provider value={notifications}>
        <SetActionsContext.Provider value={setActionsValue}>
          {children}
        </SetActionsContext.Provider>
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
