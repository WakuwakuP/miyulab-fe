/**
 * メインスレッド側 RPC クライアント
 *
 * Worker に対して型安全なメッセージを送信し、Promise で結果を受け取る。
 * changedTables フィールドを元に notifyChange を自動発火する。
 */

import type {
  ClearExplainLogsRequest,
  ExecBatchRequest,
  ExecRequest,
  GetExplainLogsRequest,
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
}

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, PendingRequest>()
const requestQueue: QueuedRequest[] = []
let activeRequest = false
let notifyChangeCallback: ((table: TableName) => void) | null = null
let initResolve: ((persistence: 'opfs' | 'memory') => void) | null = null
let initReject: ((reason: Error) => void) | null = null
let initPromise: Promise<'opfs' | 'memory'> | null = null
let initTimer: ReturnType<typeof setTimeout> | null = null

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

/**
 * リクエストをキューに追加し、順番に Worker へ送信する。
 *
 * Worker はシングルスレッドでメッセージを逐次処理するため、
 * 一度に複数の postMessage を送ると後続リクエストのタイムアウトが
 * 実際の処理時間ではなくキュー待ち時間を含んでしまう。
 * キューで直列化し、タイムアウトは実際に送信した時点から計測する。
 */
function sendRequest(message: {
  type: string
  id: number
  [key: string]: unknown
}): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  return new Promise<unknown>((resolve, reject) => {
    requestQueue.push({ message, reject, resolve })
    processQueue()
  })
}

function processQueue(): void {
  if (activeRequest || requestQueue.length === 0 || !worker) return

  const next = requestQueue.shift()
  if (!next) return
  activeRequest = true
  const { message, resolve, reject } = next
  const id = message.id

  const timer = setTimeout(() => {
    pending.delete(id)
    activeRequest = false
    reject(
      new Error(`Worker request timed out (id=${id}, type=${message.type})`),
    )
    processQueue()
  }, TIMEOUT_MS)

  pending.set(id, {
    reject: (reason: Error) => {
      clearTimeout(timer)
      activeRequest = false
      reject(reason)
      processQueue()
    },
    resolve: (value: unknown) => {
      clearTimeout(timer)
      activeRequest = false
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
  return sendRequest(request)
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
  return sendRequest(request) as Promise<Record<number, unknown>>
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
  return sendRequest(message)
}

/**
 * EXPLAIN ログを Worker から取得する。
 */
export function getExplainLogs(): Promise<readonly string[]> {
  const id = nextId++
  const request: GetExplainLogsRequest = {
    id,
    type: 'getExplainLogs',
  }
  return sendRequest(request) as Promise<readonly string[]>
}

/**
 * Worker 内の EXPLAIN ログをクリアする。
 */
export function clearExplainLogs(): Promise<void> {
  const id = nextId++
  const request: ClearExplainLogsRequest = {
    id,
    type: 'clearExplainLogs',
  }
  return sendRequest(request) as Promise<void>
}

/**
 * Worker を終了する。
 */
export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  // キュー内の未送信リクエストを拒否してクリア
  for (const queued of requestQueue) {
    queued.reject(new Error('Worker terminated'))
  }
  requestQueue.length = 0
  activeRequest = false
  initPromise = null
  initResolve = null
  initReject = null
  notifyChangeCallback = null
  nextId = 0
}
