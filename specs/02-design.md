# 02. 設計書 — SQLite OPFS Worker 移行

> **⚠️ 重要: 本設計書は初版です。リアクティブ動作の分析により重大な設計上の問題が発見され、
> `04-reactive-behavior-analysis.md` で修正版の設計を定義しています。
> 実装時は 04 の修正版を優先してください。**
>
> 主な修正点:
> - `execBatch` 方式ではトランザクション内 READ → WRITE 分岐が表現できない問題の解決（専用ハンドラの導入）
> - Worker `notify` メッセージによる二重通知リスクの解消（`changedTables` レスポンスフィールドで一元管理）
> - Store 関数の薄いラッパー化（ビジネスロジックを Worker 側に移動）
> - Worker 側関数をフォールバックモードでも共有する構成

## 1. 概要

本設計書は、SQLite Wasm をメインスレッドからDedicated Web Workerに移行し、
OPFS (Origin Private File System) による確実なデータ永続化を実現するための詳細設計を定義する。

### 現状の問題

```
現在のアーキテクチャ:

  Main Thread
  ┌──────────────────────────────────────┐
  │  initSqlite.ts                       │
  │    new sqlite3.oo1.OpfsDb(...)       │ ← OPFS 同期アクセスハンドルは
  │    catch → new sqlite3.oo1.DB(':memory:') │   Worker 内でしか利用不可
  │                                      │
  │  connection.ts                       │
  │    getSqliteDb() → DbHandle          │
  │    db.exec(sql) ← 同期呼び出し       │
  │                                      │
  │  statusStore.ts / notificationStore.ts │
  │    db.exec(sql) ← 同期呼び出し       │
  └──────────────────────────────────────┘
```

`sqlite3.oo1.OpfsDb` は OPFS の `createSyncAccessHandle()` を内部で使用するが、
このブラウザ API は **Dedicated Worker 内でしか利用できない**。
そのため、メインスレッドでは常に `catch` に落ち、インメモリ DB にフォールバックしている。

### 移行後のアーキテクチャ

```
  Main Thread                              Dedicated Worker
  ┌─────────────────────────┐              ┌──────────────────────────┐
  │                         │  postMessage │                          │
  │  workerClient.ts        │◀────────────▶│  sqlite.worker.ts        │
  │    execAsync(sql, opts) │  (RPC)       │    db.exec(sql, opts)    │
  │    execBatch(stmts)     │              │                          │
  │                         │              │  OPFS SAH Pool VFS       │
  │  connection.ts          │              │    /miyulab-fe.sqlite3   │
  │    subscribe()          │              │                          │
  │    notifyChange()       │              │  schema.ts               │
  │    getSqliteDb()        │              │    ensureSchema()        │
  │                         │              │                          │
  │  statusStore.ts         │              │  ※ SQL実行は全てここ     │
  │    await execAsync(...) │              └──────────────────────────┘
  │                         │
  │  notificationStore.ts   │
  │    await execAsync(...) │
  └─────────────────────────┘
```

---

## 2. 設計方針

### 2.1 基本原則

1. **Worker 側は SQL 実行のみを担当する**: スキーマ管理、クエリ実行、トランザクション制御の全てを Worker 内で行う
2. **メインスレッドは RPC クライアント**: `postMessage` でリクエストを送信し、Promise で結果を受け取る
3. **subscribe / notifyChange はメインスレッドに残す**: React Hook のコールバック管理はメインスレッドで完結する。Worker からの書き込み完了通知でメインスレッド側の `notifyChange` を発火する
4. **フォールバックを維持する**: Worker/OPFS が利用できない環境ではメインスレッド + インメモリ DB にフォールバックする
5. **既存の公開 API シグネチャを最大限維持する**: Store 関数(`upsertStatus`, `getNotifications` 等)の引数・戻り値の型は変更しない。内部実装のみ非同期 RPC に置換する

### 2.2 パフォーマンス方針

- **バッチ実行 (`execBatch`)**: トランザクション内の複数 SQL を 1 回の `postMessage` ラウンドトリップで処理する。現在の `BEGIN; ... COMMIT;` パターンは 1 メッセージにまとめ、Worker 側でアトミックに実行する
- **結果の軽量化**: Worker 側で行の取得 → 配列変換まで行い、メインスレッドには構造化クローン可能な値のみを返す
- **通知のバッチ化**: 書き込み完了後にメインスレッドへ `notify` メッセージを 1 回送信し、`notifyChange()` を発火する

---

## 3. RPC プロトコル設計

### 3.1 メッセージ型定義

```typescript
// src/util/db/sqlite/protocol.ts

// ================================================================
// Main Thread → Worker (リクエスト)
// ================================================================

/** 単一SQL実行リクエスト */
export type ExecRequest = {
  type: 'exec'
  id: number
  sql: string
  bind?: (string | number | null)[]
  returnValue?: 'resultRows'
}

/** バッチSQL実行リクエスト（トランザクション用） */
export type ExecBatchRequest = {
  type: 'execBatch'
  id: number
  statements: {
    sql: string
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
  }[]
  rollbackOnError: boolean
  /** バッチ内で結果を返すstatementのインデックス（省略時は全statementの結果を返す） */
  returnIndices?: number[]
}

/** Worker初期化完了確認 */
export type ReadyRequest = {
  type: 'ready'
  id: number
}

/** Worker → Main Thread へ送る全リクエスト型 */
export type WorkerRequest = ExecRequest | ExecBatchRequest | ReadyRequest

// ================================================================
// Worker → Main Thread (レスポンス)
// ================================================================

/** 成功レスポンス */
export type SuccessResponse = {
  type: 'response'
  id: number
  result: unknown
}

/** エラーレスポンス */
export type ErrorResponse = {
  type: 'error'
  id: number
  error: string
}

/** 変更通知（書き込み操作後にWorkerから発火） */
export type NotifyMessage = {
  type: 'notify'
  table: 'statuses' | 'notifications'
}

/** Worker初期化完了通知 */
export type InitMessage = {
  type: 'init'
  persistence: 'opfs' | 'memory'
}

/** Worker → Main Thread へ送る全メッセージ型 */
export type WorkerMessage =
  | SuccessResponse
  | ErrorResponse
  | NotifyMessage
  | InitMessage
```

