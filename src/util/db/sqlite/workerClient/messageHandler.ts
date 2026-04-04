/**
 * Worker からのメッセージハンドラ
 *
 * Worker が返す init / response / error / slowQueryLogs メッセージを処理する。
 */

import { startSnapshotRecording } from '../../dbQueue'
import type { SlowQueryLogEntry, WorkerMessage } from '../protocol'
import {
  durationForId,
  initReject,
  initResolve,
  initTimer,
  notifyChangeCallback,
  pending,
  setInitReject,
  setInitResolve,
  setInitTimer,
  setSlowQueryLogCallback,
  slowQueryLogCallback,
} from './state'

export function handleMessage(event: MessageEvent<WorkerMessage>): void {
  const msg = event.data

  switch (msg.type) {
    case 'init': {
      if (initResolve) {
        // 初期化成功 — スナップショット記録を開始
        startSnapshotRecording()
        initResolve(msg.persistence)
        setInitResolve(null)
        setInitReject(null)
        if (initTimer != null) {
          clearTimeout(initTimer)
          setInitTimer(null)
        }
      }
      break
    }

    case 'response': {
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        // changedTables があれば notifyChange を発火
        if (msg.changedTables) {
          for (const table of msg.changedTables) {
            notifyChangeCallback?.(table, msg.changeHint)
          }
        }
        if (msg.durationMs != null) {
          durationForId.set(msg.id, msg.durationMs)
        }
        req.resolve(msg.result)
      }
      break
    }

    case 'error': {
      // Worker 初期化エラー (id === -1) をハンドリング
      if (msg.id === -1 && initReject) {
        initReject(new Error(msg.error))
        setInitReject(null)
        setInitResolve(null)
        if (initTimer != null) {
          clearTimeout(initTimer)
          setInitTimer(null)
        }
        break
      }
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        req.reject(new Error(msg.error))
      }
      break
    }

    case 'slowQueryLogs': {
      slowQueryLogCallback?.(msg.logs)
      break
    }
  }
}

/**
 * スロークエリログの通知コールバックを登録する。
 * 戻り値は登録解除関数。
 */
export function onSlowQueryLogs(
  callback: (logs: SlowQueryLogEntry[]) => void,
): () => void {
  setSlowQueryLogCallback(callback)
  return () => {
    setSlowQueryLogCallback(null)
  }
}
