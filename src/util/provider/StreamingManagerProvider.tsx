'use client'

import type { WebSocketInterface } from 'megalodon'
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
import type { Backend } from 'types/types'
import { buildInitialFetchTasks } from 'util/streaming/buildInitialFetchTasks'
import {
  getRetryDelay,
  MAX_RETRY_COUNT,
  MAX_STREAM_COUNT_WARNING,
} from 'util/streaming/constants'
import { deriveRequiredStreams } from 'util/streaming/deriveRequiredStreams'
import { initializeStream } from 'util/streaming/initializeStream'
import {
  INITIAL_FETCH_CONCURRENCY,
  runWithConcurrencyLimit,
} from 'util/streaming/runWithConcurrencyLimit'
import { setupStreamHandlers } from 'util/streaming/setupStreamHandlers'
import { restartStream, stopStream } from 'util/streaming/stopStream'
import { parseStreamKey, type StreamType } from 'util/streaming/streamKey'
import type { StreamEntry, StreamRegistry } from 'util/streaming/streamRegistry'
import { AppsContext } from './AppsProvider'
import { TimelineContext } from './TimelineProvider'

// ========================================
// Context 型定義
// ========================================

/**
 * StreamingManagerProvider が公開する API
 *
 * ## 設計方針: syncStreamsEvent による一元管理
 *
 * ストリームのライフサイクルは TimelineSettingsV2 の変更に連動して
 * syncStreamsEvent が一元的に管理する。
 * コンポーネント（UnifiedTimeline 等）から subscribe/unsubscribe を
 * 呼び出す方式は採用しない。
 *
 * コンポーネントが必要とするのは接続状態の参照のみであるため、
 * Context には getStatus のみを公開する。
 */
type StreamingManagerActions = {
  /**
   * 特定ストリームの接続状態を取得する
   */
  getStatus: (key: string) => StreamEntry['status'] | null
}

export const StreamingManagerContext = createContext<StreamingManagerActions>({
  getStatus: () => null,
})