### 3.2 メッセージフロー

#### 単一 SQL 実行

```
Main Thread                          Worker
    │                                  │
    │  { type: 'exec', id: 1,         │
    │    sql: 'SELECT ...', bind: [] } │
    │ ────────────────────────────────▶│
    │                                  │  db.exec(sql, opts)
    │                                  │
    │  { type: 'response', id: 1,     │
    │    result: [[...], [...]] }      │
    │ ◀────────────────────────────────│
    │                                  │
```

#### バッチ SQL 実行（トランザクション）

```
Main Thread                          Worker
    │                                  │
    │  { type: 'execBatch', id: 2,    │
    │    statements: [                 │
    │      { sql: 'INSERT ...' },      │
    │      { sql: 'INSERT ...' },      │
    │    ],                            │
    │    rollbackOnError: true }       │
    │ ────────────────────────────────▶│
    │                                  │  BEGIN
    │                                  │  exec(stmt[0])
    │                                  │  exec(stmt[1])
    │                                  │  COMMIT
    │                                  │
    │  { type: 'response', id: 2,     │
    │    result: { ok: true } }        │
    │ ◀────────────────────────────────│
    │                                  │
    │  { type: 'notify',              │
    │    table: 'statuses' }          │
    │ ◀────────────────────────────────│
    │                                  │
```

#### エラー時

```
Main Thread                          Worker
    │                                  │
    │  { type: 'exec', id: 3, ... }   │
    │ ────────────────────────────────▶│
    │                                  │  db.exec → throws Error
    │                                  │
    │  { type: 'error', id: 3,        │
    │    error: 'SQLITE_ERROR: ...' }  │
    │ ◀────────────────────────────────│
    │                                  │
```

---

## 4. ファイル構成

### 4.1 新規作成ファイル

```
src/util/db/sqlite/
├── protocol.ts          # RPC メッセージ型定義
├── sqlite.worker.ts     # Worker エントリーポイント
├── workerClient.ts      # メインスレッド側 RPC クライアント
└── __tests__/
    ├── helpers/
    │   ├── testDb.ts        # better-sqlite3 互換アダプタ
    │   ├── fixtures.ts      # テスト用モックデータファクトリ
    │   └── setup.ts         # Vitest セットアップ
    ├── schema.test.ts
    ├── statusStore.test.ts
    ├── notificationStore.test.ts
    ├── cleanup.test.ts
    ├── connection.test.ts
    ├── migration.test.ts
    └── integration.test.ts
```

### 4.2 変更ファイル

```
src/util/db/sqlite/
├── initSqlite.ts        # Worker 生成 + フォールバック (全面書換)
├── connection.ts        # DbHandle 型変更、Worker RPC 統合
├── schema.ts            # Worker 内で実行されるよう import 調整 (変更小)
├── statusStore.ts       # db.exec → execAsync / execBatch (大規模変更)
├── notificationStore.ts # 同上
├── cleanup.ts           # 同上
├── migration.ts         # 同上
├── index.ts             # 新エクスポート追加
│
# 呼び出し元 (Hook / UI)
src/util/hooks/
├── useTimeline.ts
├── useFilteredTimeline.ts
├── useFilteredTagTimeline.ts
├── useCustomQueryTimeline.ts
└── useNotifications.ts

src/app/_parts/
├── InstanceBlockManager.tsx
└── MuteManager.tsx

src/app/_components/
├── UnifiedTimeline.tsx
└── QueryEditor.tsx
```

---

## 5. 各モジュールの詳細設計

### 5.1 `sqlite.worker.ts` — Worker エントリーポイント

#### 責務

- SQLite Wasm の初期化（OPFS SAH Pool VFS 優先、フォールバックでインメモリ）
- スキーマの初期化 (`ensureSchema`)
- RPC メッセージのハンドリング（`exec`, `execBatch`）

#### 初期化フロー

```
Worker 起動
  │
  ├─ import('@sqlite.org/sqlite-wasm')
  │
  ├─ sqlite3.installOpfsSAHPoolVfs() を試行
  │    │
  │    ├─ 成功 → SAH Pool VFS で DB を開く
  │    │         new sqlite3.oo1.DB('/miyulab-fe.sqlite3', 'c', 'opfs-sahpool')
  │    │
  │    └─ 失敗 → sqlite3.oo1.OpfsDb を試行
  │              │
  │              ├─ 成功 → OPFS DB で開く
  │              │
  │              └─ 失敗 → メモリDB で開く
  │                        new sqlite3.oo1.DB(':memory:', 'c')
  │
  ├─ PRAGMA journal_mode=WAL
  ├─ PRAGMA synchronous=NORMAL
  ├─ PRAGMA foreign_keys=ON
  │
  ├─ ensureSchema(handle)
  │
  └─ postMessage({ type: 'init', persistence: 'opfs' | 'memory' })
```

