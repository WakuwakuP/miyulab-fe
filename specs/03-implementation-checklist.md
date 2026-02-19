# 03. 実装チェックリスト — SQLite OPFS Worker 移行（修正版）

## 概要

`00-migration-plan.md` / `01-test-plan.md` / `02-design.md` / **`04-reactive-behavior-analysis.md`** に基づく実装作業の詳細チェックリスト。

> **重要**: 本チェックリストは `04-reactive-behavior-analysis.md` の修正内容を全面的に反映している。
> `02-design.md` の設計のうち、以下の点が修正されている:
>
> 1. **専用ハンドラの導入**: `exec` / `execBatch` のみの汎用 RPC → 専用ハンドラ（`upsertStatus`, `bulkUpsertStatuses` 等）を追加
> 2. **`NotifyMessage` の廃止**: Worker → Main の `notify` メッセージ → `SuccessResponse.changedTables` による一元管理
> 3. **Store 関数の薄いラッパー化**: Store 関数は Worker へのコマンド送信のみ担当
> 4. **ビジネスロジックの Worker 移動**: トランザクション内 READ → WRITE ロジックは Worker 側で完全実行
> 5. **`worker/` ディレクトリの新設**: ドメインごとのハンドラファイルを分離

---

## Phase 1: テスト基盤の構築

### 1.1 devDependencies の追加

- [ ] `vitest` を追加
- [ ] `better-sqlite3` を追加
- [ ] `@types/better-sqlite3` を追加
- [ ] `package.json` に scripts を追加:
  - `"test": "vitest run"`
  - `"test:watch": "vitest"`
  - `"test:coverage": "vitest run --coverage"`

### 1.2 Vitest 設定

- [ ] `vitest.config.ts` を作成
  - `resolve.alias` で `util` → `src/util`, `types` → `src/types` を設定
  - `test.globals: true`
  - `test.environment: 'node'`
  - `test.include: ['src/**/*.test.ts']`
  - `test.setupFiles` にセットアップファイルを指定

### 1.3 テストヘルパーの作成

- [ ] `src/util/db/sqlite/__tests__/helpers/setup.ts` — グローバルセットアップ
  - `vi.mock` で `@sqlite.org/sqlite-wasm` をモック化
  - `localStorage` のモック設定
- [ ] `src/util/db/sqlite/__tests__/helpers/testDb.ts` — better-sqlite3 互換アダプタ
  - `createTestDb()`: インメモリ better-sqlite3 を `DbHandle` 互換でラップ
  - `db.exec(sql, { bind, returnValue })` の互換メソッド
  - `resultRows` の返り値を `(string | number)[][]` 形式に変換
  - `createTestHandle()`: `ensureSchema` 適用済みの `DbHandle` を返す
- [ ] `src/util/db/sqlite/__tests__/helpers/fixtures.ts` — テスト用モックデータ
  - `createMockStatus(overrides?)`: `Entity.Status` ファクトリ
  - `createMockNotification(overrides?)`: `Entity.Notification` ファクトリ
  - `createMockAccount(overrides?)`: `Entity.Account` ファクトリ
  - `createMockMention(overrides?)`: `Entity.Mention` ファクトリ
  - `BACKEND_URL_1`, `BACKEND_URL_2`: テスト用バックエンド URL 定数

---

## Phase 2: テストコードの作成

### 2.1 schema.test.ts

- [ ] 1.1.1: フレッシュインストールで v3 スキーマが作成される（`PRAGMA user_version` = 3）
- [ ] 1.1.2: `statuses` テーブルの全カラムが存在する
- [ ] 1.1.3: `statuses_timeline_types` テーブルが作成される
- [ ] 1.1.4: `statuses_belonging_tags` テーブルが作成される
- [ ] 1.1.5: `statuses_mentions` テーブルが作成される
- [ ] 1.1.6: `statuses_backends` テーブルが作成される
- [ ] 1.1.7: `muted_accounts` テーブルが作成される
- [ ] 1.1.8: `blocked_instances` テーブルが作成される
- [ ] 1.1.9: `notifications` テーブルの全カラムが存在する
- [ ] 1.1.10: 全インデックスが作成される
- [ ] 1.1.11: FOREIGN KEY CASCADE 削除が機能する
- [ ] 1.2.1: v1 → v2 → v3 マイグレーション
- [ ] 1.2.2: v2 → v3 マイグレーション
- [ ] 1.2.3: v3 → v3 でスキップ
- [ ] 1.2.4: 冪等性の確認
- [ ] 1.3.1: マイグレーション中のエラーで ROLLBACK

### 2.2 statusStore.test.ts

- [ ] 2.1.1: `createCompositeKey` の基本テスト
- [ ] 2.2.1〜2.2.7: `extractStatusColumns` の全パターン
- [ ] 2.3.1〜2.3.13: `upsertStatus` の全パターン
- [ ] 2.4.1〜2.4.6: `bulkUpsertStatuses` の全パターン
- [ ] 2.5.1〜2.5.2: `resolveCompositeKey` の全パターン
- [ ] 2.6.1〜2.6.3: `upsertMentions` の全パターン
- [ ] 2.7.1〜2.7.5: `removeFromTimeline` の全パターン
- [ ] 2.8.1〜2.8.7: `handleDeleteEvent` の全パターン
- [ ] 2.9.1〜2.9.6: `updateStatusAction` の全パターン
- [ ] 2.10.1〜2.10.4: `updateStatus` の全パターン
- [ ] 2.11.1〜2.11.6: `getStatusesByTimelineType` の全パターン
- [ ] 2.12.1〜2.12.4: `getStatusesByTag` の全パターン
- [ ] 2.13.1〜2.13.8: `getStatusesByCustomQuery` の全パターン
- [ ] 2.14.1: `toStoredStatus` の基本テスト
- [ ] 2.15.1〜2.15.4: `validateCustomQuery` の全パターン

### 2.3 notificationStore.test.ts

