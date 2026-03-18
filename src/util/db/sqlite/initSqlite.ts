/**
 * SQLite 初期化モジュール — Worker モード + フォールバックモード
 *
 * Worker モード: Dedicated Worker + OPFS SAH Pool VFS で永続化する。
 * フォールバックモード: Worker が使えない場合はメインスレッド + インメモリ DB。
 *
 * いずれの場合も同一の DbHandle インターフェースを提供する。
 */

import { logSlowQueryExplain } from './explainLogger'
import type { TableName } from './protocol'
import type { DbHandle } from './types'

export type { DbHandle }

let dbPromise: Promise<DbHandle> | null = null

/**
 * DbHandle をシングルトンで取得する。
 *
 * @param onNotify - changedTables 通知コールバック（connection.ts から渡される）
 */
export async function getDb(
  onNotify: (table: TableName) => void,
): Promise<DbHandle> {
  if (dbPromise) return dbPromise
  dbPromise = initDb(onNotify)
  return dbPromise
}

async function initDb(onNotify: (table: TableName) => void): Promise<DbHandle> {
  // Worker が使えるなら Worker モードを試行
  if (typeof Worker !== 'undefined') {
    try {
      return await initWorkerMode(onNotify)
    } catch (e) {
      console.warn(
        'SQLite: Worker mode failed, falling back to main thread.',
        e,
      )
    }
  }

  // フォールバック: メインスレッド + インメモリ DB
  return await initMainThreadFallback(onNotify)
}

// ================================================================
// Worker モード
// ================================================================

async function initWorkerMode(
  onNotify: (table: TableName) => void,
): Promise<DbHandle> {
  const { initWorker, execAsync, execAsyncTimed, execBatch, sendCommand } =
    await import('./workerClient')

  const persistence = await initWorker(onNotify)

  return {
    execAsync,
    execAsyncTimed,
    execBatch,
    persistence,
    sendCommand,
  }
}

// ================================================================
// フォールバックモード（メインスレッド + インメモリ DB）
// ================================================================

