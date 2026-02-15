'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { NotificationAddAppIndex, StatusAddAppIndex } from 'types/types'
import { useNotifications } from 'util/hooks/useNotifications'
import { useTimeline } from 'util/hooks/useTimeline'
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

  // IndexedDBからリアクティブにデータ取得
  // appIndex は useTimeline / useNotifications 内で backendUrl から都度算出される
  const homeTimeline = useTimeline('home')
  const notifications = useNotifications()

  // 既存APIとの互換性を保つためのラッパー
  // appIndex → backendUrl への変換をここで行う
  const setReblogged = (
    appIndex: number,
    statusId: string,
    reblogged: boolean,
  ) => {
    const backendUrl = apps[appIndex]?.backendUrl
    if (backendUrl) {
      storeActions.setReblogged(backendUrl, statusId, reblogged)
    }
  }

  const setFavourited = (
    appIndex: number,
    statusId: string,
    favourited: boolean,
  ) => {
    const backendUrl = apps[appIndex]?.backendUrl
    if (backendUrl) {
      storeActions.setFavourited(backendUrl, statusId, favourited)
    }
  }

  const setBookmarked = (
    appIndex: number,
    statusId: string,
    bookmarked: boolean,
  ) => {
    const backendUrl = apps[appIndex]?.backendUrl
    if (backendUrl) {
      storeActions.setBookmarked(backendUrl, statusId, bookmarked)
    }
  }

  return (
    <HomeTimelineContext.Provider value={homeTimeline}>
      <NotificationsContext.Provider value={notifications}>
        <SetActionsContext.Provider
          value={{
            setBookmarked,
            setFavourited,
            setReblogged,
          }}
        >
          {children}
        </SetActionsContext.Provider>
      </NotificationsContext.Provider>
    </HomeTimelineContext.Provider>
  )
}