- [ ] 3.1.1〜3.1.3: `extractNotificationColumns` の全パターン
- [ ] 3.2.1〜3.2.5: `addNotification` の全パターン
- [ ] 3.3.1〜3.3.4: `bulkAddNotifications` の全パターン
- [ ] 3.4.1〜3.4.5: `getNotifications` の全パターン
- [ ] 3.5.1〜3.5.4: `updateNotificationStatusAction` の全パターン

### 2.4 cleanup.test.ts

- [ ] 4.1.1〜4.1.7: `enforceMaxLength` の全パターン
- [ ] 4.2.1〜4.2.2: `startPeriodicCleanup` の全パターン

### 2.5 connection.test.ts

- [ ] 5.1.1〜5.1.6: `subscribe` / `notifyChange` の全パターン
- [ ] 5.2.1〜5.2.3: `getSqliteDb` の全パターン

### 2.6 migration.test.ts

- [ ] 6.1.1〜6.1.3: `isMigrated` の全パターン
- [ ] 6.2.1〜6.2.11: `migrateFromIndexedDb` の全パターン（Dexie モック使用）

### 2.7 integration.test.ts

- [ ] 7.1.1〜7.1.6: エンドツーエンドのデータフロー
- [ ] 7.2.1〜7.2.5: 跨サーバー重複排除 (v3)
- [ ] 7.3.1〜7.3.2: クリーンアップとの統合
- [ ] 7.4.1〜7.4.3: subscribe の統合
- [ ] 7.5.1〜7.5.8: カスタムクエリ

> **テスト方針 (04-reactive-behavior-analysis §10 に基づく)**:
> テストでは Worker 側の関数（`handleUpsertStatus` 等）を直接呼び出し、
> `better-sqlite3` の DB インスタンスを渡す。Worker の postMessage を介さないため
> Node.js 環境で高速にテスト可能。

---

## Phase 3: テスト実行・確認

- [ ] `yarn test` で全テストが PASS する
- [ ] テスト結果のスクリーンショットまたはログを記録
- [ ] 失敗するテストがある場合はテストコードを修正（プロダクションコードは変更しない）

---

## Phase 4: Worker 基盤の実装

### 4.1 共有ユーティリティの分離

- [ ] `src/util/db/sqlite/shared.ts` を作成
  - `createCompositeKey(backendUrl, id)` — 純粋関数。Worker / メインスレッド両方で使用
  - `BindValue` 型エイリアス: `(string | number | null)`
  - Worker モードとフォールバックモードの両方で import 可能な共通定数

### 4.2 型定義

- [ ] `src/util/db/sqlite/protocol.ts` を作成（**04 修正版プロトコル**）

  #### Main Thread → Worker リクエスト型

  - [ ] `ExecRequest` — 汎用 READ（SELECT のみの操作用）
  - [ ] `ExecBatchRequest` — 汎用 WRITE（単純な INSERT/UPDATE/DELETE、分岐なし）
  - [ ] `ReadyRequest` — Worker 初期化完了確認

  #### 専用ハンドラリクエスト型（**04 で追加**）

  - [ ] `UpsertStatusRequest` — Status 1 件の upsert
    - フィールド: `statusJson: string`, `backendUrl`, `timelineType`, `tag?`
  - [ ] `BulkUpsertStatusesRequest` — Status 複数件の一括 upsert
    - フィールド: `statusesJson: string[]`, `backendUrl`, `timelineType`, `tag?`
  - [ ] `UpdateStatusActionRequest` — Status のアクション状態更新
    - フィールド: `backendUrl`, `statusId`, `action`, `value`
  - [ ] `UpdateStatusRequest` — Status 全体の更新（編集された投稿用）
    - フィールド: `statusJson: string`, `backendUrl`
  - [ ] `HandleDeleteEventRequest` — delete イベント処理
    - フィールド: `backendUrl`, `statusId`, `sourceTimelineType`, `tag?`
  - [ ] `RemoveFromTimelineRequest` — タイムラインからの除外
    - フィールド: `backendUrl`, `statusId`, `timelineType`, `tag?`
  - [ ] `AddNotificationRequest` — Notification 追加
    - フィールド: `notificationJson: string`, `backendUrl`
  - [ ] `BulkAddNotificationsRequest` — Notification 一括追加
    - フィールド: `notificationsJson: string[]`, `backendUrl`
  - [ ] `UpdateNotificationStatusActionRequest` — Notification 内 Status アクション更新
    - フィールド: `backendUrl`, `statusId`, `action`, `value`
  - [ ] `EnforceMaxLengthRequest` — MAX_LENGTH クリーンアップ
  - [ ] `MigrationWriteRequest` — IndexedDB マイグレーションデータの書き込み
    - フィールド: `statusBatches`, `notificationBatches`

  #### Worker → Main Thread レスポンス型

  - [ ] `SuccessResponse` — 成功レスポンス
    - **`changedTables?: ('statuses' | 'notifications')[]`** を含む（**04 で追加**）
  - [ ] `ErrorResponse` — エラーレスポンス
  - [ ] `InitMessage` — Worker 初期化完了通知
    - フィールド: `persistence: 'opfs' | 'memory'`

  #### Union 型

  - [ ] `WorkerRequest` — 全リクエスト型の union（`ExecRequest | ExecBatchRequest | 全専用ハンドラ | ReadyRequest`）
  - [ ] `WorkerMessage` — 全レスポンス型の union（`SuccessResponse | ErrorResponse | InitMessage`）

  > **注意**: `NotifyMessage` は **定義しない**（04 §3.3 により廃止）。
  > 代わりに `SuccessResponse.changedTables` で通知を制御する。