async function initMainThreadFallback(
  onNotify: (table: TableName) => void,
): Promise<DbHandle> {
  // Turbopack が import.meta.url を無効なスキームに書き換えるため、
  // Emscripten 内部の XHR/fetch が失敗する。
  // WASM バイナリを事前に fetch して wasmBinary で直接渡すことで回避。
  const origin = globalThis.location?.origin ?? ''
  const wasmResponse = await fetch(`${origin}/sqlite3.wasm`)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  // @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
  const sqlite3 = await initSqlite({
    locateFile: (file: string) => `${origin}/${file}`,
    wasmBinary,
  })
  const rawDb = new sqlite3.oo1.DB(':memory:', 'c')

  rawDb.exec('PRAGMA journal_mode=WAL;')
  rawDb.exec('PRAGMA synchronous=NORMAL;')
  rawDb.exec('PRAGMA foreign_keys = ON;')

  // スキーマ初期化
  const { ensureSchema } = await import('./schema')
  ensureSchema({ db: rawDb } as import('./worker/workerSchema').SchemaDbHandle)

  console.warn(
    'SQLite: using in-memory fallback (no Worker). Data will not persist.',
  )

  // Worker 側のハンドラに渡す db は構造的に互換だが、
  // sqlite-wasm の Database 型は overload が多く直接代入できないため型アサーションを使う。
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm Database overload compat
  const db = rawDb as any

  // Worker 側のハンドラを直接インポートして使う
  const {
    handleUpsertStatus,
    handleBulkUpsertStatuses,
    handleUpdateStatusAction,
    handleUpdateStatus,
    handleDeleteEvent,
    handleRemoveFromTimeline,
  } = await import('./worker/workerStatusStore')
  const {
    handleAddNotification,
    handleBulkAddNotifications,
    handleUpdateNotificationStatusAction,
  } = await import('./worker/workerNotificationStore')
  const { handleEnforceMaxLength } = await import('./worker/workerCleanup')
  const handle: DbHandle = {
    execAsync: async (sql, opts) => {
      const start = performance.now()
      let result: unknown
      if (opts?.returnValue === 'resultRows') {
        result = db.exec(sql, {
          bind: opts.bind ?? undefined,
          returnValue: 'resultRows',
        })
      } else {
        db.exec(sql, { bind: opts?.bind ?? undefined })
        result = undefined
      }
      const durationMs = performance.now() - start
      logSlowQueryExplain(db, sql, opts?.bind, durationMs)
      return result
    },

    execAsyncTimed: async (sql, opts) => {
      const start = performance.now()
      let result: unknown
      if (opts?.returnValue === 'resultRows') {
        result = db.exec(sql, {
          bind: opts.bind ?? undefined,
          returnValue: 'resultRows',
        })
      } else {
        db.exec(sql, { bind: opts?.bind ?? undefined })
        result = undefined
      }
      const durationMs = performance.now() - start
      logSlowQueryExplain(db, sql, opts?.bind, durationMs)
      return { durationMs, result }
    },

    execBatch: async (statements, opts) => {
      const rollback = opts?.rollbackOnError ?? true
      const returnSet = new Set(opts?.returnIndices ?? [])
      if (rollback) db.exec('BEGIN;')
      try {
        const resultObj: Record<number, unknown> = {}
        for (let i = 0; i < statements.length; i++) {
          const s = statements[i]
          let val: unknown
          if (s.returnValue === 'resultRows') {
            val = db.exec(s.sql, {
              bind: s.bind ?? undefined,
              returnValue: 'resultRows',
            })
          } else {
            db.exec(s.sql, { bind: s.bind ?? undefined })
            val = undefined
          }
          if (returnSet.has(i) || !opts?.returnIndices) {
            resultObj[i] = val
          }
        }
        if (rollback) db.exec('COMMIT;')
        return resultObj
      } catch (e) {
        if (rollback) {
          try {
            db.exec('ROLLBACK;')
          } catch {
            /* ignore */
          }
        }
        throw e
      }
    },

    persistence: 'memory',

    sendCommand: async (command) => {
      // biome-ignore lint/suspicious/noExplicitAny: dispatch table
      let result: any
      switch (command.type) {
        case 'upsertStatus':
          result = handleUpsertStatus(
            db,
            command.statusJson,
            command.backendUrl,
            command.timelineType,
            command.tag,
          )
          break
        case 'bulkUpsertStatuses':
          result = handleBulkUpsertStatuses(
            db,
            command.statusesJson,
            command.backendUrl,
            command.timelineType,
            command.tag,
          )
          break
        case 'updateStatusAction':
          result = handleUpdateStatusAction(
            db,
            command.backendUrl,
            command.statusId,
            command.action,
            command.value,
          )
          break
        case 'updateStatus':
          result = handleUpdateStatus(
            db,
            command.statusJson,
            command.backendUrl,
          )
          break
        case 'handleDeleteEvent':
          result = handleDeleteEvent(
            db,
            command.backendUrl,
            command.statusId,
            command.sourceTimelineType,
            command.tag,
          )
          break
        case 'removeFromTimeline':
          result = handleRemoveFromTimeline(
            db,
            command.backendUrl,
            command.statusId,
            command.timelineType,
            command.tag,
          )
          break
        case 'addNotification':
          result = handleAddNotification(
            db,
            command.notificationJson,
            command.backendUrl,
          )
          break
        case 'bulkAddNotifications':
          result = handleBulkAddNotifications(
            db,
            command.notificationsJson,
            command.backendUrl,
          )
          break
        case 'updateNotificationStatusAction':
          result = handleUpdateNotificationStatusAction(
            db,
            command.backendUrl,
            command.statusId,
            command.action,
            command.value,
          )
          break
        case 'enforceMaxLength':
          result = handleEnforceMaxLength(db)
          break

        case 'exportDatabase':
          // インメモリモードではエクスポート不要
          result = { ok: true }
          break
        default:
          throw new Error(
            `Unknown command type: ${(command as { type: string }).type}`,
          )
      }
      // changedTables があれば notifyChange を発火
      if (result?.changedTables) {
        for (const table of result.changedTables as TableName[]) {
          onNotify(table)
        }
      }
      return result
    },
  }

  return handle
}
