# 04. リアクティブ動作分析・設計修正

## 1. 現行リアクティブフローの正確なトレース

### 1.1 ストリーミング → 画面更新の完全フロー

```
WebSocket: "update" イベント受信
  │
  ▼
StatusStoreProvider: onUpdate(status)
  │  await upsertStatus(status, backendUrl, 'home')
  │
  ▼ ──────────────── statusStore.ts ────────────────
  │
  │  const handle = await getSqliteDb()   ← キャッシュ済み、即解決
  │  const { db } = handle
  │
  │  db.exec('BEGIN;')                     ← 【同期】即完了
  │  db.exec('SELECT ... WHERE uri = ?')   ← 【同期】即完了
  │  db.exec('INSERT/UPDATE ...')           ← 【同期】即完了
  │  db.exec('INSERT OR IGNORE INTO statuses_backends ...')
  │  db.exec('INSERT OR IGNORE INTO statuses_timeline_types ...')
  │  db.exec('COMMIT;')                    ← 【同期】即完了・データ確定
  │
  │  notifyChange('statuses')              ← 【同期】メインスレッドで即発火
  │
  ▼ ──────────────── connection.ts ────────────────
  │
  │  for (const fn of listeners) {
  │    fn()   ← 全リスナーを同期的に呼び出し（async 関数なら Promise を返す）
  │  }
  │
  ▼ ──────────────── useFilteredTimeline.ts ────────────────
  │
  │  fetchData()   ← async 関数の「呼び出し」は同期（返り値の Promise は捨てる）
  │    │
  │    │  const handle = await getSqliteDb()   ← キャッシュ済み、即解決
  │    │  const { db } = handle
  │    │
  │    │  const rows = db.exec('SELECT ...')   ← ★【同期】データ確定済みなので必ず見える
  │    │
  │    │  setStatuses(results)                 ← React state 更新をスケジュール
  │    │
  │    ▼
  │  Promise resolved (microtask)
  │
  ▼
React: 再レンダリング → UI にデータ反映
```

### 1.2 リアクティブ性が成立する前提条件

| # | 前提条件 | 説明 |
|---|---------|------|
| A | WRITE の完了が保証されてから `notifyChange` が呼ばれる | `COMMIT` が同期で完了した直後に `notifyChange` が呼ばれるため、READ リスナーは必ず最新データを見る |
| B | `notifyChange` がリスナーを同期的に呼ぶ | リスナー関数 `fn()` の「起動」が同期なので、全リスナーが確実にトリガーされる |
| C | リスナー内の READ が即座にデータを返す | `db.exec(SELECT ...)` が同期なので、COMMIT 済みデータが確実に返る |
| D | Worker 側の SQLite がシングルスレッド | WRITE → READ の順序が保証される |

**前提条件 A, B, D は Worker 化後も維持される。前提条件 C のみが変化する。**

---

## 2. Worker 化後のリアクティブフロー

### 2.1 単純な RPC 化（設計書 02 の方式）

```
WebSocket: "update" イベント受信
  │
  ▼
StatusStoreProvider: onUpdate(status)
  │  await upsertStatus(status, backendUrl, 'home')
  │
  ▼ ──────────────── statusStore.ts ────────────────
  │
  │  const handle = await getSqliteDb()
  │
  │  await handle.execAsync('SELECT ...')       ← Worker往復 ~1-3ms
  │  await handle.execBatch([INSERT, ...])      ← Worker往復 ~2-5ms
  │  ← この時点で Worker 側は COMMIT 済み（前提条件 A: 維持）
  │
  │  notifyChange('statuses')                   ← 同期（前提条件 B: 維持）
  │
  ▼ ──────────────── useFilteredTimeline.ts ────────────────
  │
  │  fetchData()
  │    │
  │    │  const handle = await getSqliteDb()        ← 即解決
  │    │
  │    │  const rows = await handle.execAsync(...)   ← ★ Worker往復 ~1-3ms
  │    │    └── Worker 側は COMMIT 済みなので SELECT 結果にデータがある
  │    │        （前提条件 D: Worker の SQLite はシングルスレッド）
  │    │
  │    │  setStatuses(results)
  │    ▼
  │  Promise resolved
  │
  ▼
React: 再レンダリング
```

### 2.2 リアクティブ性は維持されるか？ → **YES**

