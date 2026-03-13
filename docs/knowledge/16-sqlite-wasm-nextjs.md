# 16. SQLite WASM × Next.js トラブルシューティングガイド

ブラウザ上で SQLite を動作させるために `@sqlite.org/sqlite-wasm` を Next.js プロジェクトで使用する際、バンドラ・ランタイム・セキュリティヘッダなど複数のレイヤーで問題が発生する。

---

## 目次

1. [全体アーキテクチャ](#1-全体アーキテクチャ)
2. [WASM バイナリの配信と読み込み](#2-wasm-バイナリの配信と読み込み)
3. [Turbopack による import.meta.url の書き換え問題](#3-turbopack-による-importmetaurl-の書き換え問題)
4. [Web Worker の初期化](#4-web-worker-の初期化)
5. [OPFS (Origin Private File System) の利用](#5-opfs-origin-private-file-system-の利用)
6. [セキュリティヘッダ（COOP / COEP）](#6-セキュリティヘッダcoop--coep)
7. [webpack / Turbopack のバンドル設定](#7-webpack--turbopack-のバンドル設定)
8. [Server Component / SSR との衝突](#8-server-component--ssr-との衝突)
9. [フォールバック戦略](#9-フォールバック戦略)
10. [型定義の不整合](#10-型定義の不整合)
11. [デバッグ手法](#11-デバッグ手法)
12. [トラブルシューティング早見表](#12-トラブルシューティング早見表)

---

## 1. 全体アーキテクチャ

miyulab-fe では以下の 2 モードで SQLite を動作させている。

```
┌──────────────────────────────────────────────────────────────┐
│                      メインスレッド                            │
│                                                              │
│  connection.ts ── getSqliteDb() ── initSqlite.ts             │
│       │                               │                      │
│       │                    ┌──────────┴──────────┐           │
│       │                    │                     │           │
│       │              Worker 利用可能?       Worker 利用不可   │
│       │                    │                     │           │
│       │            initWorkerMode()    initMainThreadFallback()│
│       │                    │                     │           │
│       │            workerClient.ts          インメモリ DB     │
│       │              (RPC 経由)            (永続化なし)       │
│       │                    │                                 │
│       ▼                    ▼                                 │
│   DbHandle インターフェース (共通 API)                         │
└──────────────────────────────────────────────────────────────┘
                             │
                    Worker モードの場合
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   Dedicated Worker                            │
│                                                              │
│  sqlite.worker.ts                                            │
│    ├── OPFS SAH Pool VFS (最高パフォーマンス)                  │
│    ├── 通常 OPFS VFS (フォールバック 1)                        │
│    └── インメモリ DB (フォールバック 2)                         │
│                                                              │
│  WASM バイナリ: /public/sqlite3.wasm を fetch で取得           │
└──────────────────────────────────────────────────────────────┘
```

### キーポイント

- **Worker モード**: Dedicated Worker 内で SQLite を動作させ、OPFS で永続化する。メインスレッドの UI をブロックしない。
- **フォールバックモード**: Worker が利用できない環境ではメインスレッドでインメモリ DB を使用する。データは永続化されない。
- **共通インターフェース**: `DbHandle` 型により、どちらのモードでも同一の API でアクセスできる。

---

## 2. WASM バイナリの配信と読み込み

### 問題

`@sqlite.org/sqlite-wasm` は内部で Emscripten を使用しており、WASM バイナリの配置パスを自動解決しようとする。しかし Next.js のバンドラ（webpack / Turbopack）が `import.meta.url` やモジュールパスを書き換えるため、自動解決が失敗する。

### 解決策

1. **WASM ファイルを `public/` に配置する**

```
public/
  sqlite3.wasm    ← @sqlite.org/sqlite-wasm の WASM バイナリをコピー
```

`node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm` を `public/sqlite3.wasm` にコピーする。これにより `https://your-domain/sqlite3.wasm` で配信される。

2. **WASM バイナリを事前に fetch して `wasmBinary` で渡す**

`sqlite3InitModule` に `wasmBinary` オプションを渡すことで、Emscripten の内部パス解決をバイパスする。

```typescript
// Worker 内またはメインスレッドで
const wasmUrl = `${origin}/sqlite3.wasm`
const wasmResponse = await fetch(wasmUrl)
const wasmBinary = await wasmResponse.arrayBuffer()

const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
const sqlite3 = await initSqlite({
  locateFile: (file: string) => `${origin}/${file}`,
  wasmBinary,
})
```

### なぜ `locateFile` だけでは不十分なのか

Turbopack 環境では `import.meta.url` が書き換えられるため、`locateFile` を指定しても Emscripten の内部処理で XHR/fetch が失敗するケースがある。`wasmBinary` で直接バイナリを渡すのが最も確実な方法。

---

## 3. Turbopack による import.meta.url の書き換え問題

### 問題

Next.js 15+ ではデフォルトで Turbopack が使用される。Turbopack は `import.meta.url` を独自のスキーム（`turbopack-internal:///` 等）に書き換えるため、以下の問題が発生する。

1. **WASM ファイルの URL 解決失敗**: Emscripten が `import.meta.url` を基準に `.wasm` ファイルを探すが、書き換え後の URL では fetch できない。
2. **Worker 内の相対パス解決失敗**: Worker 内の `import.meta.url` も書き換えられ、Worker から別のリソースを読み込めない。

### 解決策

**メインスレッドから `origin` を Worker に渡す。**

```typescript
// workerClient.ts — Worker 初期化時に origin を送信
worker.postMessage({ origin: globalThis.location.origin, type: '__init' })
```

```typescript
// sqlite.worker.ts — メインスレッドから受け取った origin で絶対 URL を構築
async function init(origin: string): Promise<'opfs' | 'memory'> {
  const wasmUrl = `${origin}/sqlite3.wasm`
  const wasmResponse = await fetch(wasmUrl)
  const wasmBinary = await wasmResponse.arrayBuffer()
  // ...
}
```

Worker 内では `import.meta.url` を一切使わず、メインスレッドの `globalThis.location.origin` を信頼する。

---

## 4. Web Worker の初期化

### 問題

Next.js のバンドラで Worker ファイルを正しくバンドルさせる必要がある。`new Worker()` の引数に文字列パスを渡すとバンドル対象にならない。

### 解決策

**`new URL()` + `import.meta.url` パターンを使用する。**

```typescript
// workerClient.ts
worker = new Worker(
  new URL('./worker/sqlite.worker.ts', import.meta.url),
  { type: 'module' },
)
```

このパターンは webpack / Turbopack の両方で認識され、Worker ファイルが自動的にバンドル対象になる。

### 注意点

- `{ type: 'module' }` を指定し、ESM Worker として起動する。
- Worker ファイル内では `/// <reference lib="webworker" />` を宣言して TypeScript の型解決を正しくする。
- Worker の初期化は非同期で行われるため、初期化完了を待つ仕組み（Promise + メッセージ応答）が必要。
- 初期化のタイムアウトも設定すべき（miyulab-fe では 15 秒）。

### Worker 初期化プロトコル

```
Main Thread                         Worker
    │                                  │
    │  ── { type: '__init', origin } ──▶
    │                                  │  WASM ロード
    │                                  │  OPFS/メモリ DB 初期化
    │                                  │  スキーマ適用
    │  ◀── { type: 'init',            │
    │        persistence: 'opfs' } ────│
    │                                  │
    │  （以降、RPC メッセージのやりとり）  │
```

---

## 5. OPFS (Origin Private File System) の利用

### OPFS とは

OPFS は Web 標準の永続化ストレージで、ブラウザ内のサンドボックスされたファイルシステムを提供する。SQLite の VFS (Virtual File System) として使用することで、ブラウザ上でも永続的なデータベースが実現できる。

### VFS の優先順位

miyulab-fe では以下の優先順で VFS を選択する。

| 優先度 | VFS | 特徴 | 要件 |
|--------|-----|------|------|
| 1 | OPFS SAH Pool | 最高パフォーマンス。同期アクセスで高速 I/O | Dedicated Worker 内でのみ利用可能 |
| 2 | 通常 OPFS | 非同期アクセスだが永続化可能 | Dedicated Worker 内でのみ利用可能 |
| 3 | インメモリ | 永続化なし。ページリロードでデータ消失 | どの環境でも利用可能 |

### OPFS SAH Pool VFS の制約

- **Dedicated Worker 内でのみ利用可能**: `SharedWorker` やメインスレッドでは使用できない。
- **同一オリジンポリシー**: 別オリジンからはアクセスできない。
- **同時アクセス不可**: 同一ファイルに対して複数の Worker から同時にアクセスすると競合する。
- **`SharedArrayBuffer` 不要**: OPFS SAH Pool VFS は `SharedArrayBuffer` を使用しないため、COEP ヘッダは不要。

### 初期化コード

```typescript
// sqlite.worker.ts
// 1. OPFS SAH Pool VFS（最高パフォーマンス）
try {
  const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
    directory: '/miyulab-fe',
    name: 'opfs-sahpool',
  })
  db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
  persistence = 'opfs'
} catch (_e1) {
  // 2. 通常の OPFS
  try {
    db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
    persistence = 'opfs'
  } catch (_e2) {
    // 3. インメモリ DB フォールバック
    db = new sqlite3.oo1.DB(':memory:', 'c')
    persistence = 'memory'
  }
}
```

### よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| `installOpfsSAHPoolVfs` が例外を投げる | メインスレッドから呼んでいる | Dedicated Worker 内から呼ぶ |
| OPFS のデータが消える | ブラウザのストレージクリア | ユーザーの操作なので防げない。UI でフォールバック表示 |
| 複数タブでの競合 | 同一 OPFS ファイルへの同時アクセス | 将来的には `BroadcastChannel` 等での排他制御を検討 |

---

## 6. セキュリティヘッダ（COOP / COEP）

### 背景

ブラウザのセキュリティモデルにおいて、特定の Web API（`SharedArrayBuffer` 等）を使うには Cross-Origin Isolation が必要。これには以下の 2 つのヘッダが関わる。

| ヘッダ | 正式名称 | 役割 |
|--------|---------|------|
| COOP | Cross-Origin-Opener-Policy | 他オリジンの Window との参照を遮断 |
| COEP | Cross-Origin-Embedder-Policy | クロスオリジンリソースの読み込みを制限 |

### miyulab-fe の判断

**COOP のみ設定し、COEP は設定しない。**

```javascript
// next.config.mjs
async headers() {
  return [
    {
      headers: [
        {
          key: 'Cross-Origin-Opener-Policy',
          value: 'same-origin',
        },
      ],
      source: '/:path*',
    },
  ]
}
```

### なぜ COEP を設定しないのか

1. **OPFS SAH Pool VFS は `SharedArrayBuffer` を使わない**: COEP は `SharedArrayBuffer` を有効にするために必要だが、OPFS SAH Pool VFS は同期的な OPFS アクセスハンドルを使用しており、`SharedArrayBuffer` に依存しない。
2. **クロスオリジン iframe への影響**: COEP（`require-corp` / `credentialless`）を設定すると、YouTube 埋め込みなどのクロスオリジン iframe がブロックされる。Fediverse クライアントではユーザー投稿内の埋め込みコンテンツを表示する必要があるため、COEP は除去した。

### COOP だけで十分なケース

- OPFS（SAH Pool VFS を含む）のみ使用
- `SharedArrayBuffer` を使わない
- `Atomics.wait` を使わない

### COOP + COEP の両方が必要なケース

以下に該当する場合は COEP も必要。ただし `credentialless` モードを使えばクロスオリジン iframe への影響を軽減できる場合もある。

- `SharedArrayBuffer` を使用する VFS を使いたい場合
- `Atomics.wait` でスレッド間同期を行う場合

---

## 7. webpack / Turbopack のバンドル設定

### Node.js 組み込みモジュールのポリフィル無効化

SQLite WASM のコードが Node.js の `crypto` / `fs` / `path` を参照する場合があるが、ブラウザでは不要。`resolve.fallback` で無効化する。

```javascript
// next.config.mjs
webpack(config) {
  config.resolve.fallback = {
    ...config.resolve.fallback,
    crypto: false,
    fs: false,
    path: false,
  }
  return config
}
```

### 注意: Turbopack と webpack の設定の違い

Next.js 15+ では開発時に Turbopack、本番ビルドでは webpack がデフォルトで使われる場合がある（設定による）。

- **webpack**: `next.config.mjs` の `webpack()` 関数でカスタマイズ可能。
- **Turbopack**: `webpack()` 関数は無視される。Turbopack 固有の設定は `experimental.turbo` で行う。

miyulab-fe では WASM バイナリの事前 fetch + `wasmBinary` 直接渡しにより、バンドラ固有の差異を回避している。

---

## 8. Server Component / SSR との衝突

### 問題

Next.js の Server Component や SSR フェーズでは以下が使えない。

- `window` / `globalThis.location`
- `Worker`
- `navigator`
- OPFS API
- `@sqlite.org/sqlite-wasm`（Emscripten が DOM API を参照する）

Server Component から SQLite 関連のモジュールを import すると、ビルド時またはサーバーサイドレンダリング時にエラーが発生する。

### 解決策

1. **SQLite の初期化はクライアントサイドでのみ行う**

`getSqliteDb()` はブラウザの `useEffect` 内や Client Component のイベントハンドラから呼ぶ。

```typescript
'use client'

import { useEffect } from 'react'
import { getSqliteDb } from 'util/db/sqlite/connection'

export function MyComponent() {
  useEffect(() => {
    getSqliteDb().then((db) => {
      // DB を使った処理
    })
  }, [])
}
```

2. **動的 import でコード分割する**

Server Component から参照されるモジュール内で SQLite を使う場合は、動的 import でクライアント実行時まで遅延させる。

```typescript
// Server Component のレンダリング時には実行されない
const { getSqliteDb } = await import('util/db/sqlite/connection')
```

3. **`typeof window !== 'undefined'` ガード**

共通ユーティリティ内で SQLite を参照する場合は、実行環境を事前チェックする。

```typescript
export async function getDbIfAvailable() {
  if (typeof window === 'undefined') return null
  const { getSqliteDb } = await import('util/db/sqlite/connection')
  return getSqliteDb()
}
```

---

## 9. フォールバック戦略

miyulab-fe では段階的なフォールバックにより、あらゆる環境で動作することを保証している。

### フォールバックチェーン

```
Worker + OPFS SAH Pool VFS (最良)
  │ 失敗
  ▼
Worker + 通常 OPFS VFS
  │ 失敗
  ▼
Worker + インメモリ DB
  │ Worker 自体が使えない
  ▼
メインスレッド + インメモリ DB (最低限)
```

### DbHandle による抽象化

```typescript
export type DbHandle = {
  execAsync: (sql: string, opts?: ExecOpts) => Promise<unknown>
  execBatch: (
    statements: BatchStatement[],
    opts?: ExecBatchOpts,
  ) => Promise<Record<number, unknown>>
  sendCommand: (command: SendCommandPayload) => Promise<unknown>
  persistence: 'opfs' | 'memory'
}
```

`persistence` フィールドにより、アプリケーション層で永続化の有無を判別し、UI にインジケータを表示できる。

### Worker 初期化タイムアウト

Worker が無応答の場合のハングを防ぐため、初期化タイムアウトを設定する。

```typescript
const INIT_TIMEOUT_MS = 15_000

initTimer = setTimeout(() => {
  if (initReject) {
    initReject(
      new Error(`Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`),
    )
  }
}, INIT_TIMEOUT_MS)
```

タイムアウト発生時はフォールバックモード（メインスレッド + インメモリ）に自動移行する。

---

## 10. 型定義の不整合

### 問題

`@sqlite.org/sqlite-wasm` は TypeScript 型定義が不完全で、いくつかの API が型定義に含まれていない。

### 具体的な問題と対処

#### `sqlite3InitModule` の `moduleArg` パラメータ

`sqlite3InitModule` は Emscripten の `Module` オブジェクトを引数に取れるが、型定義に含まれていない。

```typescript
// @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
const sqlite3 = await initSqlite({
  locateFile: (file: string) => `${origin}/${file}`,
  wasmBinary,
})
```

#### Database の overload

`sqlite-wasm` の `Database` 型はメソッドのオーバーロードが多く、フォールバックモードで Worker ハンドラに渡す際に型互換性の問題が起きる。

```typescript
// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm Database overload compat
const db = rawDb as any
```

#### 推奨対策

- `@ts-expect-error` と `// biome-ignore` コメントで明示的に型抑制する。
- 将来のバージョンで型定義が改善される可能性があるため、コメントで理由を記録する。
- `any` の使用は sqlite-wasm との境界に限定し、アプリケーション層には `DbHandle` 型で公開する。

---

## 11. デバッグ手法

### スローログの活用

miyulab-fe では閾値（2000ms）を超えるクエリに対して `EXPLAIN QUERY PLAN` を自動実行し、コンソールに出力する。

```
[SlowQuery] 2534.2ms
  SQL: SELECT ... FROM statuses WHERE ...
  Bind: ["home", "https://example.com"]
  EXPLAIN QUERY PLAN:
    SEARCH statuses USING INDEX idx_statuses_timeline ...
```

### Worker のデバッグ

1. **Chrome DevTools**: Sources → Worker スレッドを選択してブレークポイントを設定。
2. **コンソールログ**: Worker 内の `console.info` / `console.warn` / `console.error` はメインスレッドのコンソールに表示される。
3. **RPC メッセージの監視**: `workerClient.ts` の `sendRequest` / `handleMessage` にログを追加して、メッセージのやりとりを確認。

### OPFS の内容確認

Chrome DevTools の Application → Storage → OPFS からファイルを確認できる。ただし SAH Pool VFS が作成するファイルは独自フォーマットのため、直接読み取りはできない。

### 永続化モードの確認

`DbHandle.persistence` を UI に表示することで、現在の永続化モードを視覚的に確認できる。

```
persistence: 'opfs'   → OPFS で永続化中（ページリロードしてもデータ維持）
persistence: 'memory'  → インメモリ（ページリロードでデータ消失）
```

---

## 12. トラブルシューティング早見表

| 症状 | 考えられる原因 | 対処法 |
|------|---------------|--------|
| `Failed to fetch sqlite3.wasm` | WASM ファイルが `public/` にない | `node_modules/@sqlite.org/sqlite-wasm/sqlite-wasm/jswasm/sqlite3.wasm` を `public/sqlite3.wasm` にコピー |
| `import.meta.url` が無効なスキーム | Turbopack による書き換え | `origin` をメインスレッドから渡し、`wasmBinary` で直接ロード |
| `Worker is not defined` | SSR / Server Component で実行されている | Client Component 内、`useEffect` 内で初期化する |
| `Cannot use SharedArrayBuffer` | COOP / COEP 未設定 | OPFS SAH Pool VFS を使うなら不要。他の VFS なら COOP + COEP を設定 |
| `OPFS not available` | メインスレッドから OPFS VFS を使おうとしている | Dedicated Worker 内でのみ OPFS を使用する |
| Worker 初期化がタイムアウト | Worker スクリプトのバンドルエラー、ネットワーク遅延 | DevTools Console / Network を確認。タイムアウト後はフォールバック |
| `Module not found: crypto` | webpack が Node.js モジュールを解決しようとしている | `webpack.resolve.fallback` で `crypto: false` を設定 |
| データがページリロードで消える | インメモリ DB にフォールバックしている | `persistence` の値を確認。Worker + OPFS が動作しているか検証 |
| YouTube 埋め込みが表示されない | COEP ヘッダが設定されている | COEP を削除。OPFS SAH Pool VFS は COEP 不要 |
| `exec` の呼び出しが遅い | メインスレッドで同期実行している | Worker モードに移行し、RPC 経由で非同期実行 |
| EXPLAIN QUERY PLAN で `SCAN` が出る | インデックスが使われていない | 正規化カラムにインデックスを追加、WHERE 句の条件を見直す |
| Worker 内で `ReferenceError: window is not defined` | Worker 内で `window` を参照している | `globalThis` または `self` を使用する |

---

## 参考リンク

- [@sqlite.org/sqlite-wasm 公式ドキュメント](https://sqlite.org/wasm/doc/trunk/index.md)
- [OPFS SAH Pool VFS 解説](https://sqlite.org/wasm/doc/trunk/persistence.md#opfs-sahpool)
- [Cross-Origin Isolation (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)
- [COOP (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy)
- [COEP (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy)
- [Web Workers (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Origin Private File System (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `next.config.mjs` | COOP ヘッダ設定、webpack fallback 設定 |
| `public/sqlite3.wasm` | WASM バイナリ（静的アセット） |
| `src/util/db/sqlite/initSqlite.ts` | DB 初期化 — Worker / フォールバック分岐 |
| `src/util/db/sqlite/workerClient.ts` | メインスレッド側 RPC クライアント |
| `src/util/db/sqlite/worker/sqlite.worker.ts` | Worker エントリーポイント |
| `src/util/db/sqlite/connection.ts` | シングルトン + 変更通知 (subscribe/notify) |
| `src/util/db/sqlite/types.ts` | `DbHandle` 型定義 |
| `src/util/db/sqlite/protocol.ts` | Worker RPC プロトコル型定義 |
| `src/util/db/sqlite/schema.ts` | スキーマ定義 & マイグレーション |
| `src/util/db/sqlite/explainLogger.ts` | スロークエリの EXPLAIN QUERY PLAN ログ |
