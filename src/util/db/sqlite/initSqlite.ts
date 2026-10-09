/**
 * SQLite 初期化モジュール — Worker モード + フォールバックモード
 *
 * Worker モード: Dedicated Worker + OPFS SAH Pool VFS で永続化する。
 * フォールバックモード: Worker が使えない場合はメインスレッド + インメモリ DB。
 *
 * いずれの場合も同一の DbHandle インターフェースを提供する。
 */

import { dbDiagnosticRecorder } from '../dbDiagnostics'
import type { ChangeHint } from './connection'
import { logSlowQueryExplain } from './explainLogger'
import { buildTimelineKey, resolveLocalAccountId } from './helpers'
import type {
  SendCommandPayload,
  SqliteResultRow,
  SqliteResultRows,
  TableName,
} from './protocol'
import { ALL_TABLE_NAMES } from './protocol'
import { isReadOnlySql } from './queries/executionEngine'
import { batchBindForIds } from './queries/statusBatch'
import { loadSqliteWasmInitializer } from './sqliteWasmLoader'
import type { DbHandle } from './types'
import { handleUpdateNotificationReadState } from './worker/handlers/notificationReadHandlers'
import { resolvePostIdInternal } from './worker/handlers/statusHelpers'
import type { DbExec } from './worker/handlers/types'

export type { DbHandle }

const EMPTY_CHANGED_TABLES = { changedTables: [] as const }

function withLocalAccountId<T>(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm Database overload compat
  db: any,
  backendUrl: string,
  handler: (localAccountId: number) => T,
): T | typeof EMPTY_CHANGED_TABLES {
  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId == null) {
    return EMPTY_CHANGED_TABLES
  }
  return handler(localAccountId)
}

function buildChangeHint(command: SendCommandPayload): ChangeHint | undefined {
  switch (command.type) {
    case 'updateNotificationReadState':
      return { backendUrl: command.backendUrl, reason: 'notification-read' }
    case 'upsertStatus':
    case 'bulkUpsertStatuses':
    case 'removeFromTimeline':
      return {
        backendUrl: command.backendUrl,
        tag: command.tag,
        timelineType: command.timelineType,
      }
    case 'handleDeleteEvent':
      return {
        backendUrl: command.backendUrl,
        tag: command.tag,
        timelineType: command.sourceTimelineType,
      }
    case 'updateStatus':
    case 'updateStatusAction':
    case 'toggleReaction':
    case 'addNotification':
    case 'bulkAddNotifications':
    case 'updateNotificationStatusAction':
      return {
        backendUrl: command.backendUrl,
      }
    default:
      return undefined
  }
}

let dbPromise: Promise<DbHandle> | null = null

/**
 * DbHandle をシングルトンで取得する。
 *
 * @param onNotify - changedTables 通知コールバック（connection.ts から渡される）
 */
export async function getDb(
  onNotify: (table: TableName, hint?: ChangeHint) => void,
): Promise<DbHandle> {
  if (dbPromise) return dbPromise
  dbPromise = initDb(onNotify)
  return dbPromise
}

async function initDb(
  onNotify: (table: TableName, hint?: ChangeHint) => void,
): Promise<DbHandle> {
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
  onNotify: (table: TableName, hint?: ChangeHint) => void,
): Promise<DbHandle> {
  const {
    initWorker,
    execAsync,
    execAsyncTimed,
    execBatch,
    executeFlatFetch,
    executeQueryPlan,
    executeGraphPlan,
    sendCommand,
    cancelStaleRequests,
    fetchTimeline,
  } = await import('./workerClient')

  const persistence = await initWorker(onNotify)

  return {
    cancelStaleRequests,
    execAsync,
    execAsyncTimed,
    execBatch,
    executeFlatFetch,
    executeGraphPlan,
    executeQueryPlan,
    fetchTimeline,
    persistence,
    sendCommand,
  }
}

// ================================================================
// フォールバックモード（メインスレッド + インメモリ DB）
// ================================================================