#### 実装イメージ

```typescript
// src/util/db/sqlite/sqlite.worker.ts

/// <reference lib="webworker" />

import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { WorkerMessage, WorkerRequest } from './protocol'

let db: Database
let sqlite3: Sqlite3Static

async function init(): Promise<'opfs' | 'memory'> {
  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  sqlite3 = await initSqlite()

  let persistence: 'opfs' | 'memory' = 'memory'

  // 1. OPFS SAH Pool VFS を試行（最も高パフォーマンス）
  try {
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
      name: 'opfs-sahpool',
      directory: '/miyulab-fe',
    })
    db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
    persistence = 'opfs'
    console.info('SQLite Worker: using OPFS SAH Pool persistence')
  } catch (e1) {
    // 2. OPFS (通常) を試行
    try {
      db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      persistence = 'opfs'
      console.info('SQLite Worker: using OPFS persistence')
    } catch (e2) {
      // 3. メモリDB にフォールバック
      db = new sqlite3.oo1.DB(':memory:', 'c')
      persistence = 'memory'
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
      )
    }
  }

  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // スキーマ初期化（Worker内で直接実行）
  const { ensureSchema } = await import('./schema')
  ensureSchema({ db, sqlite3 })

  return persistence
}

function handleExec(
  sql: string,
  bind?: (string | number | null)[],
  returnValue?: string,
): unknown {
  if (returnValue === 'resultRows') {
    return db.exec(sql, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    })
  }
  db.exec(sql, { bind: bind ?? undefined })
  return undefined
}

function handleExecBatch(
  statements: { sql: string; bind?: (string | number | null)[]; returnValue?: string }[],
  rollbackOnError: boolean,
  returnIndices?: number[],
): unknown {
  const results: Map<number, unknown> = new Map()
  const shouldReturn = new Set(returnIndices ?? [])

  if (rollbackOnError) {
    db.exec('BEGIN;')
  }

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const result = handleExec(stmt.sql, stmt.bind, stmt.returnValue)
      if (shouldReturn.has(i) || !returnIndices) {
        results.set(i, result)
      }
    }

    if (rollbackOnError) {
      db.exec('COMMIT;')
    }
  } catch (e) {
    if (rollbackOnError) {
      try { db.exec('ROLLBACK;') } catch { /* ignore rollback error */ }
    }
    throw e
  }

  // Map → 通常オブジェクトに変換（構造化クローン互換）
  const resultObj: Record<number, unknown> = {}
  for (const [k, v] of results) {
    resultObj[k] = v
  }
  return resultObj
}

// メッセージハンドラ
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data

  try {
    switch (msg.type) {
      case 'exec': {
        const result = handleExec(msg.sql, msg.bind, msg.returnValue)
        const response: WorkerMessage = {
          type: 'response',
          id: msg.id,
          result,
        }
        self.postMessage(response)
        break
      }

      case 'execBatch': {
        const result = handleExecBatch(
          msg.statements,
          msg.rollbackOnError,
          msg.returnIndices,
        )
        const response: WorkerMessage = {
          type: 'response',
          id: msg.id,
          result,
        }
        self.postMessage(response)
        break
      }

      case 'ready': {
        const response: WorkerMessage = {
          type: 'response',
          id: msg.id,
          result: true,
        }
        self.postMessage(response)
        break
      }
    }
  } catch (e) {
    const response: WorkerMessage = {
      type: 'error',
      id: msg.id,
      error: e instanceof Error ? e.message : String(e),
    }
    self.postMessage(response)
  }
}

// 初期化実行
init().then((persistence) => {
  const msg: WorkerMessage = { type: 'init', persistence }
  self.postMessage(msg)
})
```

#### `installOpfsSAHPoolVfs` について

`@sqlite.org/sqlite-wasm` 3.44.0 以降で利用可能な高パフォーマンス OPFS VFS。

- 事前に OPFS ファイルのプールを作成し、同期アクセスハンドルを保持する
- 通常の `OpfsDb` より高速（ファイルオープン/クローズのオーバーヘッドがない）
- **Worker 内でのみ動作** する（`createSyncAccessHandle()` が Worker 限定のため）
- フォールバックチェーンにより、SAH Pool → 通常 OPFS → メモリの順で試行

---

### 5.2 `workerClient.ts` — メインスレッド RPC クライアント

#### 責務

- Worker インスタンスの生成・管理
- RPC メッセージの送信・レスポンスの Promise 解決
- `notify` メッセージの受信と `notifyChange()` への委譲
- Worker 非対応環境でのフォールバック

#### 実装イメージ