| 前提条件 | Worker 化後 | 理由 |
|---------|------------|------|
| A: WRITE 完了後に notify | ✅ 維持 | `await execBatch()` が resolve = Worker が COMMIT 完了を応答した後に `notifyChange` を呼ぶ |
| B: リスナー同期呼び出し | ✅ 維持 | `notifyChange` はメインスレッドに残留、コード変更なし |
| C: READ が即座にデータを返す | ⚠️ 変化 | `await execAsync(SELECT)` で Worker 往復が入る。ただし Worker 側でデータは確定済みなので **結果は同じ**。遅延が ~1-3ms 増えるだけ |
| D: SQLite シングルスレッド | ✅ 維持 | Worker 内の SQLite は単一スレッド |

**結論: データの一貫性（WRITE が見える）は保証される。変わるのはレイテンシのみ。**

### 2.3 タイミング図で比較

```
■ 現行（全同期）

  t0  │ WRITE (sync)              │ ~0.1ms
  t1  │ notifyChange()            │ ~0ms
  t2  │ READ (sync)               │ ~0.1ms
  t3  │ setStatuses()             │
      │                           │
      │ 合計: ~0.2ms              │

■ Worker化後（非同期RPC）

  t0  │ WRITE → Worker            │
  t1  │   ... Worker 処理 ...      │ ~2-5ms
  t2  │ ← Worker 応答              │
  t3  │ notifyChange()            │ ~0ms
  t4  │ READ → Worker             │
  t5  │   ... Worker 処理 ...      │ ~1-3ms
  t6  │ ← Worker 応答              │
  t7  │ setStatuses()             │
      │                           │
      │ 合計: ~3-8ms              │
```

~3-8ms の遅延は人間には知覚できない。ストリーミングの投稿表示がこの分だけ遅れるが、
元々 WebSocket + REST API + React レンダリングで数十〜数百 ms かかっているため影響は無視できる。

---

## 3. 設計上の問題点と修正

### 3.1 問題1: `bulkUpsertStatuses` のトランザクション内 READ → WRITE ループ

#### 問題の詳細

現行コード（`statusStore.ts` L384-556）:

```
BEGIN
for (status of statuses) {           ← 40件のループ
  rows = SELECT WHERE uri = ?         ← 同期READ（トランザクション内）
  if (キャッシュヒット || rows.length > 0) {
    UPDATE statuses SET ... WHERE compositeKey = ?
  } else {
    INSERT INTO statuses (...) VALUES (...)
  }
  uriCache.set(uri, compositeKey)     ← メインスレッド上のキャッシュ
  INSERT OR IGNORE INTO statuses_backends ...
  INSERT OR IGNORE INTO statuses_timeline_types ...
  INSERT OR IGNORE INTO statuses_belonging_tags ...  ← タグ分のループ
  upsertMentions(...)                 ← メンション分のループ
}
COMMIT
```

**ループの各反復で SELECT → 結果に応じて INSERT or UPDATE を分岐** している。
`execBatch` で事前に全 SQL を組み立てる方式では、この分岐が表現できない。

さらに `uriCache` により、**同バッチ内の前の INSERT 結果を後の反復で参照** している。
この挙動は Worker 側の DB 内で完結しないと正しく動作しない。

#### 解決策: Worker 側に専用ハンドラを設ける

`execBatch` のような汎用 RPC ではなく、`bulkUpsert` 専用のメッセージタイプを Worker に追加する。
Worker 内部で現行と同じループ + キャッシュ + 分岐を実行し、メインスレッドには「完了 or エラー」だけを返す。

```
■ Protocol 追加

type BulkUpsertRequest = {
  type: 'bulkUpsert'
  id: number
  statuses: SerializedStatusInput[]  // JSON + メタデータ
  backendUrl: string
  timelineType: string
  tag?: string
}

type SerializedStatusInput = {
  json: string             // JSON.stringify(Entity.Status)
  uri: string
  id: string               // status.id
  created_at: string
  tags: string[]
  mentions: string[]       // acct 配列
}
```

```
■ Worker 側の処理

handleBulkUpsert(req):
  const uriCache = new Map()
  db.exec('BEGIN;')
  for (input of req.statuses) {
    const status = JSON.parse(input.json)
    const cols = extractStatusColumns(status)     ← Worker 内で実行
    // ... 現行 bulkUpsertStatuses と同じロジック ...
  }
  db.exec('COMMIT;')
  return { ok: true }
```

**メリット**:
- 現行のトランザクション内 READ → WRITE ループがそのまま動く
- メインスレッド ↔ Worker のラウンドトリップは 1 回で済む（40件でも 1 往復）
- `uriCache` が Worker 内で完結する
- `extractStatusColumns` や `upsertMentions` も Worker 内で実行されるため、メインスレッドの負荷が軽減される

**デメリット**:
- Worker 側のコード量が増える
- `Entity.Status` の型情報を Worker に渡す必要がある（JSON シリアライズで対応）

#### 同様に専用ハンドラが必要な関数