async function initMainThreadFallback(
  onNotify: (table: TableName, hint?: ChangeHint) => void,
): Promise<DbHandle> {
  // Turbopack が import.meta.url を無効なスキームに書き換えるため、
  // Emscripten 内部の XHR/fetch が失敗する。
  // WASM バイナリを事前に fetch して wasmBinary で直接渡すことで回避。
  const origin = globalThis.location?.origin ?? ''
  const wasmResponse = await fetch(`${origin}/sqlite3.wasm`)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const initSqlite = await loadSqliteWasmInitializer(origin)
  // @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
  const sqlite3 = await initSqlite({
    locateFile: (file: string) => `${origin}/${file}`,
    wasmBinary,
  })
  const rawDb = new sqlite3.oo1.DB(':memory:', 'c')

  rawDb.exec('PRAGMA journal_mode=WAL;')
  rawDb.exec('PRAGMA synchronous=NORMAL;')
  rawDb.exec('PRAGMA foreign_keys = ON;')
  rawDb.exec('PRAGMA cache_size = -8000;') // 8MB（デフォルト2MB→8MB）
  rawDb.exec('PRAGMA temp_store = MEMORY;') // 一時テーブルをメモリに配置

  // スキーマ初期化
  const { ensureSchema } = await import('./schema')
  // sqlite-wasm の exec は戻り値ごとの overload なので、
  // スキーマ層が使う狭いインターフェースへ明示的に変換する。
  const schemaDb: import('./worker/workerSchema').SchemaDbHandle['db'] = {
    exec: (sql, opts) => {
      if (opts?.returnValue === 'resultRows') {
        return rawDb.exec(sql, {
          bind: opts.bind,
          returnValue: 'resultRows',
        })
      }
      if (opts?.bind !== undefined) {
        return rawDb.exec(sql, { bind: opts.bind })
      }
      return rawDb.exec(sql)
    },
  }
  ensureSchema({ db: schemaDb })

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
    handleEnsureLocalAccount,
    handleToggleReaction,
    handleBulkUpsertCustomEmojis,
  } = await import('./worker/workerStatusStore')
  const {
    handleAddNotification,
    handleBulkAddNotifications,
    handleUpdateNotificationStatusAction,
  } = await import('./worker/workerNotificationStore')
  const {
    DEFAULT_MAX_NOTIFICATIONS,
    DEFAULT_MAX_POSTS,
    DEFAULT_MAX_TIMELINE_ENTRIES,
    handleEnforceMaxLength,
  } = await import('./worker/workerCleanup')
  const {
    bumpAllGraphCacheVersions,
    bumpGraphCacheVersion,
    captureGraphCacheVersions,
    executeGraphPlan: runGraphPlan,
  } = await import('../query-ir/executor/graphExecutor')
  const createHandle = (db: DbExec): DbHandle => ({
    cancelStaleRequests: () => 0,
    execAsync: async (sql, opts) => {
      try {
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
      } finally {
        if (!isReadOnlySql(sql)) {
          bumpAllGraphCacheVersions(ALL_TABLE_NAMES)
        }
      }
    },

    execAsyncTimed: async (sql, opts) => {
      try {
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
      } finally {
        if (!isReadOnlySql(sql)) {
          bumpAllGraphCacheVersions(ALL_TABLE_NAMES)
        }
      }
    },

    execBatch: async (statements, opts) => {
      const hasMutation = statements.some((s) => !isReadOnlySql(s.sql))
      try {
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
      } finally {
        if (hasMutation) {
          bumpAllGraphCacheVersions(ALL_TABLE_NAMES)
        }
      }
    },

    executeFlatFetch: async (request) => {
      const { executeFlatFetch: runFlatFetch } = await import(
        '../query-ir/executor/flatFetchExecutor'
      )
      return runFlatFetch(db as never, request)
    },

    executeGraphPlan: async (plan, options) =>
      runGraphPlan(db as never, plan, options, captureGraphCacheVersions),

    executeQueryPlan: async (plan) => {
      const { executeQueryPlan: runPlan } = await import(
        './queries/executionEngine'
      )
      return runPlan(db as never, plan)
    },

    fetchTimeline: async (request) => {
      const start = performance.now()

      // Phase1
      const phase1Rows = db.exec(request.phase1.sql, {
        bind: request.phase1.bind ?? undefined,
        returnValue: 'resultRows',
      }) as SqliteResultRows

      const postIds = phase1Rows.map((row: SqliteResultRow) => row[0] as number)
      if (postIds.length === 0) {
        return {
          batchResults: {
            belongingTags: [],
            customEmojis: [],
            interactions: [],
            media: [],
            mentions: [],
            polls: [],
            profileEmojis: [],
            timelineTypes: [],
          },
          phase1Rows,
          phase2Rows: [],
          totalDurationMs: performance.now() - start,
        }
      }

      // Phase2
      const placeholders = postIds.map(() => '?').join(',')
      const phase2Sql = request.phase2BaseSql.replaceAll('{IDS}', placeholders)
      const phase2Rows = db.exec(phase2Sql, {
        bind: postIds,
        returnValue: 'resultRows',
      }) as SqliteResultRows

      // reblog post_id を収集
      const reblogColIdx = request.reblogPostIdColumnIndex ?? 25
      const reblogPostIds: number[] = []
      for (const row of phase2Rows) {
        const rbId = row[reblogColIdx] as number | null
        if (rbId !== null) reblogPostIds.push(rbId)
      }
      const allPostIds = [...new Set([...postIds, ...reblogPostIds])]
      const allPlaceholders = allPostIds.map(() => '?').join(',')

      // Batch 7本を同期実行
      const runBatch = (sql: string) => {
        const substituted = sql.replaceAll('{IDS}', allPlaceholders)
        return db.exec(substituted, {
          bind: batchBindForIds(substituted, allPostIds),
          returnValue: 'resultRows',
        }) as SqliteResultRows
      }

      const batchResults = {
        belongingTags: runBatch(request.batchSqls.belongingTags),
        customEmojis: runBatch(request.batchSqls.customEmojis),
        interactions: runBatch(request.batchSqls.interactions),
        media: runBatch(request.batchSqls.media),
        mentions: runBatch(request.batchSqls.mentions),
        polls: runBatch(request.batchSqls.polls),
        profileEmojis: runBatch(request.batchSqls.profileEmojis),
        timelineTypes: runBatch(request.batchSqls.timelineTypes),
      }

      return {
        batchResults,
        phase1Rows,
        phase2Rows,
        totalDurationMs: performance.now() - start,
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
          result = withLocalAccountId(
            db,
            command.backendUrl,
            (localAccountId) =>
              handleUpdateStatusAction(
                db,
                localAccountId,
                command.statusId,
                command.action,
                command.value,
              ),
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
          result = withLocalAccountId(
            db,
            command.backendUrl,
            (localAccountId) =>
              handleDeleteEvent(db, localAccountId, command.statusId),
          )
          break
        case 'removeFromTimeline':
          result = withLocalAccountId(
            db,
            command.backendUrl,
            (localAccountId) => {
              const timelineKey = buildTimelineKey(command.timelineType, {
                tag: command.tag,
              })
              const postId = resolvePostIdInternal(
                db,
                localAccountId,
                command.statusId,
              )
              if (postId == null) {
                return EMPTY_CHANGED_TABLES
              }
              return handleRemoveFromTimeline(
                db,
                localAccountId,
                timelineKey,
                postId,
              )
            },
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
        case 'updateNotificationReadState':
          result = handleUpdateNotificationReadState(db, command)
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
        case 'enforceMaxLength': {
          const r = handleEnforceMaxLength(
            db,
            DEFAULT_MAX_TIMELINE_ENTRIES,
            DEFAULT_MAX_NOTIFICATIONS,
            DEFAULT_MAX_POSTS,
            {
              batchLimit: command.batchLimit,
              mode: command.mode,
              targetCounts: command.targetCounts,
              targetRatio: command.targetRatio,
            },
          )
          result = {
            changedTables: r.changedTables,
            deletedCounts: r.deletedCounts,
            hasMore: r.hasMore,
            phaseTimings: r.phaseTimings,
            targetCounts: r.targetCounts,
          }
          break
        }
        case 'ensureLocalAccount':
          result = handleEnsureLocalAccount(
            db,
            command.backendUrl,
            command.accountJson,
          )
          break

        case 'toggleReaction':
          result = withLocalAccountId(
            db,
            command.backendUrl,
            (localAccountId) =>
              handleToggleReaction(
                db,
                localAccountId,
                command.statusId,
                command.value,
                command.emoji,
              ),
          )
          break

        case 'bulkUpsertCustomEmojis':
          result = handleBulkUpsertCustomEmojis(
            db,
            command.backendUrl,
            command.emojisJson,
          )
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
      // changedTables があれば notifyChange を発火（Plan B: ヒント付き）
      if (result?.changedTables) {
        const baseHint = buildChangeHint(command)
        const resultPostIds = (
          result as { changedPostIds?: readonly number[] } | undefined
        )?.changedPostIds
        const hint: ChangeHint | undefined = baseHint
          ? {
              ...baseHint,
              changedPostIds: resultPostIds,
              changedTables: result.changedTables,
              reason: result.reason ?? baseHint.reason,
            }
          : undefined
        for (const table of result.changedTables as TableName[]) {
          bumpGraphCacheVersion(table)
          onNotify(table, hint)
        }
      }
      return result
    },
  })

  dbDiagnosticRecorder.setEnvironment('main-thread', 'memory')
  const { beginWorkerDiagnostics, finishWorkerDiagnostics } = await import(
    './worker/workerDiagnostics'
  )

  let fallbackRequestId = 0
  const invokeMeasured = async <T>(
    kind: 'priority' | 'other' | 'timeline',
    message: Record<string, unknown>,
    cacheNodeIds: string[],
    call: (measuredDb: DbExec) => T | Promise<T>,
  ): Promise<T> => {
    const id = --fallbackRequestId
    dbDiagnosticRecorder.recordEnqueue(id, message, kind)
    dbDiagnosticRecorder.recordStart(id)
    const measuredDb = beginWorkerDiagnostics(id, db, cacheNodeIds)
    try {
      const result = await call(measuredDb)
      dbDiagnosticRecorder.recordEnd(
        id,
        'success',
        finishWorkerDiagnostics(id, result),
      )
      return result
    } catch (e) {
      dbDiagnosticRecorder.recordEnd(id, 'error', finishWorkerDiagnostics(id))
      throw e
    }
  }

  const handle: DbHandle = {
    cancelStaleRequests: () => 0,
    execAsync: (sql, opts) =>
      invokeMeasured(
        opts?.kind ?? 'other',
        { sql, type: 'exec' },
        [],
        (measuredDb) => createHandle(measuredDb).execAsync(sql, opts),
      ),
    execAsyncTimed: (sql, opts) =>
      invokeMeasured(
        opts?.kind ?? 'other',
        { sql, type: 'exec' },
        [],
        (measuredDb) => createHandle(measuredDb).execAsyncTimed(sql, opts),
      ),
    execBatch: (statements, opts) =>
      invokeMeasured(
        'other',
        { statements, type: 'execBatch' },
        [],
        (measuredDb) => createHandle(measuredDb).execBatch(statements, opts),
      ),
    executeFlatFetch: (request, sessionTag) =>
      invokeMeasured(
        'timeline',
        { type: 'executeFlatFetch' },
        [],
        (measuredDb) =>
          createHandle(measuredDb).executeFlatFetch(request, sessionTag),
      ),
    executeGraphPlan: (plan, options, sessionTag) =>
      invokeMeasured(
        'timeline',
        { type: 'executeGraphPlan' },
        plan.nodes
          .filter(
            (n) =>
              n.node.kind === 'get-ids' || n.node.kind === 'lookup-related',
          )
          .map((n) => n.id),
        (measuredDb) =>
          createHandle(measuredDb).executeGraphPlan(plan, options, sessionTag),
      ),
    executeQueryPlan: (plan, sessionTag) =>
      invokeMeasured(
        'timeline',
        { type: 'executeQueryPlan' },
        [],
        (measuredDb) =>
          createHandle(measuredDb).executeQueryPlan(plan, sessionTag),
      ),
    fetchTimeline: (request, sessionTag) =>
      invokeMeasured('timeline', { type: 'fetchTimeline' }, [], (measuredDb) =>
        createHandle(measuredDb).fetchTimeline(request, sessionTag),
      ),
    persistence: 'memory',
    sendCommand: (command, opts) =>
      invokeMeasured(opts?.kind ?? 'other', { ...command }, [], (measuredDb) =>
        createHandle(measuredDb).sendCommand(command),
      ),
  }

  return handle
}
