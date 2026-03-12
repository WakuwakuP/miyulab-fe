'use client'

import type { Entity, WebSocketInterface } from 'megalodon'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
} from 'react'
import type { App } from 'types/types'
import { startPeriodicCleanup } from 'util/db/sqlite/cleanup'
import { migrateFromIndexedDb } from 'util/db/sqlite/migration'
import {
  addNotification,
  bulkAddNotifications,
  updateNotificationStatusAction,
} from 'util/db/sqlite/notificationStore'
import {
  bulkUpsertStatuses,
  handleDeleteEvent,
  updateStatus,
  updateStatusAction,
  upsertStatus,
} from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'
import { getRetryDelay, MAX_RETRY_COUNT } from 'util/streaming/constants'
import { restartStream, stopStream } from 'util/streaming/stopStream'
import { AppsContext } from './AppsProvider'
import { SetTagsContext, SetUsersContext } from './ResourceProvider'

// ストア操作の型定義
type StatusStoreActions = {
  /** お気に入り状態を更新 */
  setFavourited: (backendUrl: string, statusId: string, value: boolean) => void
  /** リブログ状態を更新 */
  setReblogged: (backendUrl: string, statusId: string, value: boolean) => void
  /** ブックマーク状態を更新 */
  setBookmarked: (backendUrl: string, statusId: string, value: boolean) => void
}

// Context定義
export const StatusStoreActionsContext = createContext<StatusStoreActions>({
  setBookmarked: () => {},
  setFavourited: () => {},
  setReblogged: () => {},
})

/**
 * StatusStore Provider
 * IndexedDBを使った投稿データの一元管理
 *
 * ## ストリーミング責務
 * このProviderは **userStreaming()** のみを管理する。
 * - update       → upsertStatus(…, 'home')
 * - status_update → updateStatus(…)
 * - notification → addNotification(…)
 * - delete       → handleDeleteEvent(…, 'home')
 *
 * Local/Public/Tag 用のストリーミングは各コンポーネントが個別に管理する。
 * 詳細は 02-architecture.md の「ストリーミング責務分担」を参照。
 */
