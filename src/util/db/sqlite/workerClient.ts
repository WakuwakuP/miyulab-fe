/**
 * メインスレッド側 RPC クライアント
 *
 * Worker に対して型安全なメッセージを送信し、Promise で結果を受け取る。
 * changedTables フィールドを元に notifyChange を自動発火する。
 *
 * other キュー（書き込み・管理系読み込み等）と timeline キュー（タイムライン取得）
 * の 2 本立てで、other キューを優先的に処理する。
 * timeline キューは同一クエリ (SQL + bind + returnValue) が未処理なら重複追加しない。
 */

import type { QueueKind } from '../dbQueue'
import {
  reportDequeue,
  reportEnqueue,
  startSnapshotRecording,
  stopSnapshotRecording,
} from '../dbQueue'
import type {
  ExecBatchRequest,
  ExecRequest,
  SendCommandPayload,
  TableName,
  WorkerMessage,
} from './protocol'

// ================================================================
// 内部状態
// ================================================================

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  kind: QueueKind
  timer: ReturnType<typeof setTimeout>
}

type QueuedRequest = {
  message: { type: string; id: number; [key: string]: unknown }
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  kind: QueueKind
}

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, PendingRequest>()

/** other キュー（優先） */
const otherQueue: QueuedRequest[] = []
/** タイムライン取得キュー */
const timelineQueue: QueuedRequest[] = []
/**
 * タイムライン取得キューの重複排除マップ
 * key = SQL + JSON(bind) + returnValue, value = 共有される Promise の resolve/reject 配列
 */
const timelineDedup = new Map<
  string,
  { resolvers: ((v: unknown) => void)[]; rejectors: ((e: Error) => void)[] }
>()

let activeRequest = false
/** other キューを連続処理した回数（timeline 飢餓防止用） */
let consecutiveOther = 0
/**
 * timeline キューの飢餓を防ぐため、other を連続処理する最大回数。
 * この回数に達すると timeline キューにアイテムがあれば先に処理する。
 */
const MAX_CONSECUTIVE_OTHER = 4
let notifyChangeCallback: ((table: TableName) => void) | null = null
let initResolve: ((persistence: 'opfs' | 'memory') => void) | null = null
let initReject: ((reason: Error) => void) | null = null
let initPromise: Promise<'opfs' | 'memory'> | null = null
let initTimer: ReturnType<typeof setTimeout> | null = null
const durationForId = new Map<number, number>()

const TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 15_000

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
  onNotify: (table: TableName) => void,
): Promise<'opfs' | 'memory'> {
  if (initPromise) return initPromise

  notifyChangeCallback = onNotify

  initPromise = new Promise<'opfs' | 'memory'>((resolve, reject) => {
    initResolve = resolve
    initReject = reject

    // Worker 初期化タイムアウト — init メッセージが来ない場合にフォールバックを有効にする
    initTimer = setTimeout(() => {
      if (initReject) {
        stopSnapshotRecording()
        initReject(
          new Error(
            `Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`,
          ),
        )
        initReject = null
        initResolve = null
        initTimer = null
      }
    }, INIT_TIMEOUT_MS)

    try {
      worker = new Worker(
        new URL('./worker/sqlite.worker.ts', import.meta.url),
        { type: 'module' },
      )

      worker.onmessage = handleMessage
      // メインスレッドの origin を Worker に送信して初期化を開始
      worker.postMessage({ origin: globalThis.location.origin, type: '__init' })
      worker.onerror = (e) => {
        console.error('SQLite Worker error:', e)
        if (initReject) {
          stopSnapshotRecording()
          initReject(new Error(`Worker initialization failed: ${e.message}`))
          initReject = null
          initResolve = null
          if (initTimer != null) {
            clearTimeout(initTimer)
            initTimer = null
          }
        }
      }
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })

  return initPromise
}

// ================================================================
// メッセージハンドラ
// ================================================================

function handleMessage(event: MessageEvent<WorkerMessage>): void {
  const msg = event.data

  switch (msg.type) {
    case 'init': {
      if (initResolve) {
        // 初期化成功 — スナップショット記録を開始
        startSnapshotRecording()
        initResolve(msg.persistence)
        initResolve = null
        initReject = null
        if (initTimer != null) {
          clearTimeout(initTimer)
          initTimer = null
        }
      }
      break
    }

    case 'response': {
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        // changedTables があれば notifyChange を発火
        if (msg.changedTables) {
          for (const table of msg.changedTables) {
            notifyChangeCallback?.(table)
          }
        }
        if (msg.durationMs != null) {
          durationForId.set(msg.id, msg.durationMs)
        }
        req.resolve(msg.result)
      }
      break
    }

    case 'error': {
      // Worker 初期化エラー (id === -1) をハンドリング
      if (msg.id === -1 && initReject) {
        initReject(new Error(msg.error))
        initReject = null
        initResolve = null
        if (initTimer != null) {
          clearTimeout(initTimer)
          initTimer = null
        }
        break
      }
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        req.reject(new Error(msg.error))
      }
      break
    }
  }
}

// ================================================================
// RPC ユーティリティ
// ================================================================

// ================================================================
// タイムラインキュー重複排除ユーティリティ
// ================================================================

