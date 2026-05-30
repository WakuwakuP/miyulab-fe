'use client'

import type { Entity, WebSocketInterface } from 'megalodon'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from 'react'
import type { App } from 'types/types'
import { startPeriodicCleanup } from 'util/db/sqlite/cleanup'
import { startPeriodicExport } from 'util/db/sqlite/dbExport'
import {
  addNotification,
  bulkAddNotifications,
  updateNotificationStatusAction,
} from 'util/db/sqlite/notificationStore'
import {
  bulkUpsertStatuses,
  ensureLocalAccount,
  handleDeleteEvent,
  updateStatus,
  updateStatusAction,
  upsertStatus,
} from 'util/db/sqlite/statusStore'
import {
  captureApiResponse,
  captureStreamEvent,
  isRawDataCaptureEnabled,
} from 'util/debug/rawDataCapture'
import { GetClient } from 'util/GetClient'
import { getRetryDelay, MAX_RETRY_COUNT } from 'util/streaming/constants'
import { restartStream, stopStream } from 'util/streaming/stopStream'
import { AppsContext } from './AppsProvider'
import { SetTagsContext, SetUsersContext } from './ResourceProvider'
import { StartupCoordinatorContext } from './StartupCoordinator'

type UserSummary = Pick<
  Entity.Account,
  'id' | 'acct' | 'avatar' | 'display_name'
>

/** acct で重複を除く（先頭のエントリを優先） */
function dedupeUsersByAcct(users: UserSummary[]): UserSummary[] {
  const seen = new Set<string>()
  const result: UserSummary[] = []
  for (const user of users) {
    if (seen.has(user.acct)) continue
    seen.add(user.acct)
    result.push(user)
  }
  return result
}

function accountToUserSummary(account: Entity.Account): UserSummary {
  return {
    acct: account.acct,
    avatar: account.avatar,
    display_name: account.display_name,
    id: account.id,
  }
}

function extractUsersFromStatuses(statuses: Entity.Status[]): UserSummary[] {
  return statuses
    .map((status) => status.reblog?.account ?? status.account)
    .map(accountToUserSummary)
}

function extractUsersFromNotifications(
  notifications: Entity.Notification[],
): UserSummary[] {
  return notifications
    .filter(
      (n): n is typeof n & { account: NonNullable<typeof n.account> } =>
        n.account != null,
    )
    .map((n) => accountToUserSummary(n.account))
}

function captureRestTimelineResponses(
  app: App,
  backendUrl: string,
  homeData: Entity.Status[],
  notifData: Entity.Notification[],
): void {
  if (!isRawDataCaptureEnabled()) return

  captureApiResponse({
    backend: app.backend,
    backendUrl,
    dataCount: homeData.length,
    eventType: 'getHomeTimeline',
    origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
    rawData: homeData,
  })
  captureApiResponse({
    backend: app.backend,
    backendUrl,
    dataCount: notifData.length,
    eventType: 'getNotifications',
    origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
    rawData: notifData,
  })
}

