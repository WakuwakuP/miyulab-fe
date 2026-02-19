/**
 * SQLite Wasm 初期化モジュール (Web Worker 版)
 *
 * SQLite の処理を専用 Web Worker で実行し、
 * OPFS (Origin Private File System) を利用して永続化する。
 * メインスレッドとは postMessage で通信する。
 *
 * OPFS の同期アクセスハンドル API は Web Worker でのみ利用可能なため、
 * Worker 内で SQLite を初期化・実行し、メインスレッドからは
 * 非同期の exec() 関数を通じてアクセスする。
 */

import type { WorkerResponse } from './sqlite.worker'

let dbPromise: Promise<DbHandle> | null = null

/**
 * exec() のオプション型
 */
export interface ExecOptions {
  bind?: unknown[]
  returnValue?: string
}

/**
 * 公開するDB操作ハンドル
 *
 * Worker 経由で SQL を実行する非同期 exec() 関数を提供する。
 * 呼び出し元は `await handle.exec(sql, opts)` でアクセスする。
 */
export type DbHandle = {
  exec: (sql: string, opts?: ExecOptions) => Promise<unknown>
}

/**
 * SQLite をシングルトンで初期化する。
 */
export async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise
  dbPromise = initDb()
  return dbPromise
}

async function initDb(): Promise<DbHandle> {
  // SSR ガード: ブラウザ環境でのみ Worker を起動
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('SQLite Worker requires a browser environment')
  }

  const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), {
    type: 'module',
  })

  // リクエスト/レスポンスの対応管理
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()
  let nextId = 0

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)

    switch (msg.type) {
      case 'init-result':
        entry.resolve(msg.opfs)
        break
      case 'exec-result':
        entry.resolve(msg.result)
        break
      case 'init-error':
      case 'exec-error':
        entry.reject(new Error(msg.error))
        break
    }
  }

  worker.onerror = (e) => {
    console.error('SQLite Worker error:', e)
  }

  // Worker を初期化（OPFS / メモリDB の判定は Worker 内で行う）
  await new Promise<unknown>((resolve, reject) => {
    const id = nextId++
    pending.set(id, { reject, resolve })
    worker.postMessage({ id, type: 'init' })
  })

  // exec プロキシ: メインスレッドから Worker へ SQL 実行を委譲
  const exec = (sql: string, opts?: ExecOptions): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { reject, resolve })
      worker.postMessage({
        bind: opts?.bind,
        id,
        returnValue: opts?.returnValue,
        sql,
        type: 'exec',
      })
    })
  }

  return { exec }
}
