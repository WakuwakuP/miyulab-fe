'use client'

import type { Entity, WebSocketInterface } from 'megalodon'
import {
  createContext,
  type ReactNode,
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
import {
  StartupCoordinatorContext,
  type StartupPhase,
} from './StartupCoordinator'

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

type SetTagsFn = (updater: (prev: string[]) => string[]) => void
type SetUsersFn = (updater: (prev: UserSummary[]) => UserSummary[]) => void
type StreamRetryState = { count: number }

function scheduleStreamReconnect(
  stream: WebSocketInterface,
  retryCount: number,
  delay: number,
): void {
  setTimeout(() => {
    // 再接続能力を復元してから start()
    restartStream(stream)
    console.info(
      `reconnecting userStreaming (retry ${retryCount}/${MAX_RETRY_COUNT}, delay ${delay}ms)`,
    )
  }, delay)
}

function createUserStreamErrorHandler(
  stream: WebSocketInterface,
  retryState: StreamRetryState,
): (err: Error | undefined) => void {
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

function captureHomeStreamEventIfEnabled(
  app: App,
  backendUrl: string,
  eventType: string,
  rawData: unknown,
): void {
  if (!isRawDataCaptureEnabled()) return

  captureStreamEvent({
    backend: app.backend,
    backendUrl,
    eventType,
    origin: app.backend === 'misskey' ? 'misskey-js' : 'megalodon',
    rawData,
    streamType: 'home',
  })
}

function prependUserToUsersList(
  prev: UserSummary[],
  account: Entity.Account,
): UserSummary[] {
  return dedupeUsersByAcct([accountToUserSummary(account), ...prev])
}

function mergeTagNamesIntoState(setTags: SetTagsFn, tagNames: string[]): void {
  setTags((prev) => Array.from(new Set([...prev, ...tagNames])))
}

function prependUserToUsersState(
  setUsers: SetUsersFn,
  account: Entity.Account,
): void {
  setUsers((prev) => prependUserToUsersList(prev, account))
}

async function handleStreamUpdate(
  app: App,
  backendUrl: string,
  status: Entity.Status,
  setUsersEvent: SetUsersFn,
  setTagsEvent: SetTagsFn,
): Promise<void> {
  captureHomeStreamEventIfEnabled(app, backendUrl, 'update', status)

  const tagNames = status.tags.map((tag) => tag.name)
  mergeTagNamesIntoState(setTagsEvent, tagNames)

  const account = status.reblog?.account ?? status.account
  prependUserToUsersState(setUsersEvent, account)

  await upsertStatus(status, backendUrl, 'home')
}

async function handleStreamStatusUpdate(
  app: App,
  backendUrl: string,
  status: Entity.Status,
): Promise<void> {
  captureHomeStreamEventIfEnabled(app, backendUrl, 'status_update', status)
  await updateStatus(status, backendUrl)
}

async function handleStreamNotification(
  app: App,
  backendUrl: string,
  notification: Entity.Notification,
  setUsersEvent: SetUsersFn,
): Promise<void> {
  captureHomeStreamEventIfEnabled(app, backendUrl, 'notification', notification)
  await addNotification(notification, backendUrl)

  const account = notification.account
  if (account) {
    prependUserToUsersState(setUsersEvent, account)
  }
}

// deleteイベント: homeストリームからの受信なので 'home' のみ除外
async function handleStreamDelete(
  app: App,
  backendUrl: string,
  id: string,
): Promise<void> {
  captureHomeStreamEventIfEnabled(app, backendUrl, 'delete', id)
  await handleDeleteEvent(backendUrl, id, 'home')
}

function handleStreamConnect(retryState: StreamRetryState): void {
  retryState.count = 0
  console.info('connected userStreaming')
}

function buildStreamHandlers(
  app: App,
  setUsersEvent: SetUsersFn,
  setTagsEvent: SetTagsFn,
) {
  const { backendUrl } = app
  const retryState: StreamRetryState = { count: 0 }

  return {
    onConnect: () => handleStreamConnect(retryState),
    onDelete: (id: string) => handleStreamDelete(app, backendUrl, id),
    onError: (stream: WebSocketInterface) =>
      createUserStreamErrorHandler(stream, retryState),
    onNotification: (notification: Entity.Notification) =>
      handleStreamNotification(app, backendUrl, notification, setUsersEvent),
    onStatusUpdate: (status: Entity.Status) =>
      handleStreamStatusUpdate(app, backendUrl, status),
    onUpdate: (status: Entity.Status) =>
      handleStreamUpdate(app, backendUrl, status, setUsersEvent, setTagsEvent),
  }
}

type StreamHandlers = ReturnType<typeof buildStreamHandlers>

async function fetchRestDataForAllApps(
  apps: App[],
  isCancelled: () => boolean,
  setUsers: SetUsersFn,
  advanceTo: (target: StartupPhase) => void,
): Promise<void> {
  console.info('[Startup] Phase 3 開始: REST API 取得 + DB 書き込み')
  const promises = apps.map((app) =>
    fetchRestDataForApp(app, isCancelled, setUsers),
  )

  await Promise.all(promises)

  if (!isCancelled()) {
    console.info('[Startup] Phase 3 完了: REST API 取得 + DB 書き込み')
    advanceTo('rest-fetched')
  }
}

async function connectUserStreamForApp(
  app: App,
  appIndex: number,
  createStreamHandlers: (app: App, appIndex: number) => StreamHandlers,
  streams: Map<string, WebSocketInterface>,
): Promise<void> {
  const client = GetClient(app)
  const { backendUrl } = app

  try {
    const stream = await client.userStreaming()
    const handlers = createStreamHandlers(app, appIndex)

    // エラーハンドラを最初に登録して "Unhandled error" を防止する
    stream.on('error', handlers.onError(stream))
    stream.on('connect', handlers.onConnect)
    stream.on('update', handlers.onUpdate)
    stream.on('status_update', handlers.onStatusUpdate)
    stream.on('notification', handlers.onNotification)
    stream.on('delete', handlers.onDelete)

    streams.set(backendUrl, stream)
  } catch (error) {
    console.error(`Failed to start streaming for ${backendUrl}:`, error)
  }
}

type StatusInteractionField = 'favourited' | 'reblogged' | 'bookmarked'

async function updateStatusInteractionField(
  backendUrl: string,
  statusId: string,
  field: StatusInteractionField,
  value: boolean,
): Promise<void> {
  await updateStatusAction(backendUrl, statusId, field, value)
  await updateNotificationStatusAction(backendUrl, statusId, field, value)
}

function createStatusInteractionUpdater(field: StatusInteractionField) {
  return async (
    backendUrl: string,
    statusId: string,
    value: boolean,
  ): Promise<void> =>
    updateStatusInteractionField(backendUrl, statusId, field, value)
}

const setFavouritedAction = createStatusInteractionUpdater('favourited')
const setRebloggedAction = createStatusInteractionUpdater('reblogged')
const setBookmarkedAction = createStatusInteractionUpdater('bookmarked')

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

  // WebSocketストリームハンドラの作成
  const createStreamHandlers = useEffectEvent((app: App, _appIndex: number) =>
    buildStreamHandlers(app, setUsersEvent, setTagsEvent),
  )

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
    const isCancelled = () => cancelled

    void fetchRestDataForAllApps(apps, isCancelled, setUsersEvent, advanceTo)

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

    for (const [index, app] of apps.entries()) {
      void connectUserStreamForApp(
        app,
        index,
        createStreamHandlers,
        streamsRef.current,
      )
    }

    return () => {
      for (const stream of streamsRef.current.values()) {
        stopStream(stream)
      }
      streamsRef.current.clear()
    }
  }, [apps, restFetched])

  const storeActionsValue = useMemo(
    () => ({
      setBookmarked: setBookmarkedAction,
      setFavourited: setFavouritedAction,
      setReblogged: setRebloggedAction,
    }),
    [],
  )

  return (
    <StatusStoreActionsContext.Provider value={storeActionsValue}>
      {children}
    </StatusStoreActionsContext.Provider>
  )
}