```typescript
// src/util/db/sqlite/workerClient.ts

import type {
  ExecBatchRequest,
  ExecRequest,
  WorkerMessage,
} from './protocol'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, PendingRequest>()
let notifyHandler: ((table: 'statuses' | 'notifications') => void) | null = null
let initResolve: ((persistence: 'opfs' | 'memory') => void) | null = null
let initPromise: Promise<'opfs' | 'memory'> | null = null

/**
 * Worker の初期化（1回のみ）
 *
 * @returns 永続化方式 ('opfs' | 'memory')
 */
export function initWorker(
  onNotify: (table: 'statuses' | 'notifications') => void,
): Promise<'opfs' | 'memory'> {
  if (initPromise) return initPromise

  notifyHandler = onNotify

  initPromise = new Promise<'opfs' | 'memory'>((resolve, reject) => {
    initResolve = resolve

    try {
      // Next.js の webpack は new Worker(new URL(...), { type: 'module' }) をバンドルする
      worker = new Worker(
        new URL('./sqlite.worker.ts', import.meta.url),
        { type: 'module' },
      )

      worker.onmessage = handleMessage
      worker.onerror = (e) => {
        console.error('SQLite Worker error:', e)
        reject(new Error(`Worker initialization failed: ${e.message}`))
      }
    } catch (e) {
      reject(e)
    }
  })

  return initPromise
}

function handleMessage(event: MessageEvent<WorkerMessage>): void {
  const msg = event.data

  switch (msg.type) {
    case 'init': {
      // Worker 初期化完了
      if (initResolve) {
        initResolve(msg.persistence)
        initResolve = null
      }
      break
    }

    case 'response': {
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        req.resolve(msg.result)
      }
      break
    }

    case 'error': {
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        req.reject(new Error(msg.error))
      }
      break
    }

    case 'notify': {
      // 書き込み完了通知 → メインスレッドの notifyChange を発火
      notifyHandler?.(msg.table)
      break
    }
  }
}

/**
 * 単一 SQL を Worker で実行する
 */
export function execAsync(
  sql: string,
  opts?: {
    bind?: (string | number | null)[]
    returnValue?: 'resultRows'
  },
): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  const id = nextId++
  const request: ExecRequest = {
    type: 'exec',
    id,
    sql,
    bind: opts?.bind,
    returnValue: opts?.returnValue,
  }

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage(request)
  })
}

/**
 * 複数 SQL をバッチで Worker に送信する（トランザクション用）
 *
 * rollbackOnError: true の場合、Worker 側で BEGIN/COMMIT/ROLLBACK を自動制御する。
 * statements に BEGIN/COMMIT を含める必要はない。
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
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  const id = nextId++
  const request: ExecBatchRequest = {
    type: 'execBatch',
    id,
    statements,
    rollbackOnError: opts?.rollbackOnError ?? true,
    returnIndices: opts?.returnIndices,
  }

  return Promise.race([
    new Promise<Record<number, unknown>>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })
      worker!.postMessage(request)
    }),
  ])
}

/**
 * Worker を終了する（テスト用）
 */
export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
  initPromise = null
  initResolve = null
  notifyHandler = null
  nextId = 0
}
```

---

### 5.3 `initSqlite.ts` — 初期化モジュール（書換）

#### 変更概要

現在の同期的な `getDb()` → `DbHandle` のパターンを、Worker ベースの非同期パターンに変更する。
Worker 非対応環境ではフォールバックとして現在と同じメインスレッド + インメモリ DB を使う。

#### フォールバック判定

```
typeof Worker !== 'undefined'
  ├─ true  → Worker 生成を試行
  │          ├─ 成功 → Worker RPC モード
  │          └─ 失敗 → フォールバックモード
  │
  └─ false → フォールバックモード（SSR / 古いブラウザ）
```

#### 新しい DbHandle 型

```typescript
// src/util/db/sqlite/initSqlite.ts

export type DbHandle = {
  /**
   * 単一 SQL を実行する（非同期）
   */
  execAsync: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => Promise<unknown>

  /**
   * 複数 SQL をバッチ実行する（トランザクション用・非同期）
   *
   * rollbackOnError: true の場合、Worker側でBEGIN/COMMIT/ROLLBACKを自動制御する。
   */
  execBatch: (
    statements: {
      sql: string
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    }[],
    opts?: {
      rollbackOnError?: boolean
      returnIndices?: number[]
    },
  ) => Promise<Record<number, unknown>>

  /** 永続化方式 */
  persistence: 'opfs' | 'memory'
}
```

#### 実装イメージ

```typescript
import { notifyChange } from './connection'
import type { DbHandle } from './types'
import * as rpc from './workerClient'

let dbPromise: Promise<DbHandle> | null = null

export async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise
  dbPromise = initDb()
  return dbPromise
}

async function initDb(): Promise<DbHandle> {
  // Worker が使えるか確認
  if (typeof Worker !== 'undefined') {
    try {
      const persistence = await rpc.initWorker((table) => {
        notifyChange(table)
      })

      console.info(
        `SQLite: initialized in Worker (${persistence === 'opfs' ? 'OPFS persistence' : 'in-memory'})`,
      )

      return {
        execAsync: rpc.execAsync,
        execBatch: rpc.execBatch,
        persistence,
      }
    } catch (e) {
      console.warn('SQLite: Worker initialization failed, falling back to main thread:', e)
    }
  }

  // フォールバック: メインスレッド + インメモリ
  return initMainThreadFallback()
}

async function initMainThreadFallback(): Promise<DbHandle> {
  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  const sqlite3 = await initSqlite()
  const db = new sqlite3.oo1.DB(':memory:', 'c')

  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  // スキーマ初期化
  const { ensureSchema } = await import('./schema')
  ensureSchema({ db, sqlite3 })

  console.warn(
    'SQLite: using main-thread in-memory database. Data will not persist.',
  )

  return {
    execAsync: async (sql, opts) => {
      if (opts?.returnValue === 'resultRows') {
        return db.exec(sql, {
          bind: opts.bind ?? undefined,
          returnValue: 'resultRows',
        })
      }
      db.exec(sql, { bind: opts?.bind ?? undefined })
      return undefined
    },
    execBatch: async (statements, opts) => {
      const results: Record<number, unknown> = {}
      const shouldReturn = new Set(opts?.returnIndices ?? [])

      if (opts?.rollbackOnError) db.exec('BEGIN;')
      try {
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i]
          if (stmt.returnValue === 'resultRows') {
            const r = db.exec(stmt.sql, {
              bind: stmt.bind ?? undefined,
              returnValue: 'resultRows',
            })
            if (shouldReturn.has(i) || !opts?.returnIndices) {
              results[i] = r
            }
          } else {
            db.exec(stmt.sql, { bind: stmt.bind ?? undefined })
          }
        }
        if (opts?.rollbackOnError) db.exec('COMMIT;')
      } catch (e) {
        if (opts?.rollbackOnError) {
          try { db.exec('ROLLBACK;') } catch { /* ignore */ }
        }
        throw e
      }
      return results
    },
    persistence: 'memory',
  }
}
```

