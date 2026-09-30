/**
 * Worker からのメッセージハンドラ
 *
 * Worker が返す init / response / error / slowQueryLogs メッセージを処理する。
 */

import { dbDiagnosticRecorder } from '../../dbDiagnostics'
import { startSnapshotRecording } from '../../dbQueue'
import type { ChangeHint } from '../connection'
import type {
  DbRecoveredMessage,
  ErrorResponse,
  InitMessage,
  SlowQueryLogEntry,
  SlowQueryLogMessage,
  SuccessResponse,
  WorkerMessage,
} from '../protocol'
import { ALL_TABLE_NAMES, isTableName } from '../protocol'
import {
  getInitReject,
  getInitResolve,
  getInitTimer,
  getNotifyChangeCallback,
  getSlowQueryLogCallback,
  pending,
  setInitReject,
  setInitResolve,
  setInitTimer,
  setSlowQueryLogCallback,
} from './state'

function clearInitTimer(): void {
  const initTimer = getInitTimer()
  if (initTimer != null) {
    clearTimeout(initTimer)
    setInitTimer(null)
  }
}

function handleInitMessage(msg: InitMessage): void {
  const initResolve = getInitResolve()
  if (!initResolve) {
    return
  }
  startSnapshotRecording()
  dbDiagnosticRecorder.setEnvironment('worker', msg.persistence)
  if (msg.recovered) {
    console.warn(`SQLite: database was recovered at startup (${msg.recovered})`)
  }
  initResolve(msg.persistence)
  setInitResolve(null)
  setInitReject(null)
  clearInitTimer()
}

function handleResponseMessage(msg: SuccessResponse): void {
  const req = pending.get(msg.id)
  if (!req) {
    return
  }
  pending.delete(msg.id)
  dbDiagnosticRecorder.recordEnd(msg.id, 'success', msg.diagnostics)
  if (msg.changedTables) {
    const enrichedHint: ChangeHint = {
      ...msg.changeHint,
      changedTables: msg.changedTables,
    }
    for (const table of msg.changedTables) {
      getNotifyChangeCallback()?.(table, enrichedHint)
    }
  }
  req.resolve(msg.result, msg.durationMs)
}

function handleErrorMessage(msg: ErrorResponse): void {
  const initReject = getInitReject()
  if (msg.id === -1 && initReject) {
    initReject(new Error(msg.error))
    setInitReject(null)
    setInitResolve(null)
    clearInitTimer()
    return
  }
  const req = pending.get(msg.id)
  if (!req) {
    return
  }
  pending.delete(msg.id)
  dbDiagnosticRecorder.recordEnd(msg.id, 'error', msg.diagnostics)
  req.reject(new Error(msg.error))
}

function handleSlowQueryLogsMessage(msg: SlowQueryLogMessage): void {
  getSlowQueryLogCallback()?.(msg.logs)
}

function handleDbRecoveredMessage(msg: DbRecoveredMessage): void {
  console.warn(
    `SQLite: database recovered at runtime (${msg.method}): ${msg.reason}`,
  )
  for (const table of ALL_TABLE_NAMES) {
    if (isTableName(table)) {
      getNotifyChangeCallback()?.(table)
    }
  }
}

export function handleMessage(event: MessageEvent<WorkerMessage>): void {
  const msg = event.data

  switch (msg.type) {
    case 'init':
      handleInitMessage(msg)
      break
    case 'response':
      handleResponseMessage(msg)
      break
    case 'error':
      handleErrorMessage(msg)
      break
    case 'slowQueryLogs':
      handleSlowQueryLogsMessage(msg)
      break
    case 'db-recovered':
      handleDbRecoveredMessage(msg)
      break
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