export const StreamingManagerProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const apps = useContext(AppsContext)
  const timelineSettings = useContext(TimelineContext)
  const registryRef = useRef<StreamRegistry>(new Map())
  const initIdCounterRef = useRef(0)
  const refFirstRef = useRef(true)
  /** 初期データ取得済みのストリームキーを追跡（設定変更時の再取得を防止） */
  const fetchedInitialKeysRef = useRef(new Set<string>())
  /** apps 変更検出用（バックエンド追加/削除時にフェッチ済みキーをリセット） */
  const prevAppsKeyRef = useRef('')

  // =============================================
  // getStatus: 接続状態の取得
  // =============================================
  const getStatus = useCallback((key: string): StreamEntry['status'] | null => {
    return registryRef.current.get(key)?.status ?? null
  }, [])

  // =============================================
  // レジストリの状態更新ヘルパー
  // =============================================
  const updateStreamStatus = useCallback(
    (key: string, status: StreamEntry['status']) => {
      const entry = registryRef.current.get(key)
      if (entry) {
        entry.status = status
      }
    },
    [],
  )

  // =============================================
  // リトライスケジューラ
  // =============================================
  const scheduleRetry = useCallback(
    (key: string, stream: WebSocketInterface) => {
      const entry = registryRef.current.get(key)
      if (!entry) return // syncStreamsEvent により既に削除済み

      // megalodon のゴースト再接続を防止しつつ停止
      stopStream(stream)

      entry.retryCount += 1

      if (entry.retryCount > MAX_RETRY_COUNT) {
        console.warn(
          `Stream ${key}: max retry count (${MAX_RETRY_COUNT}) exceeded. Giving up.`,
        )
        updateStreamStatus(key, 'error')
        return
      }

      const delay = getRetryDelay(entry.retryCount - 1)

      entry.retryTimer = setTimeout(() => {
        // レジストリにまだ存在するか確認（syncStreamsEvent で削除されている可能性）
        if (registryRef.current.has(key)) {
          // 再接続能力を復元してから start()
          restartStream(stream)
          updateStreamStatus(key, 'connecting')
          console.info(
            `reconnecting ${key} (retry ${entry.retryCount}/${MAX_RETRY_COUNT}, delay ${delay}ms)`,
          )
        }
      }, delay)
    },
    [updateStreamStatus],
  )

  // =============================================
  // ストリームイベントハンドラのセットアップ（抽出モジュールへの委譲）
  // =============================================
  const boundSetupStreamHandlers = useCallback(
    (
      stream: WebSocketInterface,
      key: string,
      type: StreamType,
      backendUrl: string,
      options?: { tag?: string; backend?: Backend },
    ): void => {
      setupStreamHandlers(
        stream,
        key,
        type,
        backendUrl,
        options,
        { scheduleRetry, updateStreamStatus },
        registryRef,
      )
    },
    [updateStreamStatus, scheduleRetry],
  )

  // =============================================
  // ストリーム生成（抽出モジュールへの委譲）
  // =============================================
  const boundInitializeStream = useCallback(
    async (
      key: string,
      type: StreamType,
      backendUrl: string,
      app: Parameters<typeof initializeStream>[3],
      options?: { tag?: string; backend?: Backend },
      initId?: number,
    ): Promise<void> => {
      await initializeStream(key, type, backendUrl, app, options, initId, {
        registry: registryRef.current,
        setupStreamHandlers: boundSetupStreamHandlers,
      })
    },
    [boundSetupStreamHandlers],
  )

  // =============================================
  // 初期データ取得（ストリーム接続に伴う）
  // fetchedInitialKeysRef で取得済みキーを追跡し、
  // 設定変更時の不要な再フェッチを防止する。
  // =============================================
  const fetchInitialDataForTimelines = useEffectEvent(() => {
    // apps 変更検出: バックエンド構成が変わった場合のみリセット
    const currentAppsKey = apps
      .map((a) => a.backendUrl)
      .sort()
      .join('\0')
    if (currentAppsKey !== prevAppsKeyRef.current) {
      prevAppsKeyRef.current = currentAppsKey
      fetchedInitialKeysRef.current.clear()
    }

    const tasks = buildInitialFetchTasks(
      apps,
      timelineSettings.timelines,
      fetchedInitialKeysRef.current,
    )

    // 並行度を制限して実行（Worker キューの圧迫を防ぐ）
    runWithConcurrencyLimit(tasks, INITIAL_FETCH_CONCURRENCY)
  })

  // =============================================
  // syncStreamsEvent: タイムライン設定に基づくストリーム一元管理
  //
  // ストリームのライフサイクルはこの関数が完全に管理する。
  // コンポーネントからの subscribe/unsubscribe は行わない。
  // TimelineSettingsV2 が信頼できる唯一の情報源（SSOT）であり、
  // deriveRequiredStreams が必要なストリームの集合を算出する。
  // =============================================
  const syncStreamsEvent = useEffectEvent(() => {
    const registry = registryRef.current
    const requiredKeys = deriveRequiredStreams(timelineSettings.timelines, apps)

    // 接続数の警告
    if (requiredKeys.size > MAX_STREAM_COUNT_WARNING) {
      console.warn(
        `StreamingManager: ${requiredKeys.size} streams required, ` +
          `exceeds recommended limit of ${MAX_STREAM_COUNT_WARNING}. ` +
          'Consider reducing timeline or tag count.',
      )
    }

    // 不要なストリームを切断
    for (const [key, entry] of registry) {
      if (!requiredKeys.has(key)) {
        if (entry.stream) {
          stopStream(entry.stream)
        }
        if (entry.retryTimer != null) {
          clearTimeout(entry.retryTimer)
        }
        registry.delete(key)
      }
    }

    // 必要なストリームを接続（未接続のもののみ）
    for (const key of requiredKeys) {
      if (!registry.has(key)) {
        const { backendUrl, tag, type } = parseStreamKey(key)
        const app = apps.find((a) => a.backendUrl === backendUrl)
        if (app) {
          const initId = ++initIdCounterRef.current
          // プレースホルダーエントリを先に登録（重複接続防止）
          registry.set(key, {
            initId,
            retryCount: 0,
            retryTimer: null,
            status: 'connecting',
            stream: null,
          })
          boundInitializeStream(
            key,
            type,
            backendUrl,
            app,
            { backend: app.backend, tag },
            initId,
          )
        }
      }
    }
  })

  // =============================================
  // Effect: アンマウント時のみ全ストリームを切断
  // =============================================
  // 設定変更時の cleanup を分離し、ストリームの不要な全再構築を防止する。
  // syncStreamsEvent が diff ベースで不要ストリームを停止するため、
  // アンマウント以外で全ストリームを破棄する必要はない。
  useEffect(() => {
    return () => {
      for (const [, entry] of registryRef.current) {
        if (entry.stream) {
          stopStream(entry.stream)
        }
        if (entry.retryTimer != null) {
          clearTimeout(entry.retryTimer)
        }
      }
      registryRef.current.clear()
    }
  }, [])

  // =============================================
  // Effect: apps / timelineSettings 変更時に同期
  // =============================================
  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineSettings is intentionally included to trigger re-sync when settings change. syncStreamsEvent/fetchInitialDataForTimelines are useEffectEvent and capture the latest values.
  useEffect(() => {
    // StrictMode ガードを apps.length チェックより先に消費する。
    // apps.length を先にチェックすると、初回レンダで apps=[] の時に
    // refFirstRef が消費されず、apps が読み込まれた時にスキップされてしまう。
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    syncStreamsEvent()
    fetchInitialDataForTimelines()
  }, [apps, timelineSettings])

  const streamingManagerValue = useMemo(() => ({ getStatus }), [getStatus])

  return (
    <StreamingManagerContext.Provider value={streamingManagerValue}>
      {children}
    </StreamingManagerContext.Provider>
  )
}