async function fetchRestDataForApp(
  app: App,
  isCancelled: () => boolean,
  setUsers: (updater: (prev: UserSummary[]) => UserSummary[]) => void,
): Promise<void> {
  const client = GetClient(app)
  const { backendUrl } = app

  try {
    // ローカルアカウント情報を先に同期する。
    // DB が空の場合、local_accounts レコードが存在しないと
    // bulkUpsertStatuses が timeline_entries を作成できない。
    try {
      const credRes = await client.verifyAccountCredentials()
      await ensureLocalAccount(credRes.data, backendUrl)
    } catch (error) {
      console.warn(`Failed to verify credentials for ${backendUrl}:`, error)
    }

    // ホームタイムラインと通知を並行して取得
    const [homeRes, notifRes] = await Promise.all([
      client.getHomeTimeline({ limit: 40 }),
      client.getNotifications({ limit: 40 }),
    ])

    if (isCancelled()) return

    captureRestTimelineResponses(app, backendUrl, homeRes.data, notifRes.data)

    await bulkUpsertStatuses(homeRes.data, backendUrl, 'home')

    const users = extractUsersFromStatuses(homeRes.data)
    setUsers((prev) => dedupeUsersByAcct([...users, ...prev]))

    await bulkAddNotifications(notifRes.data, backendUrl)

    const notifUsers = extractUsersFromNotifications(notifRes.data)
    setUsers((prev) => dedupeUsersByAcct([...prev, ...notifUsers]))
  } catch (error) {
    console.error(`Failed to initialize for ${backendUrl}:`, error)
  }
}

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
  const { isPhaseReached, advanceTo } = useContext(StartupCoordinatorContext)
  const refFirstRef = useRef(true)
  const refFirstRestRef = useRef(true)
  const refFirstStreamRef = useRef(true)
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
      // Raw data capture (stream)
      if (isRawDataCaptureEnabled()) {
        captureStreamEvent({
          backend: app.backend,
          backendUrl,
          eventType: 'update',
          origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
          rawData: status,
          streamType: 'home',
        })
      }

      // タグを収集
      const tagNames = status.tags.map((tag) => tag.name)
      setTagsEvent((prev) => Array.from(new Set([...prev, ...tagNames])))

      // ユーザー情報を収集
      const account = status.reblog?.account ?? status.account
      setUsersEvent((prev) =>
        dedupeUsersByAcct([
          {
            acct: account.acct,
            avatar: account.avatar,
            display_name: account.display_name,
            id: account.id,
          },
          ...prev,
        ]),
      )

      // IndexedDBに保存（appIndex は永続化しない）
      await upsertStatus(status, backendUrl, 'home')
    }

    const onStatusUpdate = async (status: Entity.Status) => {
      if (isRawDataCaptureEnabled()) {
        captureStreamEvent({
          backend: app.backend,
          backendUrl,
          eventType: 'status_update',
          origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
          rawData: status,
          streamType: 'home',
        })
      }
      await updateStatus(status, backendUrl)
    }

    const onNotification = async (notification: Entity.Notification) => {
      if (isRawDataCaptureEnabled()) {
        captureStreamEvent({
          backend: app.backend,
          backendUrl,
          eventType: 'notification',
          origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
          rawData: notification,
          streamType: 'home',
        })
      }
      await addNotification(notification, backendUrl)

      const account = notification.account
      if (account) {
        const newUser: UserSummary = {
          acct: account.acct,
          avatar: account.avatar,
          display_name: account.display_name,
          id: account.id,
        }
        setUsersEvent((prev) => dedupeUsersByAcct([newUser, ...prev]))
      }
    }

    // deleteイベント: homeストリームからの受信なので 'home' のみ除外
    const onDelete = async (id: string) => {
      if (isRawDataCaptureEnabled()) {
        captureStreamEvent({
          backend: app.backend,
          backendUrl,
          eventType: 'delete',
          origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
          rawData: id,
          streamType: 'home',
        })
      }
      await handleDeleteEvent(backendUrl, id, 'home')
    }

    const retryState = { count: 0 }

    const scheduleStreamReconnect = (
      stream: WebSocketInterface,
      retryCount: number,
      delay: number,
    ) => {
      setTimeout(() => {
        // 再接続能力を復元してから start()
        restartStream(stream)
        console.info(
          `reconnecting userStreaming (retry ${retryCount}/${MAX_RETRY_COUNT}, delay ${delay}ms)`,
        )
      }, delay)
    }

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

        scheduleStreamReconnect(
          stream,
          retryState.count,
          getRetryDelay(retryState.count - 1),
        )
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

  // =========================================================================
  // Effect 1: 即時処理（フェーズ不問）
  // 定期クリーンアップと定期エクスポートのみ。DB 初期化は StartupCoordinator
  // が担うため、ここでは initAccountResolver() を呼ばない。
  // =========================================================================
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    const stopCleanup = startPeriodicCleanup()
    const stopExport = startPeriodicExport()

    return () => {
      stopCleanup()
      stopExport()
    }
  }, [apps])

  // =========================================================================
  // Effect 2: Phase 3 — REST API 取得 + DB 書き込み
  // timeline-displayed フェーズに達してから REST 取得を開始する。
  // 完了後に advanceTo('rest-fetched') を呼ぶ。
  // =========================================================================
  const timelineDisplayed = isPhaseReached('timeline-displayed')

  // biome-ignore lint/correctness/useExhaustiveDependencies: advanceTo is stable; createStreamHandlers is useEffectEvent
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRestRef.current) {
      refFirstRestRef.current = false
      return
    }
    if (!timelineDisplayed) return
    if (apps.length <= 0) return

    let cancelled = false

    const fetchAll = async () => {
      console.info('[Startup] Phase 3 開始: REST API 取得 + DB 書き込み')
      const isCancelled = () => cancelled
      const promises = apps.map((app) =>
        fetchRestDataForApp(app, isCancelled, setUsersEvent),
      )

      await Promise.all(promises)

      if (!cancelled) {
        console.info('[Startup] Phase 3 完了: REST API 取得 + DB 書き込み')
        advanceTo('rest-fetched')
      }
    }

    fetchAll()

    return () => {
      cancelled = true
    }
  }, [apps, timelineDisplayed])

  // =========================================================================
  // Effect 3: Phase 4 — userStreaming 接続
  // rest-fetched フェーズに達してから WebSocket 接続を開始する。
  // =========================================================================
  const restFetched = isPhaseReached('rest-fetched')

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstStreamRef.current) {
      refFirstStreamRef.current = false
      return
    }
    if (!restFetched) return
    if (apps.length <= 0) return

    console.info('[Startup] Phase 4 開始: userStreaming 接続')

    apps.forEach(async (app, index) => {
      const client = GetClient(app)
      const { backendUrl } = app

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
    })

    return () => {
      for (const stream of streamsRef.current.values()) {
        stopStream(stream)
      }
      streamsRef.current.clear()
    }
  }, [apps, restFetched])

  const storeActionsValue = useMemo(
    () => ({
      setBookmarked,
      setFavourited,
      setReblogged,
    }),
    [setBookmarked, setFavourited, setReblogged],
  )

  return (
    <StatusStoreActionsContext.Provider value={storeActionsValue}>
      {children}
    </StatusStoreActionsContext.Provider>
  )
}