export const StatusStoreProvider = ({ children }: { children: ReactNode }) => {
  const apps = useContext(AppsContext)
  const setUsers = useContext(SetUsersContext)
  const setTags = useContext(SetTagsContext)
  const refFirstRef = useRef(true)
  const streamsRef = useRef<Map<string, WebSocketInterface>>(new Map())

  // useEffectEvent でイベントハンドラを安定化
  const setUsersEvent = useEffectEvent(setUsers)
  const setTagsEvent = useEffectEvent(setTags)

  // アクション更新関数
  const setFavourited = useCallback(
    async (backendUrl: string, statusId: string, value: boolean) => {
      await updateStatusAction(backendUrl, statusId, 'favourited', value)
      await updateNotificationStatusAction(
        backendUrl,
        statusId,
        'favourited',
        value,
      )
    },
    [],
  )

  const setReblogged = useCallback(
    async (backendUrl: string, statusId: string, value: boolean) => {
      await updateStatusAction(backendUrl, statusId, 'reblogged', value)
      await updateNotificationStatusAction(
        backendUrl,
        statusId,
        'reblogged',
        value,
      )
    },
    [],
  )

  const setBookmarked = useCallback(
    async (backendUrl: string, statusId: string, value: boolean) => {
      await updateStatusAction(backendUrl, statusId, 'bookmarked', value)
      await updateNotificationStatusAction(
        backendUrl,
        statusId,
        'bookmarked',
        value,
      )
    },
    [],
  )

  // WebSocketストリームハンドラの作成
  const createStreamHandlers = useEffectEvent((app: App, _appIndex: number) => {
    const { backendUrl } = app

    const onUpdate = async (status: Entity.Status) => {
      // タグを収集
      setTagsEvent((prev) =>
        Array.from(new Set([...prev, ...status.tags.map((tag) => tag.name)])),
      )

      // ユーザー情報を収集
      const account = status.reblog?.account ?? status.account
      setUsersEvent((prev) =>
        [
          {
            acct: account.acct,
            avatar: account.avatar,
            display_name: account.display_name,
            id: account.id,
          },
          ...prev,
        ].filter(
          (element, idx, self) =>
            self.findIndex((e) => e.acct === element.acct) === idx,
        ),
      )

      // IndexedDBに保存（appIndex は永続化しない）
      await upsertStatus(status, backendUrl, 'home')
    }

    const onStatusUpdate = async (status: Entity.Status) => {
      await updateStatus(status, backendUrl)
    }

    const onNotification = async (notification: Entity.Notification) => {
      await addNotification(notification, backendUrl)

      const account = notification.account
      if (account) {
        setUsersEvent((prev) =>
          [
            {
              acct: account.acct,
              avatar: account.avatar,
              display_name: account.display_name,
              id: account.id,
            },
            ...prev,
          ].filter(
            (element, idx, self) =>
              self.findIndex((e) => e.acct === element.acct) === idx,
          ),
        )
      }
    }

    // deleteイベント: homeストリームからの受信なので 'home' のみ除外
    const onDelete = async (id: string) => {
      await handleDeleteEvent(backendUrl, id, 'home')
    }

    const retryState = { count: 0 }

    const onError = (stream: WebSocketInterface) => {
      return (err: Error | undefined) => {
        console.warn('userStreaming error:', err?.message ?? 'unknown error')
        // megalodon のゴースト再接続を防止しつつ停止
        stopStream(stream)

        retryState.count += 1

        if (retryState.count > MAX_RETRY_COUNT) {
          console.warn(
            `userStreaming: max retry count (${MAX_RETRY_COUNT}) exceeded. Giving up.`,
          )
          return
        }

        const delay = getRetryDelay(retryState.count - 1)
        const timeout = setTimeout(() => {
          // 再接続能力を復元してから start()
          restartStream(stream)
          console.info(
            `reconnecting userStreaming (retry ${retryState.count}/${MAX_RETRY_COUNT}, delay ${delay}ms)`,
          )
          clearTimeout(timeout)
        }, delay)
      }
    }

    const onConnect = () => {
      retryState.count = 0
      console.info('connected userStreaming')
    }

    return {
      onConnect,
      onDelete,
      onError,
      onNotification,
      onStatusUpdate,
      onUpdate,
    }
  })

  // 初期化処理
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    // IndexedDB → SQLite マイグレーション完了後に定期クリーンアップを開始
    let stopCleanup: (() => void) | undefined
    migrateFromIndexedDb()
      .then(() => {
        stopCleanup = startPeriodicCleanup()
      })
      .catch((error) => {
        console.error('Migration failed:', error)
      })

    // 各アプリのデータを取得してストリーミング接続
    apps.forEach(async (app, index) => {
      const client = GetClient(app)
      const { backendUrl } = app

      // WebSocketストリーミング接続をREST API呼び出しと並行して開始
      client
        .userStreaming()
        .then((stream) => {
          const handlers = createStreamHandlers(app, index)

          // エラーハンドラを最初に登録して "Unhandled error" を防止する
          stream.on('error', handlers.onError(stream))
          stream.on('connect', handlers.onConnect)
          stream.on('update', handlers.onUpdate)
          stream.on('status_update', handlers.onStatusUpdate)
          stream.on('notification', handlers.onNotification)
          stream.on('delete', handlers.onDelete)

          streamsRef.current.set(backendUrl, stream)
        })
        .catch((error) => {
          console.error(`Failed to start streaming for ${backendUrl}:`, error)
        })

      try {
        // ホームタイムラインと通知を並行して取得
        const [homeRes, notifRes] = await Promise.all([
          client.getHomeTimeline({ limit: 40 }),
          client.getNotifications({ limit: 40 }),
        ])

        await bulkUpsertStatuses(homeRes.data, backendUrl, 'home')

        // ユーザー情報を収集
        const users = homeRes.data
          .map((status) => status.reblog?.account ?? status.account)
          .map((account) => ({
            acct: account.acct,
            avatar: account.avatar,
            display_name: account.display_name,
            id: account.id,
          }))
        setUsersEvent((prev) =>
          [...users, ...prev].filter(
            (element, idx, self) =>
              self.findIndex((e) => e.acct === element.acct) === idx,
          ),
        )

        await bulkAddNotifications(notifRes.data, backendUrl)

        // 通知からユーザー情報を収集
        const notifUsers = notifRes.data
          .filter(
            (n): n is typeof n & { account: NonNullable<typeof n.account> } =>
              n.account != null,
          )
          .map((n) => ({
            acct: n.account.acct,
            avatar: n.account.avatar,
            display_name: n.account.display_name,
            id: n.account.id,
          }))
        setUsersEvent((prev) =>
          [...prev, ...notifUsers].filter(
            (element, idx, self) =>
              self.findIndex((e) => e.acct === element.acct) === idx,
          ),
        )
      } catch (error) {
        console.error(`Failed to initialize for ${backendUrl}:`, error)
      }
    })

    // クリーンアップ
    return () => {
      stopCleanup?.()
      for (const stream of streamsRef.current.values()) {
        stopStream(stream)
      }
      streamsRef.current.clear()
    }
  }, [apps])

  return (
    <StatusStoreActionsContext.Provider
      value={{
        setBookmarked,
        setFavourited,
        setReblogged,
      }}
    >
      {children}
    </StatusStoreActionsContext.Provider>
  )
}