- [ ] `src/util/db/sqlite/types.ts` を作成
  - 新しい `DbHandle` 型:
    - `execAsync(sql, opts)`: `Promise<unknown>` — 汎用 READ 用
    - `execBatch(statements, opts)`: `Promise<Record<number, unknown>>` — 汎用 WRITE 用
    - `sendCommand(command)`: `Promise<unknown>` — **専用ハンドラ呼び出し用**（04 で追加）
    - `persistence`: `'opfs' | 'memory'`
  - `SendCommandPayload` 型 — `sendCommand` に渡すコマンドの union 型（`WorkerRequest` から `id` と汎用型を除外）

### 4.3 Worker 側ドメインモジュールの作成（**04 で追加**）

> **04 §5 に基づく設計**: ビジネスロジック（トランザクション内 READ → WRITE ループ、JSON パース/加工、URI キャッシュ）は
> Worker 側のドメインモジュールで実行する。これらのモジュールは生の `Database` オブジェクトを引数に取る純粋関数群であり、
> フォールバックモード（メインスレッド）からも直接 import して呼び出せる。

- [ ] `src/util/db/sqlite/worker/workerStatusStore.ts` を作成
  - `handleUpsertStatus(db, statusJson, backendUrl, timelineType, tag?)` → `{ changedTables }`
    - 現行 `statusStore.ts` の `upsertStatus` のトランザクションロジックを移植
    - URI 検索 → 分岐 → INSERT or UPDATE → 関連テーブル書き込み → メンション書き込み
  - `handleBulkUpsertStatuses(db, statusesJson, backendUrl, timelineType, tag?)` → `{ changedTables }`
    - 現行 `bulkUpsertStatuses` のループ + URI キャッシュ + トランザクションを移植
  - `handleUpdateStatusAction(db, backendUrl, statusId, action, value)` → `{ changedTables }`
    - SELECT json → JSON.parse → フィールド変更 → JSON.stringify → UPDATE
    - reblog 元の更新、関連 Status の更新も含む（**Worker 内で JSON 加工** — 04 §3.2 解決策 A）
  - `handleUpdateStatus(db, statusJson, backendUrl)` → `{ changedTables }`
    - 現行 `updateStatus` のロジックを移植
  - `handleDeleteEvent(db, backendUrl, statusId, sourceTimelineType, tag?)` → `{ changedTables }`
    - `resolveCompositeKey` → 分岐 → 削除パターン選択
  - `handleRemoveFromTimeline(db, backendUrl, statusId, timelineType, tag?)` → `{ changedTables }`
    - 残数確認 SELECT → 条件付き物理削除
  - 内部ヘルパー（Worker 内で使用）:
    - `extractStatusColumnsInternal(status)` — 現行 `extractStatusColumns` を移植
    - `resolveCompositeKeyInternal(db, backendUrl, localId)` — 現行 `resolveCompositeKey` を移植
    - `upsertMentionsInternal(db, compositeKey, mentions)` — 現行 `upsertMentions` を移植

- [ ] `src/util/db/sqlite/worker/workerNotificationStore.ts` を作成
  - `handleAddNotification(db, notificationJson, backendUrl)` → `{ changedTables }`
  - `handleBulkAddNotifications(db, notificationsJson, backendUrl)` → `{ changedTables }`
  - `handleUpdateNotificationStatusAction(db, backendUrl, statusId, action, value)` → `{ changedTables }`
    - SELECT → JSON パース → フィールド変更 → UPDATE（Worker 内で完結）
  - 内部ヘルパー:
    - `extractNotificationColumnsInternal(notification)` — 現行 `extractNotificationColumns` を移植

- [ ] `src/util/db/sqlite/worker/workerCleanup.ts` を作成
  - `handleEnforceMaxLength(db)` → `{ changedTables }`
    - 現行 `enforceMaxLength` のトランザクションロジックを移植

- [ ] `src/util/db/sqlite/worker/workerMigration.ts` を作成
  - `handleMigrationWrite(db, statusBatches, notificationBatches)` → `{ changedTables }`
    - マイグレーションデータの一括書き込み（Dexie 読み取りはメインスレッド側で実行）

- [ ] `src/util/db/sqlite/worker/workerSchema.ts` を作成
  - 既存 `schema.ts` を流用（Worker 内で `ensureSchema` を呼ぶためのラッパー）
  - `SchemaDbHandle` 型を定義: `{ db: Database | OpfsDatabase; sqlite3: Sqlite3Static }`
  - `ensureSchema(handle: SchemaDbHandle)` — Worker 初期化時に呼ばれる

### 4.4 Worker エントリーポイント

- [ ] `src/util/db/sqlite/worker/sqlite.worker.ts` を作成
  - `init()`: OPFS SAH Pool → 通常 OPFS → メモリ DB のフォールバックチェーン
    - `installOpfsSAHPoolVfs` を試行（`@sqlite.org/sqlite-wasm` のバージョン互換を確認）
    - 失敗時は `sqlite3.oo1.OpfsDb` → `sqlite3.oo1.DB(':memory:')` にフォールバック
    - PRAGMA 設定（WAL, synchronous, foreign_keys）
    - `ensureSchema()` を Worker 内で呼び出し
    - 初期化完了時に `{ type: 'init', persistence }` を送信
  - **メッセージルーター** (`self.onmessage`):
    - `exec` → `handleExec()` — 汎用 SQL 実行
    - `execBatch` → `handleExecBatch()` — バッチ SQL 実行（BEGIN/COMMIT/ROLLBACK 自動制御）
    - `ready` → `{ type: 'response', id, result: { persistence } }`
    - `upsertStatus` → `workerStatusStore.handleUpsertStatus(db, ...)`
    - `bulkUpsertStatuses` → `workerStatusStore.handleBulkUpsertStatuses(db, ...)`
    - `updateStatusAction` → `workerStatusStore.handleUpdateStatusAction(db, ...)`
    - `updateStatus` → `workerStatusStore.handleUpdateStatus(db, ...)`
    - `handleDeleteEvent` → `workerStatusStore.handleDeleteEvent(db, ...)`
    - `removeFromTimeline` → `workerStatusStore.handleRemoveFromTimeline(db, ...)`
    - `addNotification` → `workerNotificationStore.handleAddNotification(db, ...)`
    - `bulkAddNotifications` → `workerNotificationStore.handleBulkAddNotifications(db, ...)`
    - `updateNotificationStatusAction` → `workerNotificationStore.handleUpdateNotificationStatusAction(db, ...)`
    - `enforceMaxLength` → `workerCleanup.handleEnforceMaxLength(db)`
    - `migrationWrite` → `workerMigration.handleMigrationWrite(db, ...)`
  - 全ハンドラの戻り値 `{ changedTables }` を `SuccessResponse` に含めて送信
  - エラー時は `ErrorResponse` を送信（`try/catch` で統一処理）