| 関数 | 理由 |
|------|------|
| `bulkUpsertStatuses` | トランザクション内 READ → WRITE ループ + URI キャッシュ |
| `upsertStatus` | URI 検索 → 分岐 → INSERT or UPDATE（1件だが同じパターン） |
| `updateStatusAction` | SELECT json → メインスレッドで JSON 加工 → UPDATE（後述で別解法あり） |
| `handleDeleteEvent` | resolveCompositeKey → 分岐 → 削除パターン選択 |
| `updateStatus` | resolveCompositeKey → UPDATE + タグ/メンション再構築 |
| `removeFromTimeline` | 残数確認 SELECT → 条件付き物理削除 |
| `updateNotificationStatusAction` | SELECT → JSON 加工 → UPDATE |

### 3.2 問題2: `updateStatusAction` の JSON パース → 加工 → UPDATE

#### 問題の詳細

```
トランザクション内:
  SELECT json FROM statuses WHERE compositeKey = ?
  → JSON.parse(json) → status.favourited = true → JSON.stringify(status)
  UPDATE statuses SET json = ? WHERE compositeKey = ?
  → さらに reblog 元、関連 Status も同様に READ → 加工 → WRITE
```

JSON パース・加工はメインスレッドの JavaScript で行いたい処理に見えるが、
実際には **「json カラムの特定フィールドを書き換える」** という定型処理。

#### 解決策 A: Worker 内で JSON 加工も行う

Worker 内で `JSON.parse` → フィールド変更 → `JSON.stringify` → `UPDATE` を一括実行する。
JSON 加工はプリミティブな操作なので Worker 内で問題なく実行できる。

```
■ Protocol 追加

type UpdateActionRequest = {
  type: 'updateAction'
  id: number
  backendUrl: string
  statusId: string
  action: 'reblogged' | 'favourited' | 'bookmarked'
  value: boolean
}
```

Worker 側で `resolveCompositeKey` → SELECT → JSON 加工 → UPDATE → reblog 元更新 → 関連 Status 更新を全て実行する。

#### 解決策 B: READ → メインスレッドで加工 → WRITE（複数往復）

```
Main Thread                          Worker
    │  execAsync(SELECT json ...)     │
    │ ─────────────────────────────▶  │
    │                                 │  return rows
    │  ◀─────────────────────────────  │
    │                                 │
    │  JSON.parse → 加工 → stringify  │
    │                                 │
    │  execBatch([UPDATE ...])        │
    │ ─────────────────────────────▶  │
    │                                 │  BEGIN; UPDATE; COMMIT;
    │  ◀─────────────────────────────  │
```

**2 往復** になるが動作はする。ただし READ と WRITE の間に他の書き込みが入る可能性がある。

#### 推奨: 解決策 A

JSON 加工は単純なフィールド代入なので Worker 内で完結させるべき。
ラウンドトリップ削減 + トランザクション内の一貫性が保てる。

### 3.3 問題3: `notify` メッセージの二重通知

#### 問題の詳細

設計書 02 では:
1. Worker が書き込み完了時に `{ type: 'notify', table: 'statuses' }` を送信
2. `workerClient.ts` がこれを受けて `notifyChange('statuses')` を呼ぶ
3. **同時に** Store 関数（メインスレッド）も `notifyChange('statuses')` を呼ぶ

→ リスナーが **2 回** 発火し、不要な再クエリが発生する。

#### 解決策: Worker からの `notify` メッセージを廃止

`notifyChange()` は **メインスレッドの Store 関数からのみ呼ぶ** 方針に統一する。

理由:
- Store 関数が `await execAsync/execBatch` で Worker の完了を待った後に呼ぶので、タイミングは正しい
- Worker → メインスレッドの通知は不要（Store 関数が通知責務を持つ）
- 二重通知のリスクがなくなる

```
■ 修正後の protocol.ts

// NotifyMessage を削除
export type WorkerMessage =
  | SuccessResponse
  | ErrorResponse
  | InitMessage
  // NotifyMessage は不要

■ 修正後の workerClient.ts

// notify ハンドラを削除
function handleMessage(event: MessageEvent<WorkerMessage>): void {
  switch (msg.type) {
    case 'init': ...
    case 'response': ...
    case 'error': ...
    // case 'notify' は不要
  }
}
```

---

## 4. 修正版アーキテクチャ

### 4.1 RPC メッセージ分類

前節の分析から、RPC メッセージを **3 種類** に分類する:

