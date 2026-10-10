/**
 * SQLite OPFS Worker エントリーポイント
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで SQLite を初期化し、
 * メインスレッドからの RPC メッセージを処理する。
 *
 * 各処理は個別モジュールに分割済み:
 *   - workerState.ts          — 共有 mutable state / テーブルバージョン管理
 *   - workerInit.ts           — OPFS 初期化フォールバックチェーン
 *   - workerExecHandlers.ts   — 汎用 exec / execBatch
 *   - workerExportHandler.ts  — DB エクスポート
 *   - workerMessageHelpers.ts — sendResponse / sendError
 *   - workerFetchTimelineHandler.ts — Timeline 一括取得
 */

/// <reference lib="webworker" />

import { executeFlatFetch as runFlatFetch } from '../../query-ir/executor/flatFetchExecutor'
import {
  executeGraphPlan as runGraphPlan,
  syncGraphCacheVersions,
} from '../../query-ir/executor/graphExecutor'
import { buildTimelineKey, resolveLocalAccountId } from '../helpers'
import type { WorkerMessage, WorkerRequest } from '../protocol'
import { ALL_TABLE_NAMES } from '../protocol'
import {
  isReadOnlySql,
  executeQueryPlan as runQueryPlan,
} from '../queries/executionEngine'
import { handleUpdateNotificationReadState } from './handlers/notificationReadHandlers'
import { resolvePostIdInternal } from './handlers/statusHelpers'
import {
  DEFAULT_MAX_NOTIFICATIONS,
  DEFAULT_MAX_POSTS,
  DEFAULT_MAX_TIMELINE_ENTRIES,
  handleEnforceMaxLength,
} from './workerCleanup'
import { beginWorkerDiagnostics } from './workerDiagnostics'
import { handleExec, handleExecBatch } from './workerExecHandlers'
import { handleExportDatabase } from './workerExportHandler'
import { handleFetchTimeline } from './workerFetchTimelineHandler'
import { init } from './workerInit'
import { sendError, sendResponse } from './workerMessageHelpers'
import {
  handleAddNotification,
  handleBulkAddNotifications,
  handleUpdateNotificationStatusAction,
} from './workerNotificationStore'
import { isSqliteCorruptError, recoverFromCorruption } from './workerRecovery'
import {
  bumpTableVersions,
  captureTableVersions,
  getDb,
  getSqlite3Module,
  getTableVersionsMap,
} from './workerState'
import {
  handleBulkUpsertCustomEmojis,
  handleBulkUpsertStatuses,
  handleDeleteEvent,
  handleEnsureLocalAccount,
  handleRemoveFromTimeline,
  handleToggleReaction,
  handleUpdateStatus,
  handleUpdateStatusAction,
  handleUpsertStatus,
} from './workerStatusStore'

// ランタイムリカバリ中フラグ — true の間は RPC メッセージを拒否する
let recoveryInProgress = false

// ================================================================
// メッセージルーター
// ================================================================

type WorkerDb = NonNullable<ReturnType<typeof getDb>>