### 4.5 RPC クライアント（**04 修正版**）

- [ ] `src/util/db/sqlite/workerClient.ts` を作成
  - `initWorker(onNotify)`: Worker 生成 + 初期化完了待ち
    - `onNotify` は `(table: TableName) => void` 型
  - `execAsync(sql, opts)`: 汎用 READ 用 → Promise
  - `execBatch(statements, opts)`: 汎用 WRITE 用 → Promise
  - **`sendCommand(command)`**: 専用ハンドラ呼び出し用 → Promise（**04 で追加**）
    - 引数の `command` オブジェクトに自動で `id` を付与して Worker に postMessage
    - 戻り値の `result` を Promise で返す
  - **`changedTables` の自動処理**（04 §4.3）:
    - `handleMessage` 内で `msg.changedTables` をチェック
    - 存在する場合、各テーブルに対して `onNotify(table)` を呼び出す
    - これにより `notifyChange` は **Worker レスポンス受信時に 1 回だけ** 発火する
  - pending request の id ベースマッチング
  - RPC タイムアウト（デフォルト 10 秒。設計書 02 の 30 秒から短縮を検討）
  - `terminateWorker()`: テスト用 Worker 終了
  - Worker クラッシュハンドリング:
    - `worker.onerror` で pending requests を全て reject
    - 必要に応じて Worker を再初期化

  > **注意**: `notify` メッセージのハンドラは **実装しない**（04 §3.3 により廃止）。
  > Store 関数側の `notifyChange()` 呼び出しも **削除** する。

### 4.6 Worker RPC テスト

- [ ] `src/util/db/sqlite/__tests__/workerClient.test.ts` を作成
  - Worker モック (`vi.stubGlobal`) を使用
  - `execAsync` のリクエスト送信 / レスポンス解決テスト
  - `execBatch` のリクエスト送信 / レスポンス解決テスト
  - **`sendCommand` のリクエスト送信 / レスポンス解決テスト**
  - エラーレスポンスで reject するテスト
  - **`changedTables` でコールバックが呼ばれるテスト**
  - **`changedTables` が空 / undefined の場合はコールバック不発火**
  - 複数 concurrent リクエストの id マッチングテスト
  - RPC タイムアウトテスト
  - Worker クラッシュ時の pending reject テスト

- [ ] `src/util/db/sqlite/__tests__/workerHandlers.test.ts` を作成（**04 で追加**）
  - `better-sqlite3` の DB インスタンスを直接渡して Worker 側関数をテスト
  - `handleUpsertStatus` のテスト（URI 重複排除含む）
  - `handleBulkUpsertStatuses` のテスト（URI キャッシュ + ループ）
  - `handleUpdateStatusAction` のテスト（JSON パース → 加工 → UPDATE）
  - `handleDeleteEvent` のテスト（分岐パターン）
  - `handleRemoveFromTimeline` のテスト（残数確認 → 物理削除）
  - `handleAddNotification` / `handleBulkAddNotifications` のテスト
  - `handleUpdateNotificationStatusAction` のテスト（JSON 加工）
  - `handleEnforceMaxLength` のテスト
  - 全ハンドラが正しい `changedTables` を返すことの検証

---

## Phase 5: initSqlite / connection の書換

### 5.1 initSqlite.ts

- [ ] `DbHandle` 型を新定義に変更（`types.ts` から import）
  - `execAsync(sql, opts)`: `Promise<unknown>`
  - `execBatch(statements, opts)`: `Promise<Record<number, unknown>>`
  - **`sendCommand(command)`**: `Promise<unknown>` （**04 で追加**）
  - `persistence`: `'opfs' | 'memory'`
- [ ] `getDb()` を Worker 初期化 + フォールバックに変更
  - Worker が使えるか判定 (`typeof Worker !== 'undefined'`)
  - Worker モード: `workerClient.initWorker(notifyChangeCallback)` → `DbHandle` を構築
    - `execAsync` → `workerClient.execAsync` に委譲
    - `execBatch` → `workerClient.execBatch` に委譲
    - **`sendCommand` → `workerClient.sendCommand` に委譲**
  - フォールバックモード: `initMainThreadFallback()` を呼び出し
- [ ] `initMainThreadFallback()` を実装（**04 §10 に基づく**）
  - `@sqlite.org/sqlite-wasm` をメインスレッドでロード（インメモリ DB）
  - `ensureSchema()` をメインスレッドで実行
  - `execAsync` / `execBatch` を同期 `db.exec()` のラッパーとして実装
  - **`sendCommand` を実装** — Worker に送る代わりに Worker 側の関数を直接呼び出し:
    ```
    sendCommand: async (command) => {
      switch (command.type) {
        case 'upsertStatus':
          return handleUpsertStatus(db, command.statusJson, ...)
        case 'bulkUpsertStatuses':
          return handleBulkUpsertStatuses(db, ...)
        // ... 他の専用ハンドラ ...
      }
    }
    ```
  - Worker 側の関数（`worker/workerStatusStore.ts` 等）を import して呼び出す（**コード共有**）
  - `sendCommand` 実行後、戻り値の `changedTables` を元に `notifyChange()` を呼び出す
- [ ] 旧 `DbHandle` 型（`db`, `sqlite3` プロパティ）を削除

### 5.2 connection.ts

