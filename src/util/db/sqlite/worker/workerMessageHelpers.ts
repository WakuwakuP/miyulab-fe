/**
 * Worker → Main Thread メッセージ送信ヘルパー
 */

import type { TableName, WorkerMessage } from '../protocol'
import { bumpTableVersions } from './workerState'

export function sendResponse(
  id: number,
  result: unknown,
  changedTables?: TableName[],
  durationMs?: number,
  changeHint?: { timelineType?: string; backendUrl?: string; tag?: string },
): void {
  // 書き込みが伴う場合はバージョンをインクリメント
  bumpTableVersions(changedTables)
  const response: WorkerMessage = {
    changedTables,
    changeHint,
    durationMs,
    id,
    result,
    type: 'response',
  }
  self.postMessage(response)
}

export function sendError(id: number, error: unknown): void {
  const response: WorkerMessage = {
    error: error instanceof Error ? error.message : String(error),
    id,
    type: 'error',
  }
  self.postMessage(response)
}