function handleWorkerInitMessage(origin: string): void {
  init(origin)
    .then((result) => {
      const initMsg: WorkerMessage = {
        persistence: result.persistence,
        recovered: result.recovered,
        type: 'init',
      }
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
}

function handleExportDatabaseMessage(id: number): void {
  try {
    const db = getDb()
    const measuredDb = db ? beginWorkerDiagnostics(id, db) : db
    handleExportDatabase(measuredDb ?? undefined)
      .then(() => sendResponse(id, { ok: true }))
      .catch((e) => sendError(id, e))
  } catch (e) {
    sendError(id, e)
  }
}

function dispatchWorkerRequest(msg: WorkerRequest, db: WorkerDb): void {
  switch (msg.type) {
    // ---- 汎用 ----
    case 'exec': {
      try {
        const { result, durationMs } = handleExec(
          msg.sql,
          msg.bind,
          msg.returnValue,
          db,
        )
        sendResponse(msg.id, result, undefined, durationMs)
      } finally {
        if (!isReadOnlySql(msg.sql)) {
          bumpTableVersions([...ALL_TABLE_NAMES])
        }
      }
      break
    }

    case 'execBatch': {
      const hasMutation = msg.statements.some((s) => !isReadOnlySql(s.sql))
      try {
        const result = handleExecBatch(
          msg.statements,
          msg.rollbackOnError,
          msg.returnIndices,
          db,
        )
        sendResponse(msg.id, result)
      } finally {
        if (hasMutation) {
          bumpTableVersions([...ALL_TABLE_NAMES])
        }
      }
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
        msg.skipProfileUpdate,
      )
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        tag: msg.tag,
        timelineType: msg.timelineType,
      })
      break
    }

    case 'updateStatusAction': {
      const localAccountId = resolveLocalAccountId(db, msg.backendUrl)
      if (localAccountId == null) {
        sendResponse(msg.id, { ok: true }, [])
        break
      }
      const r = handleUpdateStatusAction(
        db,
        localAccountId,
        msg.statusId,
        msg.action,
        msg.value,
      )
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        changedPostIds: r.changedPostIds,
      })
      break
    }

    case 'updateStatus': {
      const r = handleUpdateStatus(db, msg.statusJson, msg.backendUrl)
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
      })
      break
    }

    case 'handleDeleteEvent': {
      const localAccountId = resolveLocalAccountId(db, msg.backendUrl)
      if (localAccountId == null) {
        sendResponse(msg.id, { ok: true }, [])
        break
      }
      const r = handleDeleteEvent(db, localAccountId, msg.statusId)
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        tag: msg.tag,
        timelineType: msg.sourceTimelineType,
      })
      break
    }

    case 'removeFromTimeline': {
      const localAccountId = resolveLocalAccountId(db, msg.backendUrl)
      if (localAccountId == null) {
        sendResponse(msg.id, { ok: true }, [])
        break
      }
      const timelineKey = buildTimelineKey(msg.timelineType, { tag: msg.tag })
      const postId = resolvePostIdInternal(db, localAccountId, msg.statusId)
      if (postId == null) {
        sendResponse(msg.id, { ok: true }, [])
        break
      }
      const r = handleRemoveFromTimeline(
        db,
        localAccountId,
        timelineKey,
        postId,
      )
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        tag: msg.tag,
        timelineType: msg.timelineType,
      })
      break
    }

    // ---- Notification 専用ハンドラ ----
    case 'updateNotificationReadState': {
      const result = handleUpdateNotificationReadState(db, msg)
      sendResponse(msg.id, { ok: true }, result.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        reason: 'notification-read',
      })
      break
    }
    case 'addNotification': {
      const r = handleAddNotification(db, msg.notificationJson, msg.backendUrl)
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        reason: r.reason,
      })
      break
    }

    case 'bulkAddNotifications': {
      const r = handleBulkAddNotifications(
        db,
        msg.notificationsJson,
        msg.backendUrl,
      )
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        reason: r.reason,
      })
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
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        changedPostIds: r.changedPostIds,
      })
      break
    }

    // ---- Cleanup ----
    case 'enforceMaxLength': {
      const r = handleEnforceMaxLength(
        db,
        DEFAULT_MAX_TIMELINE_ENTRIES,
        DEFAULT_MAX_NOTIFICATIONS,
        DEFAULT_MAX_POSTS,
        {
          batchLimit: msg.batchLimit,
          mode: msg.mode,
          targetCounts: msg.targetCounts,
          targetRatio: msg.targetRatio,
        },
      )
      sendResponse(
        msg.id,
        {
          deletedCounts: r.deletedCounts,
          hasMore: r.hasMore,
          ok: true,
          phaseTimings: r.phaseTimings,
          targetCounts: r.targetCounts,
        },
        r.changedTables,
      )
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
      const localAccountId = resolveLocalAccountId(db, msg.backendUrl)
      if (localAccountId == null) {
        sendResponse(msg.id, { ok: true }, [])
        break
      }
      const r = handleToggleReaction(
        db,
        localAccountId,
        msg.statusId,
        msg.value,
        msg.emoji,
      )
      sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
        backendUrl: msg.backendUrl,
        changedPostIds: r.changedPostIds,
      })
      break
    }

    // ---- Custom Emoji Catalog ----
    case 'bulkUpsertCustomEmojis': {
      const r = handleBulkUpsertCustomEmojis(db, msg.backendUrl, msg.emojisJson)
      sendResponse(msg.id, { ok: true }, r.changedTables)
      break
    }

    // ---- ExecutionPlan 汎用実行 ----
    case 'executeQueryPlan': {
      const result = runQueryPlan(db, msg.plan)
      const resultWithVersions = {
        ...result,
        capturedVersions: captureTableVersions(),
      }
      sendResponse(
        msg.id,
        resultWithVersions,
        undefined,
        result.totalDurationMs,
      )
      break
    }

    // ---- GraphPlan 実行 (V2 グラフエンジン) ----
    case 'executeGraphPlan': {
      syncGraphCacheVersions(getTableVersionsMap())
      const result = runGraphPlan(
        db,
        msg.plan,
        msg.options,
        captureTableVersions,
      )
      sendResponse(msg.id, result, undefined, result.meta.totalDurationMs)
      break
    }

    // ---- FlatFetch 実行（フロー実行で事前フィルタ済み ID → Entity 組み立て）----
    case 'executeFlatFetch': {
      const result = runFlatFetch(db, msg.request)
      sendResponse(msg.id, result, undefined, result.meta.totalDurationMs)
      break
    }

    // ---- Timeline 一括取得 ----
    case 'fetchTimeline': {
      const result = handleFetchTimeline(msg, db)
      sendResponse(msg.id, result)
      break
    }

    default: {
      const unknownMsg = msg as { id: number; type: string }
      sendError(unknownMsg.id, `Unknown message type: ${unknownMsg.type}`)
    }
  }
}

