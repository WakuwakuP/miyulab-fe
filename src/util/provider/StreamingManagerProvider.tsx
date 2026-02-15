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
import type { TimelineType as DbTimelineType } from 'util/db/database'
import { handleDeleteEvent, upsertStatus } from 'util/db/statusStore'
import { GetClient } from 'util/GetClient'
import {
  MAX_STREAM_COUNT_WARNING,
  RETRY_DELAY_MS,
} from 'util/streaming/constants'
import { deriveRequiredStreams } from 'util/streaming/deriveRequiredStreams'
import { parseStreamKey, type StreamType } from 'util/streaming/streamKey'
import type { StreamEntry, StreamRegistry } from 'util/streaming/streamRegistry'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { fetchInitialData } from 'util/timelineFetcher'
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
  const refFirstRef = useRef(true)

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

      stream.stop()

      entry.retryTimer = setTimeout(() => {
        // レジストリにまだ存在するか確認（syncStreamsEvent で削除されている可能性）
        if (registryRef.current.has(key)) {
          stream.start()
          updateStreamStatus(key, 'connecting')
          console.info(`reconnected ${key}`)
        }
      }, RETRY_DELAY_MS)
    },
    [updateStreamStatus],
  )

  // =============================================
  // ストリームイベントハンドラのセットアップ
  // =============================================
  const setupStreamHandlers = useCallback(
    (
      stream: WebSocketInterface,
      key: string,
      type: StreamType,
      backendUrl: string,
      options?: { tag?: string },
    ): void => {
      const timelineType = type as DbTimelineType // 'local' | 'public' | 'tag'
      const tag = options?.tag

      stream.on('update', async (status: Entity.Status) => {
        await upsertStatus(status, backendUrl, timelineType, tag)
      })

      stream.on('delete', async (id: string) => {
        await handleDeleteEvent(backendUrl, id, timelineType, tag)
      })

      stream.on('connect', () => {
        console.info(`connected ${key}`)
        updateStreamStatus(key, 'connected')
      })

      stream.on('error', (err: Error) => {
        console.error(`stream error ${key}:`, err)
        updateStreamStatus(key, 'error')
        scheduleRetry(key, stream)
      })
    },
    [updateStreamStatus, scheduleRetry],
  )

  // =============================================
  // ストリーム生成
  // =============================================
  const initializeStream = useCallback(
    async (
      key: string,
      type: StreamType,
      backendUrl: string,
      app: App,
      options?: { tag?: string },
    ): Promise<void> => {
      try {
        const client = GetClient(app)

        let stream: WebSocketInterface

        switch (type) {
          case 'local':
            stream = await client.localStreaming()
            break
          case 'public':
            stream = await client.publicStreaming()
            break
          case 'tag': {
            const tag = options?.tag
            if (tag == null)
              throw new Error('tag is required for tag streaming')
            stream = await client.tagStreaming(tag)
            break
          }
        }

        // レジストリにまだ必要か確認（非同期処理中に syncStreamsEvent が発火している可能性）
        if (!registryRef.current.has(key)) {
          stream.stop()
          return
        }

        // レジストリを更新
        registryRef.current.set(key, {
          retryTimer: null,
          status: 'connecting',
          stream,
        })

        // イベントハンドラ登録
        setupStreamHandlers(stream, key, type, backendUrl, options)
      } catch (error) {
        console.error(`Failed to create stream ${key}:`, error)
        // エラー発生時もレジストリを更新（リトライ可能な状態にする）
        const entry = registryRef.current.get(key)
        if (entry) {
          entry.status = 'error'
          // 初期化失敗時もリトライをスケジュール
          entry.retryTimer = setTimeout(() => {
            if (registryRef.current.has(key)) {
              console.info(`Retrying initialization for ${key}`)
              initializeStream(key, type, backendUrl, app, options)
            }
          }, RETRY_DELAY_MS)
        }
      }
    },
    [setupStreamHandlers],
  )

  // =============================================
  // 初期データ取得（ストリーム接続に伴う）
  // =============================================
  const fetchInitialDataForTimelines = useEffectEvent(() => {
    for (const config of timelineSettings.timelines) {
      // home は StatusStoreProvider が担当、notification は対象外
      if (config.type === 'home' || config.type === 'notification') continue

      const filter = normalizeBackendFilter(config.backendFilter, apps)
      const targetUrls = resolveBackendUrls(filter, apps)

      for (const url of targetUrls) {
        const app = apps.find((a) => a.backendUrl === url)
        if (!app) continue

        const client = GetClient(app)
        fetchInitialData(client, config, url).catch((error) => {
          console.error(
            `Failed to fetch initial data for ${config.type} (${url}):`,
            error,
          )
        })
      }
    }
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
          entry.stream.stop()
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
          // プレースホルダーエントリを先に登録（重複接続防止）
          registry.set(key, {
            retryTimer: null,
            status: 'connecting',
            stream: null,
          })
          initializeStream(key, type, backendUrl, app, { tag })
        }
      }
    }
  })

  // =============================================
  // Effect: apps / timelineSettings 変更時に同期
  // =============================================
  // biome-ignore lint/correctness/useExhaustiveDependencies: timelineSettings is intentionally included to trigger re-sync when settings change. syncStreamsEvent/fetchInitialDataForTimelines are useEffectEvent and capture the latest values.
  useEffect(() => {
    if (apps.length <= 0) return
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }

    syncStreamsEvent()
    fetchInitialDataForTimelines()

    // クリーンアップ: 全ストリーム切断
    return () => {
      for (const [, entry] of registryRef.current) {
        if (entry.stream) {
          entry.stream.stop()
        }
        if (entry.retryTimer != null) {
          clearTimeout(entry.retryTimer)
        }
      }
      registryRef.current.clear()
    }
  }, [apps, timelineSettings])

  return (
    <StreamingManagerContext.Provider value={{ getStatus }}>
      {children}
    </StreamingManagerContext.Provider>
  )
}