- [ ] `DbHandle` の re-export を新型（`types.ts`）に更新
- [ ] `getSqliteDb()` 内の `ensureSchema` 呼び出しを削除
  - Worker モード: Worker 内の `init()` で `ensureSchema` 適用済み
  - フォールバックモード: `initMainThreadFallback()` 内で適用済み
- [ ] `subscribe` / `notifyChange` は変更なし（メインスレッドのイベントバスとして残留）
- [ ] `notifyChange` を `workerClient` に渡すコールバックとして公開（`initWorker(notifyChange)` で接続）

### 5.3 schema.ts

- [ ] Worker 用の `SchemaDbHandle` 型を定義（`{ db: Database | OpfsDatabase; sqlite3: Sqlite3Static }`）
  - `ensureSchema` の引数型を `SchemaDbHandle` に変更
  - メインスレッドの `DbHandle`（RPC 型）とは別物であることを明確化
- [ ] Worker 内からの import パスが正しく解決されることを確認
- [ ] フォールバック用にメインスレッドからも import 可能であることを確認

---

## Phase 6: Store 層の書換（**04 修正版: 薄いラッパー化**）

> **方針転換**: 02-design.md では Store 関数内で `execAsync` / `execBatch` を使って
> SQL を組み立てる設計だったが、04-reactive-behavior-analysis により以下に修正:
>
> - **専用ハンドラ対象の関数**: `handle.sendCommand(...)` を呼ぶだけの薄いラッパーに変更
> - **汎用 READ のみの関数**: `handle.execAsync(...)` を使用（変更パターンは 02 と同じ）
> - **`notifyChange()` の呼び出し**: Store 関数からは **削除**（workerClient が `changedTables` を元に自動発火）

### 6.1 statusStore.ts — 薄いラッパー化

#### 6.1.1 Worker に委譲する関数（パターン A: `sendCommand`）

- [ ] `upsertStatus` → `sendCommand({ type: 'upsertStatus', statusJson, backendUrl, timelineType, tag })`
  - 50+ 行のトランザクション処理を削除し、`sendCommand` 1 行に置換
  - `notifyChange('statuses')` を **削除**
- [ ] `bulkUpsertStatuses` → `sendCommand({ type: 'bulkUpsertStatuses', statusesJson, backendUrl, timelineType, tag })`
  - `statusesJson` は `statuses.map(s => JSON.stringify(s))`
  - URI キャッシュロジック、トランザクション制御を全て削除
  - `notifyChange('statuses')` を **削除**
- [ ] `updateStatusAction` → `sendCommand({ type: 'updateStatusAction', backendUrl, statusId, action, value })`
  - JSON パース/加工ロジックを全て削除
  - `notifyChange('statuses')` を **削除**
- [ ] `updateStatus` → `sendCommand({ type: 'updateStatus', statusJson, backendUrl })`
  - `notifyChange('statuses')` を **削除**
- [ ] `handleDeleteEvent` → `sendCommand({ type: 'handleDeleteEvent', backendUrl, statusId, sourceTimelineType, tag })`
  - `notifyChange('statuses')` を **削除**
- [ ] `removeFromTimeline` → `sendCommand({ type: 'removeFromTimeline', backendUrl, statusId, timelineType, tag })`
  - `notifyChange('statuses')` を **削除**

#### 6.1.2 汎用 execAsync を使用する関数（パターン B: READ のみ）

- [ ] `getStatusesByTimelineType`: `handle.db.exec(...)` → `await handle.execAsync(...)`
  - `const { db } = handle` を削除
  - `rowToStoredStatus` の変更に対応（後述）
- [ ] `getStatusesByTag`: 同上
- [ ] `getStatusesByCustomQuery`: 同上
- [ ] `validateCustomQuery`: `db.exec(...)` → `await handle.execAsync(...)`
- [ ] `getDistinctTags`: 同上
- [ ] `getDistinctTimelineTypes`: 同上
- [ ] `getJsonKeysFromSample`: 同上
- [ ] `getDistinctJsonValues`: 同上
- [ ] `getDistinctColumnValues`: 同上
- [ ] `searchDistinctColumnValues`: 同上

#### 6.1.3 ヘルパー関数の扱い

- [ ] `extractStatusColumns` — **Worker 側に移動**（`workerStatusStore.ts` 内の `extractStatusColumnsInternal`）
  - メインスレッド側の `extractStatusColumns` は `migration.ts` 等の既存利用がなくなるまで残す
  - または `shared.ts` に配置して両方から import（DB アクセス不要な純粋関数のため）
- [ ] `resolveCompositeKey` — **Worker 側に移動**（DB アクセスが必要）
  - メインスレッド側からは直接呼ばなくなる（Worker 内で完結）
- [ ] `upsertMentions` — **Worker 側に移動**（DB アクセスが必要）
- [ ] `createCompositeKey` — **`shared.ts`** に移動（純粋関数。Worker / メインスレッド両方で使用）
- [ ] `toStoredStatus` — メインスレッド側に残留（DB アクセス不要、型変換のみ）
- [ ] `getTimelineTypes` / `getBelongingTags` — `await handle.execAsync(...)` に変更
  - これらは READ のみなので Worker 側に移す必要はないが、
    `rowToStoredStatus` から呼ばれるため非同期化が必要
- [ ] `rowToStoredStatus` → `async` に変更
  - `getTimelineTypes` / `getBelongingTags` を `await Promise.all(...)` で並列呼び出し

#### 6.1.4 定数・型エクスポート

- [ ] `SqliteStoredStatus` 型 — エクスポート維持
- [ ] `QUERY_COMPLETIONS` — エクスポート維持（メインスレッドの UI で使用）
- [ ] `ALIAS_TO_TABLE`, `ALLOWED_COLUMN_VALUES` — エクスポート維持

### 6.2 notificationStore.ts — 薄いラッパー化

#### 6.2.1 Worker に委譲する関数