/** 診断でキャッシュ計測対象とするグラフノード ID を返す */
function diagnosticCacheNodeIds(msg: WorkerRequest): string[] {
  if (msg.type !== 'executeGraphPlan') return []
  return msg.plan.nodes
    .filter(
      (n) => n.node.kind === 'get-ids' || n.node.kind === 'lookup-related',
    )
    .map((n) => n.id)
}

globalThis.onmessage = (
  event: MessageEvent<WorkerRequest | { type: '__init'; origin: string }>,
) => {
  const msg = event.data

  if (msg.type === '__init') {
    handleWorkerInitMessage(msg.origin)
    return
  }

  if (msg.type === 'exportDatabase') {
    handleExportDatabaseMessage(msg.id)
    return
  }

  if (recoveryInProgress) {
    sendError(msg.id, 'Database recovery in progress')
    return
  }

  try {
    const db = getDb()
    const measuredDb = db
      ? beginWorkerDiagnostics(msg.id, db, diagnosticCacheNodeIds(msg))
      : db

    dispatchWorkerRequest(msg, measuredDb ?? db)
  } catch (e) {
    sendError(msg.id, e)

    if (!recoveryInProgress && isSqliteCorruptError(e)) {
      recoveryInProgress = true
      console.warn(
        'SQLite Worker: SQLITE_CORRUPT detected at runtime, starting recovery...',
      )
      performRuntimeRecovery()
    }
  }
}

/**
 * ランタイムでの SQLITE_CORRUPT リカバリ。
 * バックアップ復元を試み、失敗したら空 DB にリセットする。
 * 完了後、メインスレッドに db-recovered メッセージを送信して全テーブルの再描画を促す。
 */
async function performRuntimeRecovery(): Promise<void> {
  const db = getDb()
  const sqlite3 = getSqlite3Module()
  if (!db || !sqlite3) {
    recoveryInProgress = false
    return
  }

  try {
    const result = await recoverFromCorruption(db, sqlite3)

    // リカバリ後にヘルスチェック
    const { isDatabaseHealthy } = await import('./workerRecovery')
    const healthy = isDatabaseHealthy(db)
    if (!healthy) {
      console.error(
        'SQLite Worker: runtime recovery completed but DB still corrupt',
      )
    }

    // 全テーブルのバージョンをバンプしてキャッシュを無効化
    bumpTableVersions([...ALL_TABLE_NAMES])

    let reason: string
    if (result === 'restored') {
      reason = 'Restored from backup'
    } else if (result === 'reset') {
      reason = 'Reset to empty database'
    } else {
      reason = 'Recovery failed'
    }

    const msg: WorkerMessage = {
      method: result,
      reason,
      type: 'db-recovered',
    }
    self.postMessage(msg)
  } catch (e) {
    console.error('SQLite Worker: runtime recovery failed:', e)
    const msg: WorkerMessage = {
      method: 'failed',
      reason: `Recovery error: ${e instanceof Error ? e.message : String(e)}`,
      type: 'db-recovered',
    }
    self.postMessage(msg)
  } finally {
    recoveryInProgress = false
  }
}

// 初期化はメインスレッドからの __init メッセージで開始される