---

### 5.4 `connection.ts` — 接続管理（変更）

#### 変更概要

- `DbHandle` 型を新しい非同期インターフェースに変更
- `getSqliteDb()` が新しい `DbHandle` を返す
- `subscribe` / `notifyChange` は変更なし（メインスレッドに残留）
- Worker からの `notify` メッセージで `notifyChange()` を発火する仕組みは `initSqlite.ts` 側で接続済み

#### 実装イメージ

```typescript
// src/util/db/sqlite/connection.ts

import type { DbHandle } from './initSqlite'
import { getDb } from './initSqlite'

export type { DbHandle }

/** 変更対象テーブル */
export type TableName = 'statuses' | 'notifications'

/** 変更リスナー */
type ChangeListener = () => void

const listeners = new Map<TableName, Set<ChangeListener>>()

/**
 * テーブル変更を subscribe する
 * 戻り値は unsubscribe 関数。
 */
export function subscribe(table: TableName, fn: ChangeListener): () => void {
  let set = listeners.get(table)
  if (!set) {
    set = new Set()
    listeners.set(table, set)
  }
  set.add(fn)
  return () => set.delete(fn)
}

/**
 * テーブル変更を通知する
 *
 * Worker からの notify メッセージ受信時、
 * および Store 関数からの直接呼び出しの両方で使用する。
 */
export function notifyChange(table: TableName): void {
  const set = listeners.get(table)
  if (set) {
    for (const fn of set) {
      try {
        fn()
      } catch (e) {
        console.error('Change listener error:', e)
      }
    }
  }
}

let ready: Promise<DbHandle> | null = null

/**
 * 初期化済みの DB ハンドルを返す（スキーマ保証付き）
 *
 * Worker モードの場合、スキーマは Worker 側で適用済み。
 * フォールバックモードの場合、initSqlite.ts 内で適用済み。
 */
export function getSqliteDb(): Promise<DbHandle> {
  if (ready) return ready
  ready = getDb()
  return ready
}
```

---

### 5.5 Store 層の変更パターン

#### 5.5.1 単一クエリ（SELECT）

```typescript
// ===== Before =====
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()
  const { db } = handle
  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]
  return rows.map(rowToStoredNotification)
}

// ===== After =====
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()
  const rows = await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]
  return rows.map(rowToStoredNotification)
}
```

**変更ポイント**:
- `const { db } = handle` → 不要（`handle.execAsync` を直接呼ぶ）
- `db.exec(...)` → `await handle.execAsync(...)`
- 戻り値の型キャストは変更なし

#### 5.5.2 トランザクション（INSERT / UPDATE）

```typescript
// ===== Before =====
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle

  db.exec('BEGIN;')
  try {
    // ... 複数の db.exec() 呼び出し
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
  notifyChange('statuses')
}

// ===== After =====
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()

  // URI で既存行を検索（トランザクション外のREAD）
  const existingRows = normalizedUri
    ? (await handle.execAsync(
        'SELECT compositeKey FROM statuses WHERE uri = ?;',
        { bind: [normalizedUri], returnValue: 'resultRows' },
      ) as string[][])
    : []

  // トランザクション内の書き込みを組み立て
  const statements: { sql: string; bind?: (string | number | null)[] }[] = []

  if (existingRows.length > 0) {
    compositeKey = existingRows[0][0]
    statements.push({
      sql: 'UPDATE statuses SET ... WHERE compositeKey = ?;',
      bind: [/* ... */, compositeKey],
    })
  } else {
    compositeKey = createCompositeKey(backendUrl, status.id)
    statements.push({
      sql: 'INSERT INTO statuses (...) VALUES (...) ON CONFLICT(...) DO UPDATE SET ...;',
      bind: [/* ... */],
    })
  }

  statements.push({
    sql: 'INSERT OR IGNORE INTO statuses_backends (...) VALUES (?, ?, ?);',
    bind: [compositeKey, backendUrl, status.id],
  })

  statements.push({
    sql: 'INSERT OR IGNORE INTO statuses_timeline_types (...) VALUES (?, ?);',
    bind: [compositeKey, timelineType],
  })

  // タグ・メンション等の追加 statements...

  await handle.execBatch(statements, { rollbackOnError: true })
  notifyChange('statuses')
}
```

**変更ポイント**:
- `BEGIN` / `COMMIT` / `ROLLBACK` の明示的な呼び出しを削除
- `execBatch(statements, { rollbackOnError: true })` に統合
- Worker 側で `BEGIN` → 全 `exec` → `COMMIT` (エラー時 `ROLLBACK`) を自動制御
- `notifyChange()` はメインスレッドで呼ぶ（Worker からの `notify` メッセージでも発火される）

