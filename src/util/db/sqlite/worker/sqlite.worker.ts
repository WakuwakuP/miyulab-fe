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
import { executeQueryPlan as runQueryPlan } from '../queries/executionEngine'
import { resolvePostIdInternal } from './handlers/statusHelpers'
import {
  DEFAULT_MAX_NOTIFICATIONS,
  DEFAULT_MAX_POSTS,
  DEFAULT_MAX_TIMELINE_ENTRIES,
  handleEnforceMaxLength,
} from './workerCleanup'
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

self.onmessage = (
  event: MessageEvent<WorkerRequest | { type: '__init'; origin: string }>,
) => {
  const msg = event.data

  // メインスレッドから origin を受け取って初期化
  if (msg.type === '__init') {
    const { origin } = msg
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
    return
  }

  // 非同期コマンド: DB エクスポート
  if (msg.type === 'exportDatabase') {
    handleExportDatabase()
      .then(() => sendResponse(msg.id, { ok: true }))
      .catch((e) => sendError(msg.id, e))
    return
  }

  // ランタイムリカバリ中は RPC を拒否
  if (recoveryInProgress) {
    sendError(msg.id, 'Database recovery in progress')
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
        const r = handleEnforceMaxLength(
          db,
          DEFAULT_MAX_TIMELINE_ENTRIES,
          DEFAULT_MAX_NOTIFICATIONS,
          DEFAULT_MAX_POSTS,
          {
            batchLimit: msg.batchLimit,
            mode: msg.mode,
            targetRatio: msg.targetRatio,
          },
        )
        sendResponse(
          msg.id,
          {
            deletedCounts: r.deletedCounts,
            hasMore: r.hasMore,
            ok: true,
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

    // ランタイム SQLITE_CORRUPT 検出 → 非同期リカバリ開始
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

    const reason =
      result === 'restored'
        ? 'Restored from backup'
        : result === 'reset'
          ? 'Reset to empty database'
          : 'Recovery failed'

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
