/**
 * 公開 API — Worker に対する型安全な RPC 呼び出し
 */

import type { QueueKind } from '../../dbQueue'
import { reportDequeue, stopSnapshotRecording } from '../../dbQueue'
import type {
  FlatFetchRequest,
  FlatFetchResult,
} from '../../query-ir/executor/flatFetchTypes'
import type {
  GraphExecuteOptions,
  GraphExecuteResult,
  SerializedGraphPlan,
} from '../../query-ir/executor/types'
import {
  getCachedIdCollect,
  setCachedIdCollect,
  syncTableVersions,
} from '../../query-ir/idCollectCache'
import type { ChangeHint } from '../connection'
import type {
  ExecBatchRequest,
  ExecRequest,
  FetchTimelineRequest,
  FetchTimelineResult,
  IdCollectResult,
  QueryPlanResult,
  SendCommandPayload,
  SerializedExecutionPlan,
  TableName,
} from '../protocol'
import { handleMessage } from './messageHandler'
import { sendRequest } from './queueManager'
import {
  durationForId,
  INIT_TIMEOUT_MS,
  incrementNextId,
  initPromise,
  initReject,
  initTimer,
  otherQueue,
  pending,
  setActiveRequest,
  setConsecutiveOther,
  setInitPromise,
  setInitReject,
  setInitResolve,
  setInitTimer,
  setNextId,
  setNotifyChangeCallback,
  setSlowQueryLogCallback,
  setWorker,
  timelineDedup,
  timelineQueue,
  worker,
} from './state'

// ================================================================
// 初期化
// ================================================================

/**
 * Worker を初期化する（1 回のみ）。
 *
 * @param onNotify - changedTables を元に呼ばれるコールバック
 * @returns 永続化方式 ('opfs' | 'memory')
 */
