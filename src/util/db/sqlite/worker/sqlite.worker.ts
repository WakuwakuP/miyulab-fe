/**
 * SQLite OPFS Worker エントリーポイント
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで SQLite を初期化し、
 * メインスレッドからの RPC メッセージを処理する。
 */

/// <reference lib="webworker" />

import type { TableName, WorkerMessage, WorkerRequest } from '../protocol'
import { handleEnforceMaxLength } from './workerCleanup'
import { handleMigrationWrite } from './workerMigration'
import {
  handleAddNotification,
  handleBulkAddNotifications,
  handleUpdateNotificationStatusAction,
} from './workerNotificationStore'
import {
  handleBulkUpsertStatuses,
  handleDeleteEvent,
  handleRemoveFromTimeline,
  handleUpdateStatus,
  handleUpdateStatusAction,
  handleUpsertStatus,
} from './workerStatusStore'

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type RawDb = any

let db: RawDb = null

// ================================================================
// 初期化
// ================================================================

async function init(origin: string): Promise<'opfs' | 'memory'> {
  // Turbopack が import.meta.url を無効なスキームに書き換えるため、
  // Worker 内の相対 URL 解決が失敗する。
  // メインスレッドから渡された origin を使い絶対 URL で WASM を取得する。
  const wasmUrl = `${origin}/sqlite3.wasm`
  const wasmResponse = await fetch(wasmUrl)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  // @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
  const sqlite3 = await initSqlite({
    locateFile: (file: string) => `${origin}/${file}`,
    wasmBinary,
  })

  let persistence: 'opfs' | 'memory' = 'memory'

  // 1. OPFS SAH Pool VFS（最高パフォーマンス）
  try {
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/miyulab-fe',
      name: 'opfs-sahpool',
    })
    db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
    persistence = 'opfs'
    console.info('SQLite Worker: using OPFS SAH Pool persistence')
  } catch (_e1) {
    // 2. 通常の OPFS
    try {
      db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      persistence = 'opfs'
      console.info('SQLite Worker: using OPFS persistence')
    } catch (_e2) {
      // 3. インメモリ DB フォールバック
      db = new sqlite3.oo1.DB(':memory:', 'c')
      persistence = 'memory'
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
      )
    }
  }

  // PRAGMA 設定
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // スキーマ初期化
  const { ensureSchema } = await import('../schema')
  ensureSchema({ db })

  return persistence
}

// ================================================================
// 汎用ハンドラ
// ================================================================

function handleExec(
  sql: string,
  bind?: (string | number | null)[],
  returnValue?: string,
): unknown {
  if (returnValue === 'resultRows') {
    return db.exec(sql, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    })
  }
  db.exec(sql, { bind: bind ?? undefined })
  return undefined
}

function handleExecBatch(
  statements: {
    sql: string
    bind?: (string | number | null)[]
    returnValue?: string
  }[],
  rollbackOnError: boolean,
  returnIndices?: number[],
): unknown {
  const results = new Map<number, unknown>()
  const shouldReturn = new Set(returnIndices ?? [])

  if (rollbackOnError) {
    db.exec('BEGIN;')
  }

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const result = handleExec(stmt.sql, stmt.bind, stmt.returnValue)
      if (shouldReturn.has(i) || !returnIndices) {
        results.set(i, result)
      }
    }

    if (rollbackOnError) {
      db.exec('COMMIT;')
    }
  } catch (e) {
    if (rollbackOnError) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* ロールバックエラーは無視 */
      }
    }
    throw e
  }

  const resultObj: Record<number, unknown> = {}
  for (const [k, v] of results) {
    resultObj[k] = v
  }
  return resultObj
}

// ================================================================
// メッセージルーター
// ================================================================

function sendResponse(
  id: number,
  result: unknown,
  changedTables?: TableName[],
): void {
  const response: WorkerMessage = {
    changedTables,
    id,
    result,
    type: 'response',
  }
  self.postMessage(response)
}

function sendError(id: number, error: unknown): void {
  const response: WorkerMessage = {
    error: error instanceof Error ? error.message : String(error),
    id,
    type: 'error',
  }
  self.postMessage(response)
}

self.onmessage = (
  event: MessageEvent<WorkerRequest | { type: '__init'; origin: string }>,
) => {
  const msg = event.data

  // メインスレッドから origin を受け取って初期化
  if (msg.type === '__init') {
    const { origin } = msg
    init(origin)
      .then((persistence) => {
        const initMsg: WorkerMessage = { persistence, type: 'init' }
        self.postMessage(initMsg)
      })
      .catch((e) => {
        console.error('SQLite Worker: initialization failed:', e)
        const errMsg: WorkerMessage = {
          error: e instanceof Error ? e.message : String(e),
          id: -1,
          type: 'error',
        }
        self.postMessage(errMsg)
      })
    return
  }

  try {
    switch (msg.type) {
      // ---- 汎用 ----
      case 'exec': {
        const result = handleExec(msg.sql, msg.bind, msg.returnValue)
        sendResponse(msg.id, result)
        break
      }

      case 'execBatch': {
        const result = handleExecBatch(
          msg.statements,
          msg.rollbackOnError,
          msg.returnIndices,
        )
        // execBatch は書き込み用なので changedTables を推定できないが、
        // 呼び出し元は主に muted_accounts / blocked_instances 等。
        // changedTables は個別コマンドで管理するので、ここでは返さない。
        sendResponse(msg.id, result)
        break
      }

      case 'ready': {
        sendResponse(msg.id, true)
        break
      }

      // ---- Status 専用ハンドラ ----
      case 'upsertStatus': {
        const r = handleUpsertStatus(
          db,
          msg.statusJson,
          msg.backendUrl,
          msg.timelineType,
          msg.tag,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'bulkUpsertStatuses': {
        const r = handleBulkUpsertStatuses(
          db,
          msg.statusesJson,
          msg.backendUrl,
          msg.timelineType,
          msg.tag,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'updateStatusAction': {
        const r = handleUpdateStatusAction(
          db,
          msg.backendUrl,
          msg.statusId,
          msg.action,
          msg.value,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'updateStatus': {
        const r = handleUpdateStatus(db, msg.statusJson, msg.backendUrl)
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'handleDeleteEvent': {
        const r = handleDeleteEvent(
          db,
          msg.backendUrl,
          msg.statusId,
          msg.sourceTimelineType,
          msg.tag,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'removeFromTimeline': {
        const r = handleRemoveFromTimeline(
          db,
          msg.backendUrl,
          msg.statusId,
          msg.timelineType,
          msg.tag,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Notification 専用ハンドラ ----
      case 'addNotification': {
        const r = handleAddNotification(
          db,
          msg.notificationJson,
          msg.backendUrl,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'bulkAddNotifications': {
        const r = handleBulkAddNotifications(
          db,
          msg.notificationsJson,
          msg.backendUrl,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      case 'updateNotificationStatusAction': {
        const r = handleUpdateNotificationStatusAction(
          db,
          msg.backendUrl,
          msg.statusId,
          msg.action,
          msg.value,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Cleanup ----
      case 'enforceMaxLength': {
        const r = handleEnforceMaxLength(db)
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Migration ----
      case 'migrationWrite': {
        const r = handleMigrationWrite(
          db,
          msg.statusBatches,
          msg.notificationBatches,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      default: {
        const unknownMsg = msg as { id: number; type: string }
        sendError(unknownMsg.id, `Unknown message type: ${unknownMsg.type}`)
      }
    }
  } catch (e) {
    sendError(msg.id, e)
  }
}

// 初期化はメインスレッドからの __init メッセージで開始される
