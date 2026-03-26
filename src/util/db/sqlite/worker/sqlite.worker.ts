/**
 * SQLite OPFS Worker エントリーポイント
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで SQLite を初期化し、
 * メインスレッドからの RPC メッセージを処理する。
 */

/// <reference lib="webworker" />

import { logSlowQueryExplain } from '../explainLogger'
import type { TableName, WorkerMessage, WorkerRequest } from '../protocol'
import { handleEnforceMaxLength } from './workerCleanup'
import {
  handleAddNotification,
  handleBulkAddNotifications,
  handleUpdateNotificationStatusAction,
} from './workerNotificationStore'
import {
  handleBulkUpsertStatuses,
  handleDeleteEvent,
  handleEnsureLocalAccount,
  handleRemoveFromTimeline,
  handleSyncFollows,
  handleToggleReaction,
  handleUpdateStatus,
  handleUpdateStatusAction,
  handleUpsertStatus,
} from './workerStatusStore'

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type RawDb = any

let db: RawDb = null
// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
let sqlite3Module: any = null

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
  sqlite3Module = sqlite3

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
): { result: unknown; durationMs: number } {
  const start = performance.now()
  let result: unknown
  if (returnValue === 'resultRows') {
    result = db.exec(sql, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    })
  } else {
    db.exec(sql, { bind: bind ?? undefined })
    result = undefined
  }
  const durationMs = performance.now() - start
  logSlowQueryExplain(db, sql, bind, durationMs)
  return { durationMs, result }
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
      const { result } = handleExec(stmt.sql, stmt.bind, stmt.returnValue)
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
// DB エクスポート（単一 sqlite3 ファイルとして OPFS に保存）
// ================================================================

async function handleExportDatabase(): Promise<void> {
  if (!db || !sqlite3Module) {
    throw new Error('Database or sqlite3 module not initialized')
  }

  // WAL をフラッシュ
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);')

  // DB をシリアライズ
  const bytes: Uint8Array = sqlite3Module.capi.sqlite3_js_db_export(db)
  // 新しい ArrayBuffer にコピー（TypeScript 型互換性対策）
  const copy = new Uint8Array(bytes)

  // OPFS ルートに書き込み
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle('miyulab-fe-backup.sqlite3', {
    create: true,
  })
  const writable = await fileHandle.createWritable()
  await writable.write(copy.buffer as ArrayBuffer)
  await writable.close()

  console.info(
    `SQLite Worker: exported database (${(bytes.byteLength / 1024).toFixed(1)} KB) to OPFS`,
  )
}

// ================================================================
// メッセージルーター
// ================================================================

function sendResponse(
  id: number,
  result: unknown,
  changedTables?: TableName[],
  durationMs?: number,
  changeHint?: { timelineType?: string; backendUrl?: string; tag?: string },
): void {
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

  // 非同期コマンド: DB エクスポート
  if (msg.type === 'exportDatabase') {
    handleExportDatabase()
      .then(() => sendResponse(msg.id, { ok: true }))
      .catch((e) => sendError(msg.id, e))
    return
  }

  try {
    switch (msg.type) {
      // ---- 汎用 ----
      case 'exec': {
        const { result, durationMs } = handleExec(
          msg.sql,
          msg.bind,
          msg.returnValue,
        )
        sendResponse(msg.id, result, undefined, durationMs)
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
        sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
          backendUrl: msg.backendUrl,
          tag: msg.tag,
          timelineType: msg.timelineType,
        })
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
        sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
          backendUrl: msg.backendUrl,
          tag: msg.tag,
          timelineType: msg.timelineType,
        })
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
        sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
          backendUrl: msg.backendUrl,
          tag: msg.tag,
          timelineType: msg.sourceTimelineType,
        })
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
        sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
          backendUrl: msg.backendUrl,
          tag: msg.tag,
          timelineType: msg.timelineType,
        })
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

      // ---- Follows ----
      case 'syncFollows': {
        const r = handleSyncFollows(db, msg.backendUrl, msg.accountsJson)
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Local Account ----
      case 'ensureLocalAccount': {
        const r = handleEnsureLocalAccount(db, msg.backendUrl, msg.accountJson)
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Reaction ----
      case 'toggleReaction': {
        const r = handleToggleReaction(
          db,
          msg.backendUrl,
          msg.statusId,
          msg.value,
          msg.emoji,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Timeline 一括取得 ----
      case 'fetchTimeline': {
        const start = performance.now()

        // Phase1
        const phase1Rows = db.exec(msg.phase1.sql, {
          bind: msg.phase1.bind,
          returnValue: 'resultRows',
        }) as (string | number | null)[][]

        const postIds = phase1Rows.map(
          (row: (string | number | null)[]) => row[0] as number,
        )
        if (postIds.length === 0) {
          sendResponse(msg.id, {
            batchResults: {
              belongingTags: [],
              customEmojis: [],
              engagements: [],
              media: [],
              mentions: [],
              polls: [],
              timelineTypes: [],
            },
            phase1Rows,
            phase2Rows: [],
            totalDurationMs: performance.now() - start,
          })
          break
        }

        // Phase2
        const placeholders = postIds.map(() => '?').join(',')
        const phase2Sql = msg.phase2BaseSql.replaceAll('{IDS}', placeholders)
        const phase2Rows = db.exec(phase2Sql, {
          bind: postIds,
          returnValue: 'resultRows',
        }) as (string | number | null)[][]

        // reblog post_id を収集
        const reblogColIdx = msg.reblogPostIdColumnIndex ?? 27
        const reblogPostIds: number[] = []
        for (const row of phase2Rows) {
          const rbId = row[reblogColIdx] as number | null
          if (rbId !== null) reblogPostIds.push(rbId)
        }
        const allPostIds = [...new Set([...postIds, ...reblogPostIds])]
        const allPlaceholders = allPostIds.map(() => '?').join(',')

        // Batch 7本を同期実行
        const runBatch = (sql: string) =>
          db.exec(sql.replaceAll('{IDS}', allPlaceholders), {
            bind: allPostIds,
            returnValue: 'resultRows',
          }) as (string | number | null)[][]

        const batchResults = {
          belongingTags: runBatch(msg.batchSqls.belongingTags),
          customEmojis: runBatch(msg.batchSqls.customEmojis),
          engagements: runBatch(msg.batchSqls.engagements),
          media: runBatch(msg.batchSqls.media),
          mentions: runBatch(msg.batchSqls.mentions),
          polls: runBatch(msg.batchSqls.polls),
          timelineTypes: runBatch(msg.batchSqls.timelineTypes),
        }

        sendResponse(msg.id, {
          batchResults,
          phase1Rows,
          phase2Rows,
          totalDurationMs: performance.now() - start,
        })
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