| 分類 | 用途 | 例 |
|------|------|-----|
| 汎用 READ | SELECT のみの操作 | `getStatusesByTimelineType`, `getNotifications`, `getBlockedInstances` |
| 汎用 WRITE | 単純な INSERT/UPDATE/DELETE（READ → WRITE 分岐なし） | `blockInstance`, `unblockInstance`, `muteAccount` |
| 専用ハンドラ | READ → 分岐/加工 → WRITE のトランザクション操作 | `upsertStatus`, `bulkUpsertStatuses`, `updateStatusAction` 等 |

### 4.2 修正版プロトコル

```
■ Main Thread → Worker

// 汎用: 単一 SQL 実行（READ 用）
type ExecRequest = {
  type: 'exec'
  id: number
  sql: string
  bind?: BindValue[]
  returnValue?: 'resultRows'
}

// 汎用: バッチ SQL 実行（単純 WRITE 用、分岐なし）
type ExecBatchRequest = {
  type: 'execBatch'
  id: number
  statements: { sql: string; bind?: BindValue[]; returnValue?: 'resultRows' }[]
  rollbackOnError: boolean
  returnIndices?: number[]
}

// 専用: Status 1件の upsert
type UpsertStatusRequest = {
  type: 'upsertStatus'
  id: number
  statusJson: string
  backendUrl: string
  timelineType: string
  tag?: string
}

// 専用: Status 複数件の一括 upsert
type BulkUpsertStatusesRequest = {
  type: 'bulkUpsertStatuses'
  id: number
  statusesJson: string[]    // JSON.stringify(Entity.Status) の配列
  backendUrl: string
  timelineType: string
  tag?: string
}

// 専用: Status のアクション状態更新
type UpdateStatusActionRequest = {
  type: 'updateStatusAction'
  id: number
  backendUrl: string
  statusId: string
  action: 'reblogged' | 'favourited' | 'bookmarked'
  value: boolean
}

// 専用: Status 全体の更新（編集された投稿用）
type UpdateStatusRequest = {
  type: 'updateStatus'
  id: number
  statusJson: string
  backendUrl: string
}

// 専用: delete イベントの処理
type HandleDeleteEventRequest = {
  type: 'handleDeleteEvent'
  id: number
  backendUrl: string
  statusId: string
  sourceTimelineType: string
  tag?: string
}

// 専用: タイムラインからの除外
type RemoveFromTimelineRequest = {
  type: 'removeFromTimeline'
  id: number
  backendUrl: string
  statusId: string
  timelineType: string
  tag?: string
}

// 専用: Notification 追加
type AddNotificationRequest = {
  type: 'addNotification'
  id: number
  notificationJson: string
  backendUrl: string
}

// 専用: Notification 一括追加
type BulkAddNotificationsRequest = {
  type: 'bulkAddNotifications'
  id: number
  notificationsJson: string[]
  backendUrl: string
}

// 専用: Notification 内 Status アクション更新
type UpdateNotificationStatusActionRequest = {
  type: 'updateNotificationStatusAction'
  id: number
  backendUrl: string
  statusId: string
  action: 'reblogged' | 'favourited' | 'bookmarked'
  value: boolean
}

// 専用: MAX_LENGTH クリーンアップ
type EnforceMaxLengthRequest = {
  type: 'enforceMaxLength'
  id: number
}

// 専用: IndexedDB マイグレーションデータの書き込み
type MigrationWriteRequest = {
  type: 'migrationWrite'
  id: number
  statusBatches: MigrationStatusBatch[]
  notificationBatches: MigrationNotificationBatch[]
}

// 初期化完了確認
type ReadyRequest = {
  type: 'ready'
  id: number
}

type WorkerRequest =
  | ExecRequest
  | ExecBatchRequest
  | UpsertStatusRequest
  | BulkUpsertStatusesRequest
  | UpdateStatusActionRequest
  | UpdateStatusRequest
  | HandleDeleteEventRequest
  | RemoveFromTimelineRequest
  | AddNotificationRequest
  | BulkAddNotificationsRequest
  | UpdateNotificationStatusActionRequest
  | EnforceMaxLengthRequest
  | MigrationWriteRequest
  | ReadyRequest

■ Worker → Main Thread

type SuccessResponse = {
  type: 'response'
  id: number
  result: unknown
  // 書き込み操作の場合、変更されたテーブル名を返す
  changedTables?: ('statuses' | 'notifications')[]
}

type ErrorResponse = {
  type: 'error'
  id: number
  error: string
}

type InitMessage = {
  type: 'init'
  persistence: 'opfs' | 'memory'
}

type WorkerMessage = SuccessResponse | ErrorResponse | InitMessage
```

### 4.3 修正版の `changedTables` による通知制御

Worker からの `notify` メッセージを廃止する代わりに、
`SuccessResponse` に `changedTables` フィールドを追加する。