#### 5.5.3 READ + WRITE が混在するパターン

一部の関数（`updateStatusAction` 等）は、READ した結果を元に WRITE する必要がある。
このパターンでは:

1. **READ フェーズ**: `execAsync` で SELECT を実行
2. **メインスレッドで加工**: JSON パース → 値の変更
3. **WRITE フェーズ**: `execBatch` で UPDATE を実行

```typescript
// ===== After =====
export async function updateStatusAction(...): Promise<void> {
  const handle = await getSqliteDb()

  // READ
  const rows = await handle.execAsync(
    'SELECT json, uri FROM statuses WHERE compositeKey = ?;',
    { bind: [compositeKey], returnValue: 'resultRows' },
  ) as string[][]

  if (rows.length === 0) return

  // メインスレッドで加工
  const status = JSON.parse(rows[0][0]) as Entity.Status
  ;(status as Record<string, unknown>)[action] = value

  const statements: { sql: string; bind?: (string | number | null)[] }[] = []

  statements.push({
    sql: 'UPDATE statuses SET json = ? WHERE compositeKey = ?;',
    bind: [JSON.stringify(status), compositeKey],
  })

  // reblog 元の更新等...

  // WRITE
  await handle.execBatch(statements, { rollbackOnError: true })
  notifyChange('statuses')
}
```

#### 5.5.4 `resolveCompositeKey` の変更

現在は同期関数だが、Worker 経由になるため非同期化が必要。

```typescript
// ===== Before =====
export function resolveCompositeKey(
  handle: DbHandle,
  backendUrl: string,
  localId: string,
): string | null {
  const rows = handle.db.exec(
    'SELECT compositeKey FROM statuses_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as string[][]
  return rows.length > 0 ? rows[0][0] : null
}

// ===== After =====
export async function resolveCompositeKey(
  handle: DbHandle,
  backendUrl: string,
  localId: string,
): Promise<string | null> {
  const rows = await handle.execAsync(
    'SELECT compositeKey FROM statuses_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as string[][]
  return rows.length > 0 ? rows[0][0] : null
}
```

**影響**: `resolveCompositeKey` を呼ぶ全箇所で `await` が必要になる。

#### 5.5.5 同期ヘルパー `getTimelineTypes` / `getBelongingTags` の変更

`rowToStoredStatus` 内で呼ばれる同期ヘルパーも非同期化が必要。

```typescript
// ===== Before =====
function rowToStoredStatus(
  handle: DbHandle,
  row: (string | number)[],
): SqliteStoredStatus {
  // ...
  return {
    ...status,
    belongingTags: getBelongingTags(handle, compositeKey),
    timelineTypes: getTimelineTypes(handle, compositeKey),
  }
}

// ===== After (Option A: N+1 クエリ回避) =====
// rowToStoredStatus は呼び出し元で timelineTypes / belongingTags を一括取得するよう変更
// ただし、現在 getStatusesByTimelineType 等のフック内では timelineTypes: [] として空を設定しているため、
// 実質的に getTimelineTypes/getBelongingTags は getStatusesByCustomQuery 経由でのみ使われる

// ===== After (Option B: 非同期化) =====
async function rowToStoredStatusAsync(
  handle: DbHandle,
  row: (string | number)[],
): Promise<SqliteStoredStatus> {
  const compositeKey = row[0] as string
  // ...
  const [timelineTypes, belongingTags] = await Promise.all([
    getTimelineTypesAsync(handle, compositeKey),
    getBelongingTagsAsync(handle, compositeKey),
  ])
  return { ...status, belongingTags, timelineTypes }
}
```

**推奨**: Option B（非同期化）。呼び出し箇所が限定的であり、`Promise.all` で並列化できるためオーバーヘッドは小さい。

---

### 5.6 Hook 層の変更

Hook 層では、Store 関数が既に `async` であるため、Store 関数の内部変更は透過的。

ただし、一部の Hook では `getSqliteDb()` を直接呼んで `db.exec()` を実行しているため、それらを `handle.execAsync()` に変更する必要がある。

#### 変更対象一覧

| Hook | 変更内容 |
|------|---------|
| `useTimeline.ts` | `db.exec(sql, ...)` → `await handle.execAsync(sql, ...)` |
| `useFilteredTimeline.ts` | 同上 |
| `useFilteredTagTimeline.ts` | 同上 |
| `useCustomQueryTimeline.ts` | 同上 |
| `useNotifications.ts` | 同上 |

#### 変更パターン

```typescript
// ===== Before =====
const fetchData = useCallback(async () => {
  const handle = await getSqliteDb()
  const { db } = handle
  const rows = db.exec(sql, { bind, returnValue: 'resultRows' }) as T[][]
  // ...
}, [deps])

// ===== After =====
const fetchData = useCallback(async () => {
  const handle = await getSqliteDb()
  const rows = await handle.execAsync(sql, { bind, returnValue: 'resultRows' }) as T[][]
  // ...
}, [deps])
```

Hook 内の `fetchData` は既に `async` なので、`await` を追加するだけで済む。

---

### 5.7 コンポーネント層の変更

#### `InstanceBlockManager.tsx` / `MuteManager.tsx`

これらのコンポーネントは `getSqliteDb()` を直接呼んで `db.exec()` を使用している。