/**
 * exec リクエストの SQL + bind + returnValue からタイムラインキュー重複排除用キーを生成する。
 * returnValue が異なると結果の形式が変わるため、キーに含める。
 */
function makeTimelineDedupKey(message: {
  [key: string]: unknown
}): string | null {
  if (message.type !== 'exec') return null
  const sql = message.sql as string
  const bind = message.bind as unknown[] | undefined
  const returnValue = message.returnValue as string | undefined

  const parts: string[] = [sql]
  if (bind !== undefined) {
    parts.push(JSON.stringify(bind))
  }
  if (returnValue !== undefined) {
    parts.push(returnValue)
  }
  return parts.join('\0')
}

// ================================================================
// キュー操作
// ================================================================

/**
 * リクエストをキューに追加し、順番に Worker へ送信する。
 *
 * Worker はシングルスレッドでメッセージを逐次処理するため、
 * 一度に複数の postMessage を送ると後続リクエストのタイムアウトが
 * 実際の処理時間ではなくキュー待ち時間を含んでしまう。
 * キューで直列化し、タイムアウトは実際に送信した時点から計測する。
 *
 * kind='timeline' の場合、同一クエリが既にキューにあれば新たに積まず
 * 既存リクエストの結果を共有する。
 */
function sendRequest(
  message: {
    type: string
    id: number
    [key: string]: unknown
  },
  kind: QueueKind = 'other',
): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  return new Promise<unknown>((resolve, reject) => {
    // タイムラインキューの重複排除
    if (kind === 'timeline') {
      const dedupKey = makeTimelineDedupKey(message)
      if (dedupKey != null) {
        const existing = timelineDedup.get(dedupKey)
        if (existing) {
          // 同じクエリが未処理なら新しく積まない — 結果を共有
          existing.resolvers.push(resolve)
          existing.rejectors.push(reject)
          return
        }
        timelineDedup.set(dedupKey, {
          rejectors: [reject],
          resolvers: [resolve],
        })
        // ラップされた resolve/reject で全待機者に通知する
        const sharedResolve = (value: unknown) => {
          const entry = timelineDedup.get(dedupKey)
          timelineDedup.delete(dedupKey)
          if (entry) {
            for (const r of entry.resolvers) r(value)
          }
        }
        const sharedReject = (reason: Error) => {
          const entry = timelineDedup.get(dedupKey)
          timelineDedup.delete(dedupKey)
          if (entry) {
            for (const r of entry.rejectors) r(reason)
          }
        }
        timelineQueue.push({
          kind,
          message,
          reject: sharedReject,
          resolve: sharedResolve,
        })
        reportEnqueue('timeline')
        processQueue()
        return
      }
    }

    const queue = kind === 'other' ? otherQueue : timelineQueue
    queue.push({ kind, message, reject, resolve })
    reportEnqueue(kind)
    processQueue()
  })
}

function processQueue(): void {
  if (activeRequest || !worker) return

  // other キューを優先するが、timeline キューの飢餓を防ぐため
  // other を MAX_CONSECUTIVE_OTHER 回連続処理したら timeline に譲る
  let next: QueuedRequest | undefined
  if (
    otherQueue.length > 0 &&
    (timelineQueue.length === 0 || consecutiveOther < MAX_CONSECUTIVE_OTHER)
  ) {
    next = otherQueue.shift()
    consecutiveOther++
  } else if (timelineQueue.length > 0) {
    next = timelineQueue.shift()
    consecutiveOther = 0
  }
  if (!next) return
  activeRequest = true
  const { kind, message, resolve, reject } = next
  const id = message.id

  const timer = setTimeout(() => {
    pending.delete(id)
    activeRequest = false
    reportDequeue(kind)
    reject(
      new Error(`Worker request timed out (id=${id}, type=${message.type})`),
    )
    processQueue()
  }, TIMEOUT_MS)

  pending.set(id, {
    kind,
    reject: (reason: Error) => {
      clearTimeout(timer)
      activeRequest = false
      reportDequeue(kind)
      reject(reason)
      processQueue()
    },
    resolve: (value: unknown) => {
      clearTimeout(timer)
      activeRequest = false
      reportDequeue(kind)
      resolve(value)
      processQueue()
    },
    timer,
  })

  worker.postMessage(message)
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
  },
): Promise<unknown> {
  const id = nextId++
  const request: ExecRequest = {
    bind: opts?.bind,
    id,
    returnValue: opts?.returnValue,
    sql,
    type: 'exec',
  }
  return sendRequest(request, opts?.kind ?? 'other')
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
  },
): Promise<{ result: unknown; durationMs: number }> {
  const id = nextId++
  const request: ExecRequest = {
    bind: opts?.bind,
    id,
    returnValue: opts?.returnValue,
    sql,
    type: 'exec',
  }
  const result = await sendRequest(request, opts?.kind ?? 'other')
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
  const id = nextId++
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
 * 専用ハンドラ呼び出し — Worker に委譲するコマンドを送信する。
 */
export function sendCommand(command: SendCommandPayload): Promise<unknown> {
  const id = nextId++
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
  worker = null
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
  activeRequest = false
  consecutiveOther = 0
  initPromise = null
  initResolve = null
  initReject = null
  notifyChangeCallback = null
  nextId = 0
  stopSnapshotRecording()
}