```
■ workerClient.ts（修正版）

function handleMessage(event: MessageEvent<WorkerMessage>): void {
  const msg = event.data

  switch (msg.type) {
    case 'response': {
      const req = pending.get(msg.id)
      if (req) {
        pending.delete(msg.id)
        // 書き込み操作の場合、changedTables を元に notifyChange を発火
        if (msg.changedTables) {
          for (const table of msg.changedTables) {
            notifyChangeCallback?.(table)
          }
        }
        req.resolve(msg.result)
      }
      break
    }
    // ...
  }
}
```

これにより:
- 通知は **Worker の応答受信時に 1 回だけ** 発火する
- Store 関数側の `notifyChange()` 呼び出しは **削除** する
- 通知タイミングは変わらない（Worker の応答 = COMMIT 完了後）
- 二重通知のリスクがない

### 4.4 Store 関数の変更パターン（修正版）

#### パターン A: 専用ハンドラに委譲（トランザクション内 READ → WRITE）

```
■ Before (statusStore.ts)

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
    // ... 50+ 行のトランザクション処理 ...
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
  notifyChange('statuses')
}

■ After (statusStore.ts)

export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({     // 型安全な RPC 送信
    type: 'upsertStatus',
    statusJson: JSON.stringify(status),
    backendUrl,
    timelineType,
    tag,
  })
  // notifyChange は workerClient が changedTables を元に自動発火
}
```

**Store 関数が劇的にシンプルになる。** ビジネスロジックは Worker 側に移動。

#### パターン B: 汎用 execAsync を使用（READ のみ）

```
■ Before (Hook 内)

const handle = await getSqliteDb()
const { db } = handle
const rows = db.exec(sql, { bind, returnValue: 'resultRows' })

■ After (Hook 内)

const handle = await getSqliteDb()
const rows = await handle.execAsync(sql, { bind, returnValue: 'resultRows' })
```

Hook 層のクエリは **1 行の変更** で済む。

#### パターン C: 汎用 execBatch を使用（単純 WRITE、分岐なし）

```
■ InstanceBlockManager の blockInstance()

// Before
const handle = await getSqliteDb()
handle.db.exec('INSERT OR IGNORE INTO blocked_instances ...', { bind: [...] })
notifyChange('statuses')

// After
const handle = await getSqliteDb()
await handle.execBatch([
  { sql: 'INSERT OR IGNORE INTO blocked_instances ...', bind: [...] }
], { rollbackOnError: false })
// notifyChange は workerClient が changedTables を元に自動発火
```

---

## 5. Worker 側のコード構成

### 5.1 ディレクトリ構成（修正版）

```
src/util/db/sqlite/
├── protocol.ts          # RPC メッセージ型定義
├── workerClient.ts      # メインスレッド側 RPC クライアント
├── initSqlite.ts        # DbHandle 生成 (Worker or フォールバック)
├── connection.ts        # subscribe / notifyChange + getSqliteDb
├── index.ts             # バレルエクスポート
│
├── worker/
│   ├── sqlite.worker.ts      # Worker エントリーポイント + メッセージルーター
│   ├── workerStatusStore.ts  # Worker 側: Status 関連のトランザクション処理
│   ├── workerNotificationStore.ts  # Worker 側: Notification 関連
│   ├── workerCleanup.ts      # Worker 側: クリーンアップ
│   ├── workerMigration.ts    # Worker 側: マイグレーションデータ書き込み
│   └── workerSchema.ts       # Worker 側: スキーマ管理 (既存 schema.ts を流用)
│
├── statusStore.ts        # メインスレッド側: 薄いラッパー（Worker に委譲）
├── notificationStore.ts  # メインスレッド側: 薄いラッパー
├── cleanup.ts           # メインスレッド側: 薄いラッパー
├── migration.ts         # メインスレッド側: Dexie 読み取り → Worker に書き込み依頼
└── schema.ts            # Worker 内部で使用（型は SchemaDbHandle）
```

### 5.2 責務分離

```
■ メインスレッド側（statusStore.ts 等）

責務:
  - 公開 API のシグネチャ維持
  - 引数のシリアライズ（JSON.stringify）
  - Worker へのコマンド送信
  - 戻り値のデシリアライズ（型キャスト）

やらないこと:
  - SQL の組み立て
  - トランザクション制御
  - JSON パース/加工
  - notifyChange の呼び出し（workerClient が担当）

■ Worker 側（workerStatusStore.ts 等）

責務:
  - SQL の組み立てと実行
  - トランザクション制御（BEGIN / COMMIT / ROLLBACK）
  - JSON パース/加工（updateStatusAction 等）
  - URI キャッシュ管理（bulkUpsertStatuses）
  - changedTables の返却
```