export function initWorker(
  onNotify: (table: TableName, hint?: ChangeHint) => void,
): Promise<'opfs' | 'memory'> {
  if (initPromise) return initPromise

  setNotifyChangeCallback(onNotify)

  const promise = new Promise<'opfs' | 'memory'>((resolve, reject) => {
    setInitResolve(resolve)
    setInitReject(reject)

    // Worker 初期化タイムアウト — init メッセージが来ない場合にフォールバックを有効にする
    setInitTimer(
      setTimeout(() => {
        if (initReject) {
          stopSnapshotRecording()
          initReject(
            new Error(
              `Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`,
            ),
          )
          setInitReject(null)
          setInitResolve(null)
          setInitTimer(null)
        }
      }, INIT_TIMEOUT_MS),
    )

    try {
      const w = new Worker(
        new URL('../worker/sqlite.worker.ts', import.meta.url),
        { type: 'module' },
      )
      setWorker(w)

      w.onmessage = handleMessage
      // メインスレッドの origin を Worker に送信して初期化を開始
      w.postMessage({ origin: globalThis.location.origin, type: '__init' })
      w.onerror = (e) => {
        console.error('SQLite Worker error:', e)
        if (initReject) {
          stopSnapshotRecording()
          initReject(new Error(`Worker initialization failed: ${e.message}`))
          setInitReject(null)
          setInitResolve(null)
          if (initTimer != null) {
            clearTimeout(initTimer)
            setInitTimer(null)
          }
        }
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
  setInitPromise(promise)

  return promise
}

// ================================================================
// 公開 API
// ================================================================

/**
 * 汎用 SQL 実行 — デフォルトは other キュー。
 * タイムライン取得は opts.kind='timeline' で timeline キュー（重複排除あり）に振り分け可能。
 */
export function execAsync(
  sql: string,
  opts?: {
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
    kind?: QueueKind
    sessionTag?: string
  },
): Promise<unknown> {
  const id = incrementNextId()
  const request: ExecRequest = {
    bind: opts?.bind,
    id,
    returnValue: opts?.returnValue,
    sql,
    type: 'exec',
  }
  return sendRequest(request, opts?.kind ?? 'other', opts?.sessionTag)
}

/**
 * 汎用 SQL 実行 — Worker 内の実際の SQL 実行時間も返す。
 * デフォルトは other キュー。opts.kind='timeline' で timeline キューに振り分け可能。
 */
export async function execAsyncTimed(
  sql: string,
  opts?: {
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
    kind?: QueueKind
    sessionTag?: string
  },
): Promise<{ result: unknown; durationMs: number }> {
  const id = incrementNextId()
  const request: ExecRequest = {
    bind: opts?.bind,
    id,
    returnValue: opts?.returnValue,
    sql,
    type: 'exec',
  }
  const result = await sendRequest(
    request,
    opts?.kind ?? 'other',
    opts?.sessionTag,
  )
  const durationMs = durationForId.get(id) ?? 0
  durationForId.delete(id)
  return { durationMs, result }
}

/**
 * 汎用 WRITE 用 — 複数 SQL をバッチ実行する。
 */
export function execBatch(
  statements: {
    sql: string
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
  }[],
  opts?: {
    rollbackOnError?: boolean
    returnIndices?: number[]
  },
): Promise<Record<number, unknown>> {
  const id = incrementNextId()
  const request: ExecBatchRequest = {
    id,
    returnIndices: opts?.returnIndices,
    rollbackOnError: opts?.rollbackOnError ?? true,
    statements,
    type: 'execBatch',
  }
  return sendRequest(request, 'other') as Promise<Record<number, unknown>>
}

/**
 * ExecutionPlan を Worker で実行する。
 * Plan 003: 汎用実行エンジン経由。
 *
 * Phase 2c: id-collect ステップのキャッシュを事前チェックし、
 * ヒット分は precomputedResults として Worker に渡して DB 実行をスキップさせる。
 * 実行後は capturedVersions でキャッシュを更新する。
 */
export async function executeQueryPlan(
  plan: SerializedExecutionPlan,
  sessionTag?: string,
): Promise<QueryPlanResult> {
  // キャッシュヒットした id-collect ステップをキャッシュから集める
  const precomputedResults: Record<number, IdCollectResult> = {}
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    if (step.type !== 'id-collect') continue
    const cached = getCachedIdCollect({ binds: step.binds, sql: step.sql })
    if (cached) {
      precomputedResults[i] = { rows: cached, type: 'id-collect' }
    }
  }

  const planWithCache: SerializedExecutionPlan =
    Object.keys(precomputedResults).length > 0
      ? { ...plan, precomputedResults }
      : plan

  const id = incrementNextId()
  const message = { id, plan: planWithCache, type: 'executeQueryPlan' } as {
    type: string
    id: number
    [key: string]: unknown
  }
  const result = (await sendRequest(
    message,
    'timeline',
    sessionTag,
  )) as QueryPlanResult

  // capturedVersions でローカルバージョンを同期し、新規実行分をキャッシュに保存
  if (result.capturedVersions) {
    syncTableVersions(result.capturedVersions)

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i]
      if (step.type !== 'id-collect') continue
      // Worker で実際に実行されたステップのみキャッシュ保存（precomputed は除外）
      if (precomputedResults[i]) continue
      const stepResult = result.stepResults[i]
      if (stepResult?.type === 'id-collect') {
        // Legacy path — rows lack 'table' field, add it from step.source
        const rowsWithTable = stepResult.rows.map(
          (r: { id: number; createdAtMs: number }) => ({
            ...r,
            table: step.source,
          }),
        )
        setCachedIdCollect(
          { binds: step.binds, sql: step.sql },
          rowsWithTable,
          result.capturedVersions,
          step.source,
        )
      }
    }
  }

  return result
}

/**
 * GraphPlan (V2 グラフ) を Worker で実行する。
 * 各ノードを Worker 内で個別実行し、Output ノードで Phase2/Phase3 を構築する。
 */
export function executeGraphPlan(
  plan: SerializedGraphPlan,
  options: GraphExecuteOptions,
  sessionTag?: string,
): Promise<GraphExecuteResult> {
  const id = incrementNextId()
  const message = { id, options, plan, type: 'executeGraphPlan' } as {
    type: string
    id: number
    [key: string]: unknown
  }
  return sendRequest(
    message,
    'timeline',
    sessionTag,
  ) as Promise<GraphExecuteResult>
}

/**
 * フラットフェッチを Worker で実行する。
 * フロー実行で事前フィルタ済みの ID 群から最小限のクエリで Entity を組み立てる。
 */
export function executeFlatFetch(
  request: FlatFetchRequest,
  sessionTag?: string,
): Promise<FlatFetchResult> {
  const id = incrementNextId()
  const message = { id, request, type: 'executeFlatFetch' } as {
    type: string
    id: number
    [key: string]: unknown
  }
  return sendRequest(
    message,
    'timeline',
    sessionTag,
  ) as Promise<FlatFetchResult>
}

/**
 * タイムラインを一括取得する。
 * Phase1 → Phase2 → Batch×7 を Worker 内で一括実行し、1 回の postMessage で結果を返す。
 */
export function fetchTimeline(
  request: Omit<FetchTimelineRequest, 'type' | 'id'>,
  sessionTag?: string,
): Promise<FetchTimelineResult> {
  const id = incrementNextId()
  const message = { ...request, id, type: 'fetchTimeline' } as {
    type: string
    id: number
    [key: string]: unknown
  }
  return sendRequest(
    message,
    'timeline',
    sessionTag,
  ) as Promise<FetchTimelineResult>
}

/**
 * 専用ハンドラ呼び出し — Worker に委譲するコマンドを送信する。
 */
export function sendCommand(command: SendCommandPayload): Promise<unknown> {
  const id = incrementNextId()
  const message = { ...command, id } as {
    type: string
    id: number
    [key: string]: unknown
  }
  return sendRequest(message, 'other')
}

/**
 * Worker を終了する。
 */
export function terminateWorker(): void {
  worker?.terminate()
  setWorker(null)
  // 実行中 (in-flight) のリクエストを拒否してクリア
  for (const req of pending.values()) {
    clearTimeout(req.timer)
    reportDequeue(req.kind)
    req.reject(new Error('Worker terminated'))
  }
  pending.clear()
  // キュー内の未送信リクエストを拒否してクリア（stats カウンタも減算）
  for (const queued of otherQueue) {
    reportDequeue('other')
    queued.reject(new Error('Worker terminated'))
  }
  for (const queued of timelineQueue) {
    reportDequeue('timeline')
    queued.reject(new Error('Worker terminated'))
  }
  otherQueue.length = 0
  timelineQueue.length = 0
  timelineDedup.clear()
  setActiveRequest(false)
  setConsecutiveOther(0)
  setInitPromise(null)
  setInitResolve(null)
  setInitReject(null)
  setNotifyChangeCallback(null)
  setSlowQueryLogCallback(null)
  setNextId(0)
  stopSnapshotRecording()
}
