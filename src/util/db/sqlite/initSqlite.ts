/**
 * SQLite 初期化モジュール — Worker モード + フォールバックモード
 *
 * Worker モード: Dedicated Worker + OPFS SAH Pool VFS で永続化する。
 * フォールバックモード: Worker が使えない場合はメインスレッド + インメモリ DB。
 *
 * いずれの場合も同一の DbHandle インターフェースを提供する。
 */

import type { ChangeHint } from './connection'
import { logSlowQueryExplain } from './explainLogger'
import { buildTimelineKey, resolveLocalAccountId } from './helpers'
import type { TableName } from './protocol'
import type { DbHandle } from './types'
import { resolvePostIdInternal } from './worker/handlers/statusHelpers'

export type { DbHandle }

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
    executeQueryPlan,
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
    handleEnsureLocalAccount,
    handleToggleReaction,
    handleBulkUpsertCustomEmojis,
  } = await import('./worker/workerStatusStore')
  const {
    handleAddNotification,
    handleBulkAddNotifications,
    handleUpdateNotificationStatusAction,
  } = await import('./worker/workerNotificationStore')
  const { handleEnforceMaxLength } = await import('./worker/workerCleanup')
  const handle: DbHandle = {
    cancelStaleRequests: () => 0,
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
      }) as (string | number | null)[][]

      const postIds = phase1Rows.map(
        (row: (string | number | null)[]) => row[0] as number,
      )
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
      }) as (string | number | null)[][]

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
      const runBatch = (sql: string) =>
        db.exec(sql.replaceAll('{IDS}', allPlaceholders), {
          bind: allPostIds,
          returnValue: 'resultRows',
        }) as (string | number | null)[][]

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
        case 'updateStatusAction': {
          const localAccountId = resolveLocalAccountId(db, command.backendUrl)
          if (localAccountId == null) {
            result = { changedTables: [] }
            break
          }
          result = handleUpdateStatusAction(
            db,
            localAccountId,
            command.statusId,
            command.action,
            command.value,
          )
          break
        }
        case 'updateStatus':
          result = handleUpdateStatus(
            db,
            command.statusJson,
            command.backendUrl,
          )
          break
        case 'handleDeleteEvent': {
          const localAccountId = resolveLocalAccountId(db, command.backendUrl)
          if (localAccountId == null) {
            result = { changedTables: [] }
            break
          }
          result = handleDeleteEvent(db, localAccountId, command.statusId)
          break
        }
        case 'removeFromTimeline': {
          const localAccountId = resolveLocalAccountId(db, command.backendUrl)
          if (localAccountId == null) {
            result = { changedTables: [] }
            break
          }
          const timelineKey = buildTimelineKey(command.timelineType, {
            tag: command.tag,
          })
          const postId = resolvePostIdInternal(
            db,
            localAccountId,
            command.statusId,
          )
          if (postId == null) {
            result = { changedTables: [] }
            break
          }
          result = handleRemoveFromTimeline(
            db,
            localAccountId,
            timelineKey,
            postId,
          )
          break
        }
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
        case 'ensureLocalAccount':
          result = handleEnsureLocalAccount(
            db,
            command.backendUrl,
            command.accountJson,
          )
          break

        case 'toggleReaction': {
          const localAccountId = resolveLocalAccountId(db, command.backendUrl)
          if (localAccountId == null) {
            result = { changedTables: [] }
            break
          }
          result = handleToggleReaction(
            db,
            localAccountId,
            command.statusId,
            command.value,
            command.emoji,
          )
          break
        }

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
        // コマンドの種類に応じてヒントを生成
        let hint: ChangeHint | undefined
        switch (command.type) {
          case 'upsertStatus':
          case 'bulkUpsertStatuses':
            hint = {
              backendUrl: command.backendUrl,
              tag: command.tag,
              timelineType: command.timelineType,
            }
            break
          case 'handleDeleteEvent':
            hint = {
              backendUrl: command.backendUrl,
              tag: command.tag,
              timelineType: command.sourceTimelineType,
            }
            break
          case 'removeFromTimeline':
            hint = {
              backendUrl: command.backendUrl,
              tag: command.tag,
              timelineType: command.timelineType,
            }
            break
        }
        for (const table of result.changedTables as TableName[]) {
          onNotify(table, hint)
        }
      }
      return result
    },
  }

  return handle
}