- [ ] `addNotification` → `sendCommand({ type: 'addNotification', notificationJson, backendUrl })`
  - `notifyChange('notifications')` を **削除**
- [ ] `bulkAddNotifications` → `sendCommand({ type: 'bulkAddNotifications', notificationsJson, backendUrl })`
  - `notifyChange('notifications')` を **削除**
- [ ] `updateNotificationStatusAction` → `sendCommand({ type: 'updateNotificationStatusAction', backendUrl, statusId, action, value })`
  - `notifyChange('notifications')` を **削除**

#### 6.2.2 汎用 execAsync を使用する関数

- [ ] `getNotifications`: `db.exec(...)` → `await handle.execAsync(...)`

#### 6.2.3 ヘルパー関数の扱い

- [ ] `extractNotificationColumns` — Worker 側に移動（`workerNotificationStore.ts`）
  - `migration.ts` から使用される場合は `shared.ts` に配置を検討

### 6.3 cleanup.ts — 薄いラッパー化

- [ ] `enforceMaxLength` → `sendCommand({ type: 'enforceMaxLength' })`
  - トランザクションロジックを全て削除
  - `notifyChange('statuses')` / `notifyChange('notifications')` を **削除**
- [ ] `startPeriodicCleanup`: 変更なし（`enforceMaxLength` が async のままなので影響なし）

### 6.4 migration.ts

- [ ] `migrateFromIndexedDb` を修正:
  - **Dexie 読み取り** はメインスレッドで実行（IndexedDB はメインスレッド API）
  - 読み取ったバッチデータを **Worker に送信**: `sendCommand({ type: 'migrationWrite', statusBatches, notificationBatches })`
  - または バッチごとに `sendCommand` を呼び出し
  - `notifyChange('statuses')` / `notifyChange('notifications')` を **削除**
  - **注意**: バッチサイズ 500 件は維持（1 回の postMessage に含めるデータ量の上限に注意）
- [ ] `isMigrated`: 変更なし
- [ ] `markMigrated`: 変更なし

### 6.5 index.ts

- [ ] 新しい型・関数のエクスポートを追加 / 更新
  - `DbHandle` の再エクスポートが新型（`types.ts`）を指していることを確認
  - `createCompositeKey` のエクスポート元を `shared.ts` に変更
  - Worker 関連のエクスポートは不要（内部モジュール）
  - 既存の重複エクスポート（`DbHandle` が `connection.ts` と `types.ts` 両方から出ている）を整理

---

## Phase 7: Hook / UI 層の変更

### 7.1 Hook 層（パターン B: `db.exec(...)` → `await handle.execAsync(...)`）

> 変更は **2 行だけ** のパターン:
> 1. `const { db } = handle` を削除
> 2. `db.exec(...)` → `await handle.execAsync(...)`

- [ ] `useTimeline.ts`: 上記パターンで変更
- [ ] `useFilteredTimeline.ts`: 同上
- [ ] `useFilteredTagTimeline.ts`: 同上
- [ ] `useCustomQueryTimeline.ts`: 同上（3 つのクエリモード全て）
- [ ] `useNotifications.ts`: 同上

### 7.2 コンポーネント層

- [ ] `InstanceBlockManager.tsx`:
  - `getBlockedInstances()`: `handle.db.exec(SELECT ...)` → `await handle.execAsync(SELECT ...)`
  - `blockInstance()`: `handle.db.exec(INSERT ...)` → `await handle.execBatch([{ sql: 'INSERT ...', bind }])`
  - `unblockInstance()`: 同上パターン
  - `notifyChange('statuses')` を **削除**（`execBatch` の `changedTables` で自動通知）
    - **注意**: `execBatch` のレスポンスに `changedTables: ['statuses']` を含めるよう Worker 側で対応が必要
- [ ] `MuteManager.tsx`:
  - `getMutedAccounts()`: `await handle.execAsync(...)`
  - `muteAccount()`: `await handle.execBatch([...])`
  - `unmuteAccount()`: 同上
  - `notifyChange('statuses')` を **削除**
- [ ] `UnifiedTimeline.tsx`:
  - `handle.db.exec(SELECT ...)` → `await handle.execAsync(SELECT ...)`
- [ ] `QueryEditor.tsx`:
  - Store 関数を呼んでいるだけなら変更不要
  - 直接 `db.exec()` を呼んでいる場合は変更

### 7.3 変更が不要な箇所

| コード | 理由 |
|--------|------|
| `StatusStoreProvider.tsx` | Store 関数 (`upsertStatus` 等) を `await` で呼んでいるだけ。Store 関数の内部変更は透過的 |
| `StreamingManagerProvider.tsx` | 同上 |
| `timelineFetcher.ts` | `bulkUpsertStatuses` を `await` で呼んでいるだけ |
| `subscribe` の呼び出し元（各 Hook） | インターフェース変更なし |

---

## Phase 8: ビルド・テスト確認

### 8.1 型チェック

- [ ] `yarn build` でビルドが成功する（TypeScript 型エラーなし）

### 8.2 Lint / Format

- [ ] `yarn check` で lint / format エラーがない

### 8.3 テスト再実行

- [ ] `yarn test` で全テストが PASS する
- [ ] Phase 2 で作成した全テストケースがリグレッションなしで PASS する
- [ ] Worker RPC テスト (Phase 4.6) が PASS する
- [ ] **Worker ハンドラテスト (Phase 4.6 workerHandlers.test.ts) が PASS する**

### 8.4 Worker バンドリング確認

- [ ] Next.js ビルドが Worker ファイル (`sqlite.worker.ts`) を正しくバンドルすることを確認
  - `new Worker(new URL('./worker/sqlite.worker.ts', import.meta.url))` の記法が webpack/Turbopack で動作するか検証
  - Turbopack (Next.js 16 デフォルト) での Worker バンドリング互換性を確認
  - 必要に応じて `next.config.mjs` の webpack 設定を調整
