'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react'

import type { AccountAddAppIndex, StatusAddAppIndex } from 'types/types'
import {
  detailToPath,
  isDetailRoute,
  navigatePanel,
  parsePanelRoute,
  replacePanelUrl,
} from 'util/panelNavigation'

export type DetailType = 'Account' | 'Status' | 'SearchUser' | 'Hashtag' | null

export type SetDetailParams =
  | {
      type: 'Account'
      content: AccountAddAppIndex
    }
  | {
      type: 'Status'
      content: StatusAddAppIndex
    }
  | {
      type: 'SearchUser'
      content: string | undefined
      appIndex: number
    }
  | {
      type: 'Hashtag'
      content: string | undefined
    }
  | {
      type: null
      content: null
    }

export const DetailContext = createContext<SetDetailParams>({
  content: null,
  type: null,
})

export const SetDetailContext = createContext<
  Dispatch<SetStateAction<SetDetailParams>>
>(() => {})

export const DetailProvider = ({ children }: { children: ReactNode }) => {
  const [detail, setDetailRaw] = useState<SetDetailParams>({
    content: null,
    type: null,
  })

  // setDetail をラップし、URL も同時に更新する
  const setDetail: Dispatch<SetStateAction<SetDetailParams>> = useCallback(
    (action) => {
      // updater function の場合はそのまま通す（実際には使われていない）
      if (typeof action === 'function') {
        setDetailRaw(action)
        return
      }

      const newPath = detailToPath(action)
      const currentPath = window.location.pathname

      if (newPath !== currentPath) {
        // 新しいパスへ遷移
        navigatePanel(newPath, action.type != null ? action : null)
      } else if (action.type != null) {
        // 同じ URL だがデータが変わった場合 (SearchUser → Account 等)
        replacePanelUrl(currentPath, action)
      }

      setDetailRaw(action)
    },
    [],
  )

  // popstate (ブラウザの戻る/進む) をハンドリング
  useEffect(() => {
    const handlePopState = () => {
      const route = parsePanelRoute(window.location.pathname)

      if (isDetailRoute(route)) {
        // history.state から detail データを復元
        const state = window.history.state as SetDetailParams | null
        if (state?.type != null) {
          setDetailRaw(state)
        } else {
          // state がない場合 (直接 URL アクセス等) はホームへ
          replacePanelUrl('/')
          setDetailRaw({ content: null, type: null })
        }
      } else {
        // GettingStarted 系のルートまたはホーム → detail をクリア
        setDetailRaw({ content: null, type: null })
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // 初期ロード時: URL が detail ルートなら history.state から復元
  useEffect(() => {
    const route = parsePanelRoute(window.location.pathname)
    if (isDetailRoute(route)) {
      const state = window.history.state as SetDetailParams | null
      if (state?.type != null) {
        setDetailRaw(state)
      } else {
        // history.state がない (直接 URL アクセス) → ホームへフォールバック
        replacePanelUrl('/')
      }
    }
  }, [])

  return (
    <DetailContext.Provider value={detail}>
      <SetDetailContext.Provider value={setDetail}>
        {children}
      </SetDetailContext.Provider>
    </DetailContext.Provider>
  )
}