### 5.3 Worker 側の実装イメージ

```typescript
// worker/workerStatusStore.ts（イメージ）

import type { Database } from '@sqlite.org/sqlite-wasm'

export function handleUpsertStatus(
  db: Database,
  statusJson: string,
  backendUrl: string,
  timelineType: string,
  tag?: string,
): { changedTables: string[] } {
  const status = JSON.parse(statusJson)
  const normalizedUri = status.uri?.trim() || ''
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()
  const cols = extractStatusColumnsInternal(status)

  db.exec('BEGIN;')
  try {
    // URI で既存行を検索
    let compositeKey: string
    const existingRows = normalizedUri
      ? (db.exec('SELECT compositeKey FROM statuses WHERE uri = ?;', {
          bind: [normalizedUri],
          returnValue: 'resultRows',
        }) as string[][])
      : []

    if (existingRows.length > 0) {
      compositeKey = existingRows[0][0]
      db.exec('UPDATE statuses SET ... WHERE compositeKey = ?;', {
        bind: [/* ... */, compositeKey],
      })
    } else {
      compositeKey = `${backendUrl}:${status.id}`
      db.exec('INSERT INTO statuses (...) VALUES (...) ON CONFLICT ...;', {
        bind: [/* ... */],
      })
    }

    db.exec('INSERT OR IGNORE INTO statuses_backends ...;', {
      bind: [compositeKey, backendUrl, status.id],
    })
    db.exec('INSERT OR IGNORE INTO statuses_timeline_types ...;', {
      bind: [compositeKey, timelineType],
    })

    // タグ
    for (const t of status.tags) {
      db.exec('INSERT OR IGNORE INTO statuses_belonging_tags ...;', {
        bind: [compositeKey, t.name],
      })
    }
    if (tag) {
      db.exec('INSERT OR IGNORE INTO statuses_belonging_tags ...;', {
        bind: [compositeKey, tag],
      })
    }

    // メンション
    db.exec('DELETE FROM statuses_mentions WHERE compositeKey = ?;', {
      bind: [compositeKey],
    })
    for (const mention of status.mentions) {
      db.exec('INSERT OR IGNORE INTO statuses_mentions ...;', {
        bind: [compositeKey, mention.acct],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
}
```

---

## 6. `extractStatusColumns` / `resolveCompositeKey` の配置

### 6.1 現状

これらのヘルパー関数は `statusStore.ts` にあり、メインスレッドで実行されている:

- `extractStatusColumns(status)` — Entity.Status から正規化カラムを抽出
- `resolveCompositeKey(handle, backendUrl, localId)` — statuses_backends 経由で compositeKey を解決
- `upsertMentions(handle, compositeKey, mentions)` — メンション書き込み
- `createCompositeKey(backendUrl, id)` — compositeKey 生成

### 6.2 移行後

| 関数 | 配置先 | 理由 |
|------|--------|------|
| `extractStatusColumns` | Worker 側 (`worker/workerStatusStore.ts`) | SQL 実行と同じコンテキストで使うため |
| `resolveCompositeKey` | Worker 側 | DB アクセスが必要なため Worker 内で実行 |
| `upsertMentions` | Worker 側 | DB アクセスが必要 |
| `createCompositeKey` | **両方** (共有ユーティリティ) | 純粋関数なのでどちらでも使える |
| `toStoredStatus` | メインスレッド側 | DB アクセス不要、型変換のみ |
| `extractNotificationColumns` | Worker 側 | SQL 実行と同じコンテキスト |

共有可能な純粋関数は `src/util/db/sqlite/shared.ts` に抽出し、
Worker とメインスレッドの両方から import できるようにする。

---

## 7. Hook 層への影響まとめ

### 7.1 変更が必要な箇所

| Hook / Component | 現行の DB アクセスパターン | 変更内容 |
|---|---|---|
| `useTimeline.ts` | `handle.db.exec(SELECT ...)` | `await handle.execAsync(SELECT ...)` |
| `useFilteredTimeline.ts` | 同上 | 同上 |
| `useFilteredTagTimeline.ts` | 同上 | 同上 |
| `useCustomQueryTimeline.ts` | 同上 | 同上 |
| `useNotifications.ts` | 同上 | 同上 |
| `InstanceBlockManager.tsx` | `handle.db.exec(INSERT/SELECT/DELETE ...)` | `await handle.execAsync(...)` or `await handle.execBatch(...)` |
| `MuteManager.tsx` | 同上 | 同上 |
| `UnifiedTimeline.tsx` | `handle.db.exec(SELECT ...)` | `await handle.execAsync(...)` |

### 7.2 変更が不要な箇所

