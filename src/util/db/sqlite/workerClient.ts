/**
 * メインスレッド側 RPC クライアント
 *
 * Worker に対して型安全なメッセージを送信し、Promise で結果を受け取る。
 * changedTables フィールドを元に notifyChange を自動発火する。
 *
 * 書き込みキューと読み込みキューの 2 本立てで、書き込みを優先的に処理する。
 * 読み込みキューは同一クエリ (SQL + bind) が未処理なら重複追加しない。
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

/** 書き込みキュー（優先） */
const writeQueue: QueuedRequest[] = []
/** 読み込みキュー */
const readQueue: QueuedRequest[] = []
/**
 * 読み込みキューの重複排除マップ
 * key = SQL + JSON(bind), value = 共有される Promise の resolve/reject 配列
 */
const readDedup = new Map<
  string,
  { resolvers: ((v: unknown) => void)[]; rejectors: ((e: Error) => void)[] }
>()

let activeRequest = false
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

  // キュースナップショット記録を開始
  startSnapshotRecording()

  initPromise = new Promise<'opfs' | 'memory'>((resolve, reject) => {
    initResolve = resolve
    initReject = reject

    // Worker 初期化タイムアウト — init メッセージが来ない場合にフォールバックを有効にする
    initTimer = setTimeout(() => {
      if (initReject) {
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
// 読み込みキュー重複排除ユーティリティ
// ================================================================

/**
 * exec リクエストの SQL + bind から重複排除用キーを生成する。
 */
function makeReadDedupKey(message: { [key: string]: unknown }): string | null {
  if (message.type !== 'exec') return null
  const sql = message.sql as string
  const bind = message.bind as unknown[] | undefined
  return bind ? `${sql}\0${JSON.stringify(bind)}` : sql
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
 * kind='read' の場合、同一クエリが既にキューにあれば新たに積まず
 * 既存リクエストの結果を共有する。
 */
function sendRequest(
  message: {
    type: string
    id: number
    [key: string]: unknown
  },
  kind: QueueKind = 'write',
): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  return new Promise<unknown>((resolve, reject) => {
    // 読み込みキューの重複排除
    if (kind === 'read') {
      const dedupKey = makeReadDedupKey(message)
      if (dedupKey != null) {
        const existing = readDedup.get(dedupKey)
        if (existing) {
          // 同じクエリが未処理なら新しく積まない — 結果を共有
          existing.resolvers.push(resolve)
          existing.rejectors.push(reject)
          return
        }
        readDedup.set(dedupKey, {
          rejectors: [reject],
          resolvers: [resolve],
        })
        // ラップされた resolve/reject で全待機者に通知する
        const sharedResolve = (value: unknown) => {
          const entry = readDedup.get(dedupKey)
          readDedup.delete(dedupKey)
          if (entry) {
            for (const r of entry.resolvers) r(value)
          }
        }
        const sharedReject = (reason: Error) => {
          const entry = readDedup.get(dedupKey)
          readDedup.delete(dedupKey)
          if (entry) {
            for (const r of entry.rejectors) r(reason)
          }
        }
        readQueue.push({
          kind,
          message,
          reject: sharedReject,
          resolve: sharedResolve,
        })
        reportEnqueue('read')
        processQueue()
        return
      }
    }

    const queue = kind === 'write' ? writeQueue : readQueue
    queue.push({ kind, message, reject, resolve })
    reportEnqueue(kind)
    processQueue()
  })
}

function processQueue(): void {
  if (activeRequest || !worker) return

  // 書き込みキューを優先
  let next: QueuedRequest | undefined
  if (writeQueue.length > 0) {
    next = writeQueue.shift()
  } else if (readQueue.length > 0) {
    next = readQueue.shift()
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
  })

  worker.postMessage(message)
}

// ================================================================
// 公開 API
// ================================================================

/**
 * 汎用 READ 用 — 単一 SQL を Worker で実行する。
 */
export function execAsync(
  sql: string,
  opts?: {
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
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
  return sendRequest(request, 'read')
}

/**
 * 汎用 READ 用 — Worker 内の実際の SQL 実行時間も返す。
 */
export async function execAsyncTimed(
  sql: string,
  opts?: {
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
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
  const result = await sendRequest(request, 'read')
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
  return sendRequest(request, 'write') as Promise<Record<number, unknown>>
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
  return sendRequest(message, 'write')
}

/**
 * Worker を終了する。
 */
export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  // キュー内の未送信リクエストを拒否してクリア
  for (const queued of writeQueue) {
    queued.reject(new Error('Worker terminated'))
  }
  for (const queued of readQueue) {
    queued.reject(new Error('Worker terminated'))
  }
  writeQueue.length = 0
  readQueue.length = 0
  readDedup.clear()
  activeRequest = false
  initPromise = null
  initResolve = null
  initReject = null
  notifyChangeCallback = null
  nextId = 0
  stopSnapshotRecording()
}