```typescript
// ===== Before =====
async function getBlockedInstances(): Promise<BlockedInstance[]> {
  const handle = await getSqliteDb()
  const rows = handle.db.exec(
    'SELECT instance_domain, blocked_at FROM blocked_instances ORDER BY blocked_at DESC;',
    { returnValue: 'resultRows' },
  ) as (string | number)[][]
  // ...
}

// ===== After =====
async function getBlockedInstances(): Promise<BlockedInstance[]> {
  const handle = await getSqliteDb()
  const rows = await handle.execAsync(
    'SELECT instance_domain, blocked_at FROM blocked_instances ORDER BY blocked_at DESC;',
    { returnValue: 'resultRows' },
  ) as (string | number)[][]
  // ...
}
```

#### `UnifiedTimeline.tsx`

```typescript
// ===== Before =====
const { getSqliteDb } = await import('util/db/sqlite/connection')
const handle = await getSqliteDb()
// handle.db.exec(...) は直接使用していないが確認が必要
```

---

## 6. Worker ファイルの配信設定

### 6.1 Next.js + Webpack

Next.js は `new Worker(new URL('./file.ts', import.meta.url))` パターンを認識し、
Worker ファイルを別バンドルとして出力する。

`next.config.mjs` の `webpack` 設定に追加の変更は **不要** と想定。
ただし、`@sqlite.org/sqlite-wasm` の `.wasm` ファイルが Worker から正しく読み込めるよう確認が必要。

### 6.2 Wasm ファイルの配信

`@sqlite.org/sqlite-wasm` は内部で `.wasm` ファイルを `fetch` するため、
Worker 内でも正しいパスでアクセスできる必要がある。

**確認事項**:
- `sqlite3.wasm` が `public/` または Next.js の static assets として配信されているか
- Worker 内の `import()` でモジュールが正しく解決されるか

**必要に応じて**:
- `next.config.mjs` の `webpack` で `.wasm` ファイルの `asset/resource` 設定を追加
- `public/` にコピースクリプトを追加

---

## 7. エラーハンドリング

### 7.1 Worker クラッシュ

Worker が予期せず終了した場合（メモリ不足等）:

1. `worker.onerror` でエラーを検知
2. 全 pending Promise を reject
3. 新しい Worker を再生成して再初期化を試行
4. 再初期化に失敗した場合はフォールバックモードに移行

```typescript
// workerClient.ts に追加
function handleWorkerCrash(): void {
  // 全 pending を reject
  for (const [id, req] of pending) {
    req.reject(new Error('Worker crashed'))
  }
  pending.clear()

  // Worker を再生成
  worker = null
  initPromise = null
  // 次回の getSqliteDb() で自動的に再初期化される
}
```

### 7.2 RPC タイムアウト

長時間応答がない場合（デッドロック等）:

```typescript
const RPC_TIMEOUT_MS = 30_000 // 30秒

export function execAsync(...): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`SQLite RPC timeout after ${RPC_TIMEOUT_MS}ms`))
    }, RPC_TIMEOUT_MS)

    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value) },
      reject: (err) => { clearTimeout(timer); reject(err) },
    })

    worker!.postMessage(request)
  })
}
```

### 7.3 構造化クローンエラー

`postMessage` はデータを構造化クローンでシリアライズする。
非クローン可能な値（関数、Symbol 等）が含まれるとエラーになる。

**対策**:
- Worker に送信する `bind` 配列は `(string | number | null)[]` に型制約
- Worker から返すデータも `resultRows`（ネイティブ型の配列）に限定

---

## 8. 移行手順（コーディング順序）

### Step 1: 基盤ファイル作成

1. `protocol.ts` — 型定義のみ。依存なし
2. `sqlite.worker.ts` — Worker 本体。`protocol.ts` + `schema.ts` に依存
3. `workerClient.ts` — RPC クライアント。`protocol.ts` に依存

### Step 2: initSqlite.ts 書換

1. `DbHandle` 型を新定義に変更
2. `getDb()` を Worker 初期化 + フォールバックに変更
3. 旧 `DbHandle.db` / `DbHandle.sqlite3` プロパティを削除

### Step 3: connection.ts 修正

1. `DbHandle` の re-export を新型に更新
2. `getSqliteDb()` 内の `ensureSchema` 呼び出しを削除（Worker 側で実行済み）

### Step 4: Store 層の一括変更

優先度順:

1. `statusStore.ts` — 最も参照が多い。`resolveCompositeKey` の非同期化が全体に影響
2. `notificationStore.ts` — `statusStore.ts` の `resolveCompositeKey` に依存
3. `cleanup.ts` — 独立性が高い
4. `migration.ts` — 独立性が高い

### Step 5: Hook / UI 層の変更

1. `useTimeline.ts`, `useFilteredTimeline.ts`, `useFilteredTagTimeline.ts`
2. `useCustomQueryTimeline.ts`, `useNotifications.ts`
3. `InstanceBlockManager.tsx`, `MuteManager.tsx`
4. `UnifiedTimeline.tsx`, `QueryEditor.tsx`

### Step 6: index.ts の更新

新しい型・関数のエクスポートを追加。

### Step 7: テスト実行 + ビルド確認

```bash
yarn test          # 全テスト PASS
yarn build         # ビルド成功
yarn check         # lint/format PASS
```

---

## 9. テスト戦略（Worker RPC 層）

### 9.1 ユニットテスト

Worker RPC 層は Node.js では `Worker` が使えないため、
以下の戦略でテストする。

#### workerClient.test.ts