| コード | 理由 |
|--------|------|
| `StatusStoreProvider.tsx` | Store 関数 (`upsertStatus` 等) を `await` で呼んでいるだけ。Store 関数の内部変更は透過的 |
| `StreamingManagerProvider.tsx` | 同上 |
| `timelineFetcher.ts` | `bulkUpsertStatuses` を `await` で呼んでいるだけ |
| `subscribe` / `notifyChange` の呼び出し元 | コード変更なし（`subscribe` は Hook 内、`notifyChange` は workerClient に統合） |

### 7.3 Hook 内の変更例

```typescript
// ===== Before (useFilteredTimeline.ts) =====
const fetchData = useCallback(async () => {
  // ...
  const handle = await getSqliteDb()
  const { db } = handle

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  // ...
  setStatuses(results)
}, [deps])

// ===== After =====
const fetchData = useCallback(async () => {
  // ...
  const handle = await getSqliteDb()

  const rows = await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  // ...
  setStatuses(results)
}, [deps])
```

変更点は **2 行だけ**:
1. `const { db } = handle` を削除
2. `db.exec(...)` → `await handle.execAsync(...)`

`fetchData` は元から `async` 関数なので、`await` の追加で型エラーにはならない。

---

## 8. 並行書き込み時の挙動

### 8.1 シナリオ: 2 つのストリーミングイベントが短時間で到着

```
t0: WebSocket A: update イベント → upsertStatus(statusA)
t1: WebSocket B: update イベント → upsertStatus(statusB)

■ 現行（メインスレッド同期）

  t0: upsertStatus(A) 開始
  t1:   db.exec(INSERT A) ← 同期完了
  t2:   notifyChange() → リスナー fetchData() 発火（A を含む結果を返す）
  t3: upsertStatus(A) 完了
  t4: upsertStatus(B) 開始
  t5:   db.exec(INSERT B) ← 同期完了
  t6:   notifyChange() → リスナー fetchData() 発火（A, B を含む結果を返す）
  t7: upsertStatus(B) 完了

  → fetchData は 2 回発火。2 回目で A, B 両方が表示される。

■ Worker 化後（非同期RPC）

  t0: upsertStatus(A) 開始 → Worker に送信
  t1: upsertStatus(B) 開始 → Worker に送信
        ↑ await の間に B の呼び出しが始まる可能性がある

  ケース 1: A の await が完了してから B を呼ぶ場合
            （StatusStoreProvider の onUpdate が await しているため）
    → 現行と同じ動作

  ケース 2: A と B が独立して（別の streaming source から）呼ばれる場合
    t0: Worker: INSERT A → COMMIT
    t1: Main:   A 完了通知 → notifyChange → fetchData 発火
    t2: Worker: INSERT B → COMMIT
    t3: Main:   B 完了通知 → notifyChange → fetchData 発火
    → fetchData は 2 回発火。Worker の SQLite はシングルスレッドなので
      INSERT A と INSERT B は直列実行される。問題なし。
```

### 8.2 結論

Worker の SQLite がシングルスレッドであることが、並行書き込みの安全性を保証する。
メインスレッド側で書き込みリクエストが並行して送信されても、Worker 内では直列実行される。

---

## 9. 設計書 02 からの差分まとめ

| 項目 | 02-design.md の設計 | 本文書での修正 |
|------|-------------------|-----------     |
| RPC メッセージ | `exec` + `execBatch` の 2 種類 | `exec` + `execBatch` + **専用ハンドラ 10+ 種類** |
| トランザクション内 READ → WRITE | メインスレッドで statements 配列を事前構築 | **Worker 側で完全実行**（現行ロジックをそのまま移植） |
| JSON パース/加工 | メインスレッドで実行 → WRITE を送信 | **Worker 側で実行** |
| `notifyChange` | Store 関数から呼び出し + Worker `notify` メッセージ（二重通知リスク） | **`changedTables` による一元管理**（workerClient が自動発火） |
| Store 関数の責務 | SQL 組み立て + execAsync/execBatch 呼び出し | **Worker へのコマンド送信のみ**（薄いラッパー化） |
| Worker 側のコード | SQL 実行のみ（`handleExec`, `handleExecBatch`） | **ビジネスロジック含む**（`handleUpsertStatus` 等） |
| ファイル構成 | `sqlite.worker.ts` 1 ファイル | `worker/` ディレクトリに分離（ルーター + 各ドメイン） |
| `resolveCompositeKey` | メインスレッドで非同期化 | **Worker 側に移動**（DB アクセスが Worker 内で完結） |
| `extractStatusColumns` | メインスレッドで実行 | **Worker 側に移動** |
| `upsertMentions` | メインスレッドで非同期化 | **Worker 側に移動** |

