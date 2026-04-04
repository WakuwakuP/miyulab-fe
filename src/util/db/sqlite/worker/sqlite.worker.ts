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
import { executeQueryPlan as runQueryPlan } from '../queries/executionEngine'
import { resolvePostIdInternal } from './handlers/statusHelpers'
import { handleEnforceMaxLength } from './workerCleanup'
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
import { captureTableVersions, getDb, getTableVersionsMap } from './workerState'
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

// ================================================================
// メッセージルーター
// ================================================================

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

  const db = getDb()

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
      case 'addNotification': {
        const r = handleAddNotification(
          db,
          msg.notificationJson,
          msg.backendUrl,
        )
        sendResponse(msg.id, { ok: true }, r.changedTables, undefined, {
          backendUrl: msg.backendUrl,
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
        })
        break
      }

      // ---- Cleanup ----
      case 'enforceMaxLength': {
        const r = handleEnforceMaxLength(db)
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
        sendResponse(msg.id, { ok: true }, r.changedTables)
        break
      }

      // ---- Custom Emoji Catalog ----
      case 'bulkUpsertCustomEmojis': {
        const r = handleBulkUpsertCustomEmojis(
          db,
          msg.backendUrl,
          msg.emojisJson,
        )
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
        const result = handleFetchTimeline(msg)
        sendResponse(msg.id, result)
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