```typescript
// Worker をモック化して RPC プロトコルをテスト
import { describe, expect, it, vi } from 'vitest'

// Worker のモック
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null
  postMessage(data: unknown) { /* ... */ }
  terminate() {}
}

vi.stubGlobal('Worker', MockWorker)
```

| # | テストケース |
|---|-------------|
| 1 | `execAsync` がリクエストを送信しレスポンスで resolve する |
| 2 | `execAsync` がエラーレスポンスで reject する |
| 3 | `execBatch` が正しいリクエスト形式で送信する |
| 4 | `notify` メッセージで `notifyHandler` が呼ばれる |
| 5 | `init` メッセージで `initWorker` の Promise が resolve する |
| 6 | Worker 非対応環境でフォールバックモードになる |
| 7 | 複数の concurrent リクエストが正しく id でマッチングされる |

#### protocol.test.ts

型定義のみのため、テスト不要（TypeScript の型チェックで保証）。

### 9.2 統合テスト（手動）

ブラウザ上での統合テストは手動で実施する。

| # | 確認項目 |
|---|---------|
| 1 | コンソールに `SQLite: initialized in Worker (OPFS persistence)` が表示される |
| 2 | タイムラインにデータが表示される |
| 3 | ページリロード後もデータが保持される |
| 4 | 新しい投稿がストリーミングで追加される |
| 5 | お気に入り/ブースト/ブックマークの状態更新が反映される |
| 6 | 通知が表示される |
| 7 | ミュート/インスタンスブロックが機能する |
| 8 | カスタムクエリが動作する |
| 9 | DevTools > Application > Storage > OPFS にファイルが存在する |

---

## 10. パフォーマンス考慮事項

### 10.1 RPC オーバーヘッド

| 操作 | Before (同期) | After (Worker RPC) | 備考 |
|------|--------------|-------------------|------|
| 単一 SELECT | ~0.1ms | ~1-3ms | postMessage のラウンドトリップ |
| バッチ INSERT (40件) | ~5ms | ~8-12ms | 1 回の postMessage で全件処理 |
| ページロード初期化 | ~50ms | ~100-200ms | Worker 生成 + OPFS 初期化 |

**許容性**: タイムライン表示のクエリは `useCallback` + `subscribe` でリアクティブに発火するため、
数 ms のオーバーヘッドはユーザー体感に影響しない。初期化の遅延もスプラッシュ画面等で吸収可能。

### 10.2 最適化ポイント

1. **execBatch でラウンドトリップ削減**: トランザクション内の N 回の `exec` を 1 回の `postMessage` にまとめる
2. **Transferable Objects**: 大量データの場合、`ArrayBuffer` を `Transferable` として渡すことでコピーコストを削減（将来の最適化）
3. **Worker の事前初期化**: `StatusStoreProvider` のマウント時に `getSqliteDb()` を呼び出し、Worker を早期に起動する

### 10.3 メモリ使用量

- Worker は独自のメモリ空間を持つため、メインスレッドの GC 圧力が軽減される
- OPFS SAH Pool VFS はファイルプールを事前確保するため、初期メモリ使用量がやや増加する（~1-2MB）

---

## 11. ブラウザ互換性

| ブラウザ | Worker | OPFS | SAH Pool | 期待動作 |
|---------|--------|------|----------|---------|
| Chrome 102+ | ✅ | ✅ | ✅ | OPFS SAH Pool |
| Firefox 111+ | ✅ | ✅ | ✅ | OPFS SAH Pool |
| Safari 17.4+ | ✅ | ✅ | ✅ | OPFS SAH Pool |
| Safari 16.4-17.3 | ✅ | ⚠️ | ❌ | OPFS (通常) or メモリ |
| Edge (Chromium) | ✅ | ✅ | ✅ | OPFS SAH Pool |
| iOS Safari 17.4+ | ✅ | ✅ | ✅ | OPFS SAH Pool |
| SSR (Node.js) | ❌ | ❌ | ❌ | N/A (SSR では DB アクセスしない) |

**フォールバックチェーン**:
1. Worker + OPFS SAH Pool VFS (最高パフォーマンス)
2. Worker + OPFS (通常)
3. Worker + メモリDB
4. メインスレッド + メモリDB (最終フォールバック)

---

## 12. セキュリティ考慮事項

### 12.1 COOP / COEP ヘッダ

`next.config.mjs` で設定済みの以下のヘッダは **引き続き必要**:

```javascript
headers: [
  { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]
```

ただし、Worker + OPFS SAH Pool VFS は `SharedArrayBuffer` に依存 **しない** ため、
COOP/COEP なしでも OPFS は動作する。ヘッダは他の機能（画像のクロスオリジン読み込み等）のために維持する。

### 12.2 Worker のオリジン制限

Worker ファイルは同一オリジンからのみロード可能。
Next.js のバンドラーが `/_next/static/...` 配下に配置するため、問題なし。

---

## 13. ロールバック計画

移行中に致命的な問題が発生した場合のロールバック手順:

1. `initSqlite.ts` を元のバージョンに戻す（`git revert`）
2. `connection.ts` を元のバージョンに戻す
3. Store 層は `DbHandle` 型が元に戻れば自動的に旧 API が使える
4. Worker 関連ファイル (`sqlite.worker.ts`, `workerClient.ts`, `protocol.ts`) は残しても影響なし（参照されなくなるだけ）

ロールバックの容易性を確保するため、**Worker 関連は新規ファイルとして追加** し、
既存ファイルの削除は最小限にする設計としている。