---

## 10. フォールバックモードでの互換性

Worker が使えない場合のフォールバックモード（メインスレッド + インメモリ DB）でも
同じ `DbHandle` インターフェースを使う。

```typescript
// initSqlite.ts フォールバック部分

async function initMainThreadFallback(): Promise<DbHandle> {
  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  const sqlite3 = await initSqlite()
  const db = new sqlite3.oo1.DB(':memory:', 'c')

  // ... PRAGMA 設定 ...
  ensureSchema({ db, sqlite3 })

  return {
    // 汎用 READ
    execAsync: async (sql, opts) => {
      if (opts?.returnValue === 'resultRows') {
        return db.exec(sql, { bind: opts.bind ?? undefined, returnValue: 'resultRows' })
      }
      db.exec(sql, { bind: opts?.bind ?? undefined })
      return undefined
    },

    // 汎用 WRITE
    execBatch: async (statements, opts) => {
      // ... 同期実行ラッパー ...
    },

    // 専用ハンドラ: メインスレッドで直接実行
    sendCommand: async (command) => {
      // Worker に送る代わりに、メインスレッドで直接実行
      switch (command.type) {
        case 'upsertStatus':
          return handleUpsertStatusLocal(db, command)
        case 'bulkUpsertStatuses':
          return handleBulkUpsertStatusesLocal(db, command)
        // ... 他のコマンド ...
      }
    },

    persistence: 'memory',
  }
}
```

フォールバック用の `handleXxxLocal` 関数は、Worker 側の `handleXxx` と **同じロジック** を
共有モジュール（`worker/workerStatusStore.ts`）から import して使う。

Worker 側も `import { handleUpsertStatus } from './workerStatusStore'` で同じ関数を使う。

```
■ コード共有構造

worker/workerStatusStore.ts
  └── handleUpsertStatus(db, ...)  ← 生の Database を引数に取る純粋関数
        │
        ├── Worker: sqlite.worker.ts が onmessage から呼ぶ
        └── Main Thread: initMainThreadFallback() の sendCommand から呼ぶ
```

これにより:
- Worker モードとフォールバックモードで **同一のビジネスロジック** が実行される
- テストは `better-sqlite3` + Worker 側関数の直接呼び出しで行える（Worker を介さない）
- コードの重複がない

---

## 11. 修正版の実施ステップ

| Step | 内容 | 02-design.md からの変更 |
|------|------|------------------------|
| 1 | `protocol.ts` 作成 | 専用ハンドラのメッセージ型を追加 |
| 2 | `worker/workerStatusStore.ts` 作成 | **新規**: 現行 statusStore.ts のトランザクションロジックを移植 |
| 3 | `worker/workerNotificationStore.ts` 作成 | **新規**: 現行 notificationStore.ts のロジックを移植 |
| 4 | `worker/workerCleanup.ts` 作成 | **新規**: 現行 cleanup.ts のロジックを移植 |
| 5 | `worker/sqlite.worker.ts` 作成 | メッセージルーター（handleXxx を呼び分け） |
| 6 | `workerClient.ts` 作成 | `changedTables` による通知制御を追加 |
| 7 | `initSqlite.ts` 書換 | Worker モード + フォールバックモード（共有ロジック） |
| 8 | `connection.ts` 修正 | `ensureSchema` 削除、`DbHandle` 型更新 |
| 9 | `statusStore.ts` 書換 | 薄いラッパー化（`sendCommand` 呼び出しのみ） |
| 10 | `notificationStore.ts` 書換 | 同上 |
| 11 | `cleanup.ts` 書換 | 同上 |
| 12 | `migration.ts` 書換 | Dexie 読み取り → Worker に書き込みデータを送信 |
| 13 | Hook 層の変更 | `db.exec(...)` → `await handle.execAsync(...)` |
| 14 | コンポーネント層の変更 | 同上 |
| 15 | テスト実行 | Worker 側関数を直接呼び出してテスト |

---

## 12. まとめ

### リアクティブ性は維持できるか？

**YES。** ただし設計書 02 の `execBatch` 方式では不十分。

### 必要な設計修正

1. **専用ハンドラの導入**: トランザクション内 READ → WRITE パターンは Worker 側に専用ハンドラを設け、ビジネスロジックごと Worker に移す
2. **`notify` メッセージの廃止**: `changedTables` レスポンスフィールドで一元管理し、二重通知を防ぐ
3. **Store 関数の薄いラッパー化**: メインスレッドの Store 関数は Worker へのコマンド送信のみを担当
4. **ビジネスロジックの共有**: Worker 側関数をフォールバックモードでも使い回し、コード重複を防ぐ