- [ ] Wasm ファイル (`sqlite3.wasm`) が正しく配信されることを確認
  - Worker 内での `import('@sqlite.org/sqlite-wasm')` の動的 import が解決されるか検証

### 8.5 ブラウザ確認（手動）

- [ ] `yarn dev` でローカルサーバー起動
- [ ] コンソールに `SQLite: initialized in Worker (OPFS persistence)` が表示される
- [ ] タイムラインにデータが表示される
- [ ] ページリロード後もデータが保持される
- [ ] DevTools > Application > Storage > OPFS にファイルが存在する
- [ ] 新しい投稿がストリーミングで追加される
- [ ] お気に入り / ブースト / ブックマークの状態更新が反映される
- [ ] 通知が正常に表示される
- [ ] ミュート / インスタンスブロックが機能する
- [ ] カスタムクエリが動作する
- [ ] Worker 非対応環境のシミュレーション（devtools で Worker を無効化）でフォールバックが機能する
- [ ] COOP/COEP ヘッダが正しく設定されていることを確認（DevTools > Network）

---

## Phase 9: ドキュメント更新

- [ ] `docs/timeline/01-architecture.md`:
  - レイヤー構成図に Worker を追加
  - データフロー図を Worker RPC 経由に更新
  - 専用ハンドラ方式の説明を追加
- [ ] `docs/timeline/03-data-storage.md`:
  - OPFS 永続化の実装詳細を Worker ベースに更新
  - フォールバックチェーンの記述を追加
  - `changedTables` による通知制御の説明
- [ ] `docs/timeline/09-migration.md`:
  - インメモリ → OPFS Worker 移行の注意点を追記
  - 既存ユーザーへの影響（初回は空の OPFS DB から開始）を記述
- [ ] `README.md`:
  - OPFS 永続化の記述が正確であることを確認
  - `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy` の記述確認
- [ ] `specs/02-design.md`:
  - 冒頭に「04-reactive-behavior-analysis.md による修正事項」の注記を追加
  - §3.1 プロトコル定義に「専用ハンドラは 04 を参照」の注記を追加

---

## 完了基準

以下の **全て** を満たした時点で移行完了とする:

1. [ ] `yarn build` が成功する
2. [ ] `yarn check` が成功する
3. [ ] `yarn test` で全テストが PASS する
4. [ ] ブラウザコンソールに `SQLite: initialized in Worker (OPFS persistence)` が表示される
5. [ ] ページリロード後もタイムラインデータが保持される
6. [ ] 全ての手動確認項目（Phase 8.5）が OK
7. [ ] ドキュメントが更新されている
8. [ ] **`notifyChange` の二重発火がないことを確認**（ブラウザ DevTools で listener 発火回数を検証）

---

## 推定工数

| Phase | 内容 | 見積もり |
|-------|------|---------|
| 1 | テスト基盤構築 | 2-3 時間 |
| 2 | テストコード作成 | 8-12 時間 |
| 3 | テスト実行・確認 | 1-2 時間 |
| 4 | Worker 基盤実装（**共有 + ドメインモジュール + RPC**） | **8-12 時間** |
| 5 | initSqlite / connection 書換 | 3-4 時間 |
| 6 | Store 層の薄いラッパー化 | **4-6 時間** |
| 7 | Hook / UI 層の変更 | 3-4 時間 |
| 8 | ビルド・テスト確認 | 2-4 時間 |
| 9 | ドキュメント更新 | 1-2 時間 |
| **合計** | | **32-49 時間** |

> **見積もりの変更点**: 02 設計時の見積もり (33-51 時間) と概ね同等。
> Phase 4 は Worker 側ドメインモジュールの追加で増加したが、
> Phase 6 は Store 関数が薄いラッパーになったことで大幅に減少。

---

## ファイル一覧（実装対象）

### 新規作成

| ファイル | 内容 |
|----------|------|
| `src/util/db/sqlite/protocol.ts` | RPC メッセージ型定義（専用ハンドラ含む） |
| `src/util/db/sqlite/types.ts` | 新 `DbHandle` 型（`execAsync`, `execBatch`, `sendCommand`, `persistence`） |
| `src/util/db/sqlite/shared.ts` | Worker / メインスレッド共有の純粋関数 |
| `src/util/db/sqlite/workerClient.ts` | メインスレッド側 RPC クライアント（`changedTables` 自動処理） |
| `src/util/db/sqlite/worker/sqlite.worker.ts` | Worker エントリーポイント + メッセージルーター |
| `src/util/db/sqlite/worker/workerStatusStore.ts` | Worker 側: Status 関連トランザクション処理 |
| `src/util/db/sqlite/worker/workerNotificationStore.ts` | Worker 側: Notification 関連処理 |
| `src/util/db/sqlite/worker/workerCleanup.ts` | Worker 側: クリーンアップ処理 |
| `src/util/db/sqlite/worker/workerMigration.ts` | Worker 側: マイグレーションデータ書き込み |
| `src/util/db/sqlite/worker/workerSchema.ts` | Worker 側: スキーマ管理（`SchemaDbHandle` 型） |

### 変更

| ファイル | 変更内容 |
|----------|----------|
| `src/util/db/sqlite/initSqlite.ts` | Worker 生成 + フォールバック。`sendCommand` を含む新 `DbHandle` を返す |
| `src/util/db/sqlite/connection.ts` | `ensureSchema` 削除。`DbHandle` 型更新。`notifyChange` を workerClient に接続 |
| `src/util/db/sqlite/schema.ts` | `SchemaDbHandle` 型分離。Worker / フォールバック両方から import 可能に |
| `src/util/db/sqlite/statusStore.ts` | 薄いラッパー化（`sendCommand` + `execAsync`）。`notifyChange` 削除 |
| `src/util/db/sqlite/notificationStore.ts` | 同上 |
| `src/util/db/sqlite/cleanup.ts` | 同上 |
| `src/util/db/sqlite/migration.ts` | Dexie 読み取り → Worker に書き込み依頼。`notifyChange` 削除 |
| `src/util/db/sqlite/index.ts` | 新エクスポート追加。重複整理 |

