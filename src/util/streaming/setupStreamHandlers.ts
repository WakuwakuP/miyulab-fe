import type { Entity, WebSocketInterface } from 'megalodon'
import type { Backend } from 'types/types'
import type { TimelineType as DbTimelineType } from 'util/db/sqlite/statusStore'
import {
  handleDeleteEvent,
  updateStatus,
  upsertStatus,
} from 'util/db/sqlite/statusStore'
import {
  captureStreamEvent,
  isRawDataCaptureEnabled,
} from 'util/debug/rawDataCapture'
import type { StreamEntry } from 'util/streaming/streamRegistry'
import type { StreamType } from './streamKey'

export type StreamHandlerCallbacks = {
  updateStreamStatus: (key: string, status: StreamEntry['status']) => void
  scheduleRetry: (key: string, stream: WebSocketInterface) => void
}

/**
 * WebSocket ストリームにイベントハンドラ（update / status_update / delete / connect / error）を登録する。
 * DB 書き込み・デバッグキャプチャ・リトライスケジュールは全てここで処理する。
 */
export function setupStreamHandlers(
  stream: WebSocketInterface,
  key: string,
  type: StreamType,
  backendUrl: string,
  options: { tag?: string; backend?: Backend } | undefined,
  callbacks: StreamHandlerCallbacks,
  registryRef: { current: Map<string, StreamEntry> },
): void {
  const timelineType = type as DbTimelineType
  const tag = options?.tag
  const backend = options?.backend ?? 'mastodon'

  stream.on('update', async (status: Entity.Status) => {
    if (isRawDataCaptureEnabled()) {
      captureStreamEvent({
        backend,
        backendUrl,
        eventType: 'update',
        origin: 'megalodon',
        rawData: status,
        streamType: timelineType,
        tag,
      })
    }
    await upsertStatus(status, backendUrl, timelineType, tag)
  })

  stream.on('status_update', async (status: Entity.Status) => {
    if (isRawDataCaptureEnabled()) {
      captureStreamEvent({
        backend,
        backendUrl,
        eventType: 'status_update',
        origin: 'megalodon',
        rawData: status,
        streamType: timelineType,
        tag,
      })
    }
    await updateStatus(status, backendUrl)
  })

  stream.on('delete', async (id: string) => {
    if (isRawDataCaptureEnabled()) {
      captureStreamEvent({
        backend,
        backendUrl,
        eventType: 'delete',
        origin: 'megalodon',
        rawData: id,
        streamType: timelineType,
        tag,
      })
    }
    await handleDeleteEvent(backendUrl, id, timelineType, tag)
  })

  stream.on('connect', () => {
    console.info(`connected ${key}`)
    callbacks.updateStreamStatus(key, 'connected')
    const entry = registryRef.current.get(key)
    if (entry) {
      entry.retryCount = 0
    }
  })

  stream.on('error', (err: Error | undefined) => {
    console.warn(`stream error ${key}:`, err?.message ?? 'unknown error')
    callbacks.updateStreamStatus(key, 'error')
    callbacks.scheduleRetry(key, stream)
  })
}
