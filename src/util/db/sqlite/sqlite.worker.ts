/**
 * SQLite Web Worker
 *
 * OPFS (Origin Private File System) を利用して永続化する。
 * OPFS が利用できない環境ではメモリDB にフォールバックする。
 *
 * メインスレッドとは postMessage で通信し、
 * SQL 実行リクエストを逐次処理する。
 */
/// <reference lib="webworker" />

import type { Database, OpfsDatabase } from '@sqlite.org/sqlite-wasm'

let db: Database | OpfsDatabase | null = null

export type WorkerRequest =
  | { type: 'init'; id: number }
  | {
      type: 'exec'
      id: number
      sql: string
      bind?: unknown[]
      returnValue?: string
    }

export type WorkerResponse =
  | { type: 'init-result'; id: number; opfs: boolean }
  | { type: 'init-error'; id: number; error: string }
  | { type: 'exec-result'; id: number; result: unknown }
  | { type: 'exec-error'; id: number; error: string }

async function handleInit(id: number): Promise<void> {
  try {
    const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
    const sqlite3 = await initSqlite()

    let opfs = false
    try {
      db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      opfs = true
      console.info('SQLite Worker: using OPFS persistence')
    } catch {
      db = new sqlite3.oo1.DB(':memory:', 'c')
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
      )
    }

    db.exec('PRAGMA journal_mode=WAL;')
    db.exec('PRAGMA synchronous=NORMAL;')
    db.exec('PRAGMA foreign_keys = ON;')

    self.postMessage({ type: 'init-result', id, opfs } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'init-error',
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }
}

function handleExec(msg: WorkerRequest & { type: 'exec' }): void {
  if (!db) {
    self.postMessage({
      type: 'exec-error',
      id: msg.id,
      error: 'DB not initialized',
    } satisfies WorkerResponse)
    return
  }

  try {
    const opts: Record<string, unknown> = {}
    if (msg.bind) opts.bind = msg.bind
    if (msg.returnValue) opts.returnValue = msg.returnValue

    const raw =
      Object.keys(opts).length > 0
        ? db.exec(msg.sql, opts)
        : db.exec(msg.sql)

    // db.exec() without returnValue returns the db object (for chaining).
    // Only forward meaningful results (arrays) to the main thread.
    const result = msg.returnValue ? raw : undefined

    self.postMessage({
      type: 'exec-result',
      id: msg.id,
      result,
    } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({
      type: 'exec-error',
      id: msg.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data

  if (msg.type === 'init') {
    // init is async but we don't need to queue subsequent messages –
    // the main thread awaits init completion before sending exec messages.
    void handleInit(msg.id)
    return
  }

  if (msg.type === 'exec') {
    handleExec(msg)
    return
  }
}