### テスト

| ファイル | 内容 |
|----------|------|
| `src/util/db/sqlite/__tests__/helpers/setup.ts` | Vitest グローバルセットアップ |
| `src/util/db/sqlite/__tests__/helpers/testDb.ts` | better-sqlite3 互換アダプタ |
| `src/util/db/sqlite/__tests__/helpers/fixtures.ts` | テスト用モックデータファクトリ |
| `src/util/db/sqlite/__tests__/schema.test.ts` | スキーマ管理テスト |
| `src/util/db/sqlite/__tests__/statusStore.test.ts` | Status ストアテスト |
| `src/util/db/sqlite/__tests__/notificationStore.test.ts` | Notification ストアテスト |
| `src/util/db/sqlite/__tests__/cleanup.test.ts` | クリーンアップテスト |
| `src/util/db/sqlite/__tests__/connection.test.ts` | 接続管理テスト |
| `src/util/db/sqlite/__tests__/migration.test.ts` | マイグレーションテスト |
| `src/util/db/sqlite/__tests__/integration.test.ts` | 統合テスト |
| `src/util/db/sqlite/__tests__/workerClient.test.ts` | Worker RPC クライアントテスト |
| `src/util/db/sqlite/__tests__/workerHandlers.test.ts` | Worker 側ハンドラ関数テスト（**04 で追加**） |

---

## 注意事項

### コード共有構造（04 §10）

```
worker/workerStatusStore.ts
  └── handleUpsertStatus(db, ...)  ← 生の Database を引数に取る純粋関数
        │
        ├── Worker: sqlite.worker.ts が onmessage から呼ぶ
        └── Main Thread: initMainThreadFallback() の sendCommand から呼ぶ
```

- Worker モードとフォールバックモードで **同一のビジネスロジック** が実行される
- テストは `better-sqlite3` + Worker 側関数の直接呼び出しで行える（Worker を介さない）
- コードの重複がない

### `bulkUpsertStatuses` の特殊性

`bulkUpsertStatuses` ではバッチ内で URI キャッシュを使って compositeKey を解決している。
Worker 側の `handleBulkUpsertStatuses` 内で `uriCache` を `Map` として管理し、
トランザクション内の READ → WRITE ループを Worker 内で完結させる。

メインスレッドからは `sendCommand` 1 回で完了する（40 件でも 1 往復）。

### `updateStatusAction` / `updateNotificationStatusAction` の JSON 加工

JSON パース → フィールド変更 → JSON.stringify → UPDATE を **Worker 内で実行** する（04 §3.2 解決策 A）。
これにより:
- メインスレッド ↔ Worker のラウンドトリップが 1 回で済む
- トランザクション内の一貫性が保たれる（READ と WRITE の間に他の書き込みが入らない）

### `schema.ts` の型分離

Worker 内で呼ばれる `ensureSchema` は生の `Database` オブジェクトを受け取る必要がある。
メインスレッドの `DbHandle`（RPC ラッパー型）とは異なるため、内部型として `SchemaDbHandle` を定義する。

```typescript
// worker/workerSchema.ts 内部型
type SchemaDbHandle = {
  db: Database | OpfsDatabase
  sqlite3: Sqlite3Static
}
```

### Worker 内での `import`

Worker ファイルでは `schema.ts` および `worker/workerXxx.ts` を `import` する。
`@sqlite.org/sqlite-wasm` も Worker 内で動的 import する。
Next.js の webpack/Turbopack がこれらを正しく Worker バンドルに含めるよう確認が必要。

### 既存データの移行

メインスレッド + インメモリ DB から Worker + OPFS DB への移行時、
既存のインメモリデータは失われる（元々永続化されていなかったため問題なし）。
初回起動時に Fediverse サーバーからデータを再取得する挙動は変わらない。

### `@sqlite.org/sqlite-wasm` バージョン互換性

`package.json` の `@sqlite.org/sqlite-wasm: ^3.51.2-build6` で
`installOpfsSAHPoolVfs` API が利用可能かどうかを事前に確認する。
利用できない場合は通常の `OpfsDb` にフォールバックする設計になっている。

### RPC タイムアウト

02-design.md では 30 秒のタイムアウトを設定していたが、
UI 応答性の観点から **10 秒** への短縮を検討する。
`bulkUpsertStatuses` の大量データ処理が 10 秒以内に完了するかベンチマークで確認すること。

---

## 02-design.md からの差分サマリ

| 項目 | 02-design.md | 本チェックリスト（04 反映版） |
|------|-------------|------------------------------|
| RPC メッセージ | `exec` + `execBatch` の 2 種類 | `exec` + `execBatch` + **専用ハンドラ 10+ 種類** |
| `NotifyMessage` | あり | **廃止**（`changedTables` に統合） |
| `DbHandle` 型 | `execAsync` + `execBatch` + `persistence` | + **`sendCommand`** |
| Store 関数の責務 | SQL 組み立て + execAsync/execBatch | **Worker へのコマンド送信のみ**（薄いラッパー） |
| Worker 側の責務 | SQL 実行のみ（handleExec, handleExecBatch） | **ビジネスロジック含む**（handleUpsertStatus 等） |
| ファイル構成 | `sqlite.worker.ts` 1 ファイル | `worker/` ディレクトリに **6 ファイル** |
| `notifyChange` の呼び出し元 | Store 関数 + Worker notify | **workerClient のみ**（`changedTables` ベース） |
| JSON パース/加工 | メインスレッドで実行 | **Worker 側で実行** |
| `resolveCompositeKey` | メインスレッドで非同期化 | **Worker 側に移動** |
| フォールバック | 独自実装 | Worker 側関数を **直接呼び出し**（コード共有） |
| テスト | Store テスト + workerClient テスト | + **workerHandlers.test.ts**（Worker 側関数の直接テスト） |
