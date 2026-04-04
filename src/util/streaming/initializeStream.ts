import type { WebSocketInterface } from 'megalodon'
import type { App, Backend } from 'types/types'
import { GetClient } from 'util/GetClient'
import { getRetryDelay, MAX_RETRY_COUNT } from 'util/streaming/constants'
import { stopStream } from 'util/streaming/stopStream'
import type { StreamRegistry } from 'util/streaming/streamRegistry'
import type { StreamType } from './streamKey'

export type InitializeStreamDeps = {
  registry: StreamRegistry
  setupStreamHandlers: (
    stream: WebSocketInterface,
    key: string,
    type: StreamType,
    backendUrl: string,
    options?: { tag?: string; backend?: Backend },
  ) => void
}

/**
 * 指定タイプの WebSocket ストリームを生成し、レジストリに登録する。
 * 初期化失敗時はエクスポネンシャルバックオフでリトライをスケジュールする。
 */
export async function initializeStream(
  key: string,
  type: StreamType,
  backendUrl: string,
  app: App,
  options: { tag?: string; backend?: Backend } | undefined,
  initId: number | undefined,
  deps: InitializeStreamDeps,
): Promise<void> {
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
        if (tag == null) throw new Error('tag is required for tag streaming')
        stream = await client.tagStreaming(tag)
        break
      }
    }

    // stop() が WebSocket エラーイベントを発火する場合に備え、
    // レジストリ確認前にエラーハンドラを登録して "Unhandled error" を防止する。
    // setupStreamHandlers で正式なハンドラが追加された後はそちらが処理する。
    stream.on('error', () => {})

    // レジストリにまだ必要か確認（非同期処理中に syncStreamsEvent が発火している可能性）
    const entry = deps.registry.get(key)
    if (!entry || (initId !== undefined && entry.initId !== initId)) {
      stopStream(stream)
      return
    }

    // レジストリを更新
    deps.registry.set(key, {
      initId: entry.initId,
      retryCount: 0,
      retryTimer: null,
      status: 'connecting',
      stream,
    })

    // イベントハンドラ登録
    deps.setupStreamHandlers(stream, key, type, backendUrl, options)
  } catch (error) {
    console.warn(`Failed to create stream ${key}:`, (error as Error).message)
    // エラー発生時もレジストリを更新（リトライ可能な状態にする）
    const entry = deps.registry.get(key)
    if (entry && (initId === undefined || entry.initId === initId)) {
      entry.status = 'error'
      entry.retryCount += 1

      if (entry.retryCount > MAX_RETRY_COUNT) {
        console.warn(
          `Stream ${key}: max retry count (${MAX_RETRY_COUNT}) exceeded during initialization. Giving up.`,
        )
        return
      }

      const delay = getRetryDelay(entry.retryCount - 1)
      // 初期化失敗時もリトライをスケジュール
      entry.retryTimer = setTimeout(() => {
        const currentEntry = deps.registry.get(key)
        if (
          currentEntry &&
          (initId === undefined || currentEntry.initId === initId)
        ) {
          console.info(
            `Retrying initialization for ${key} (retry ${entry.retryCount}/${MAX_RETRY_COUNT}, delay ${delay}ms)`,
          )
          initializeStream(key, type, backendUrl, app, options, initId, deps)
        }
      }, delay)
    }
  }
}
