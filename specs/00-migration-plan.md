# 00. SQLite OPFS Worker 移行マスタープラン

## 背景・課題

現在の `initSqlite.ts` は **メインスレッド上** で `sqlite3.oo1.OpfsDb` を使って OPFS 永続化を試みている。
しかし、OPFS の同期アクセスハンドル (`createSyncAccessHandle()`) は **Dedicated Worker 内でしか利用できない** ブラウザ API 制約があるため、実際にはほとんどの環境で `catch` ブランチに落ち、**インメモリ DB にフォールバック** している。

その結果：

- ページリロードでデータが消失する
- 蓄積した投稿・通知が永続化されない
- ドキュメント（`01-architecture.md` 等）に記載された「OPFS 上の SQLite」という設計が実現できていない

## ゴール

SQLite Wasm を **Dedicated Web Worker** 内で動作させ、**OPFS SAH Pool VFS** による確実な永続化を実現する。

## 移行方針

### アーキテクチャ概要

```
┌──────────────────────────────┐      postMessage (RPC)      ┌─────────────────────────────┐
│         Main Thread          │  ◀──────────────────────▶   │    Dedicated Web Worker      │
│                              │                              │                              │
│  connection.ts               │   { id, method, params }     │  sqlite.worker.ts            │
│    ↳ execAsync()  ──────────▶│ ─────────────────────────▶   │    ↳ switch(method)          │
│    ↳ Promise<result>  ◀─────│ ◀─────────────────────────   │      ↳ db.exec(sql, opts)    │
│                              │   { id, result } / { error } │      ↳ return result         │
│  subscribe() / notifyChange()│                              │                              │
│  (メインスレッドに残留)       │                              │  OPFS SAH Pool VFS           │
│                              │                              │  ↳ /miyulab-fe.sqlite3       │
└──────────────────────────────┘                              └─────────────────────────────┘
```

### 設計方針

1. **Worker 側**: SQLite の初期化・全 SQL 実行を担当。OPFS SAH Pool VFS で永続化
2. **Main Thread 側**: RPC ラッパー (`execAsync`) で Worker に SQL を送信し、Promise で結果を受け取る
3. **subscribe / notifyChange**: メインスレッド上のイベントバスとして残留（Worker に移す必要なし）
4. **既存 API の互換性**: `getSqliteDb()` が返す `DbHandle` の型を変更し、`db.exec()` → `db.execAsync()` に統一
5. **トランザクション**: `BEGIN` / `COMMIT` / `ROLLBACK` も Worker 側で実行。メインスレッドからは `execBatch()` でアトミック操作を送信

## 実施ステップ

| Phase | 内容                                     | 成果物                                          |
| ----- | ---------------------------------------- | ----------------------------------------------- |
| 1     | 現行挙動のテスト作成                     | `specs/01-test-plan.md`, テストコード一式        |
| 2     | テスト実行・既存挙動の確認               | テスト結果の記録                                 |
| 3     | 設計書作成                               | `specs/02-design.md`                             |
| 4     | Worker 実装 + RPC ラッパー               | `sqlite.worker.ts`, `workerRpc.ts`               |
| 5     | `initSqlite.ts` / `connection.ts` 書換   | OPFS Worker 対応版                               |
| 6     | Store 層の非同期化                       | `statusStore.ts`, `notificationStore.ts` 等      |
| 7     | Hook 層・UI 層の対応                     | 各 Hook / コンポーネントの修正                   |
| 8     | テスト再実行・リグレッション確認          | 全テスト PASS                                    |
| 9     | ドキュメント更新                         | `docs/timeline/*.md` 更新                        |

## Phase 詳細

### Phase 1: テスト作成

**目的**: 移行前の挙動をテストで固める。修正後に同じテストを実行し、リグレッションがないことを確認する。

**対象モジュール**:

| モジュール              | テスト対象の関数・挙動                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `schema.ts`             | `ensureSchema` — テーブル・インデックスの作成、バージョン管理       |
| `statusStore.ts`        | `upsertStatus`, `bulkUpsertStatuses`, `handleDeleteEvent` 等全関数  |
| `notificationStore.ts`  | `addNotification`, `bulkAddNotifications`, `getNotifications` 等    |
| `cleanup.ts`            | `enforceMaxLength` — MAX_LENGTH 超過時の削除ロジック                |
| `connection.ts`         | `subscribe`, `notifyChange` — イベントバスの動作                    |
| `migration.ts`          | IndexedDB → SQLite マイグレーション（モック使用）                   |

**詳細**: → `specs/01-test-plan.md`

### Phase 2: テスト実行・確認

- Vitest を導入（プロジェクトにテストランナーが未導入のため）
- `better-sqlite3` または `sql.js` を Node.js テスト環境用のモックとして使用
- 全テストが PASS することを確認

### Phase 3: 設計書

Worker RPC プロトコル、型定義、エラーハンドリング、フォールバック戦略を詳細設計する。

**詳細**: → `specs/02-design.md`

### Phase 4: Worker 実装

1. `src/util/db/sqlite/sqlite.worker.ts` — Worker エントリーポイント
2. `src/util/db/sqlite/workerRpc.ts` — メインスレッド側 RPC クライアント
3. `src/util/db/sqlite/protocol.ts` — RPC メッセージ型定義

### Phase 5: initSqlite / connection 書換

1. `initSqlite.ts` — Worker 生成 + OPFS SAH Pool VFS 初期化
2. `connection.ts` — `getSqliteDb()` が Worker RPC ハンドルを返すよう変更

### Phase 6: Store 層の非同期化

`db.exec()` (同期) → `db.execAsync()` (非同期 RPC) への変換。

**変更パターン**:

```typescript
// Before
const rows = db.exec(sql, { bind, returnValue: 'resultRows' }) as T[][]

// After
const rows = await db.execAsync(sql, { bind, returnValue: 'resultRows' }) as T[][]
```

**トランザクション**:

```typescript
// Before
db.exec('BEGIN;')
try {
  db.exec(...)
  db.exec('COMMIT;')
} catch { db.exec('ROLLBACK;') }

// After
await db.execBatch([
  { sql: 'BEGIN;' },
  { sql: '...', bind: [...] },
  { sql: 'COMMIT;' },
], { rollbackOnError: true })
```

### Phase 7: Hook 層・UI 層

- `useTimeline.ts`, `useFilteredTimeline.ts` 等 — `db.exec()` → `db.execAsync()`
- `InstanceBlockManager.tsx`, `MuteManager.tsx` — 同上
- `UnifiedTimeline.tsx`, `QueryEditor.tsx` — 同上

### Phase 8: テスト再実行

Phase 1 で作成したテストを全件再実行し、PASS することを確認。

### Phase 9: ドキュメント更新

- `docs/timeline/01-architecture.md` — Worker アーキテクチャの図を更新
- `docs/timeline/03-data-storage.md` — OPFS 永続化の実装詳細を更新
- `docs/timeline/09-migration.md` — インメモリ → OPFS 移行の注意点を追記

## 影響範囲

### 直接変更が必要なファイル

| ファイル                              | 変更内容                                      |
| ------------------------------------- | --------------------------------------------- |
| `src/util/db/sqlite/initSqlite.ts`    | Worker 生成 + OPFS SAH Pool 初期化に全面書換  |
| `src/util/db/sqlite/connection.ts`    | `DbHandle` 型変更、RPC ラッパー統合           |
| `src/util/db/sqlite/schema.ts`        | Worker 内で実行されるよう調整                  |
| `src/util/db/sqlite/statusStore.ts`   | 全関数を非同期 RPC 対応                       |
| `src/util/db/sqlite/notificationStore.ts` | 全関数を非同期 RPC 対応                   |
| `src/util/db/sqlite/cleanup.ts`       | 非同期 RPC 対応                               |
| `src/util/db/sqlite/migration.ts`     | 非同期 RPC 対応                               |
| `src/util/db/sqlite/index.ts`         | 新エクスポート追加                             |

### 間接影響を受けるファイル（呼び出し元）

| ファイル                                       | 影響内容                           |
| ---------------------------------------------- | ---------------------------------- |
| `src/util/hooks/useTimeline.ts`                | `db.exec` → `db.execAsync`        |
| `src/util/hooks/useFilteredTimeline.ts`        | 同上                               |
| `src/util/hooks/useFilteredTagTimeline.ts`     | 同上                               |
| `src/util/hooks/useCustomQueryTimeline.ts`     | 同上                               |
| `src/util/hooks/useNotifications.ts`           | 同上                               |
| `src/app/_parts/InstanceBlockManager.tsx`      | 同上                               |
| `src/app/_parts/MuteManager.tsx`               | 同上                               |
| `src/app/_components/UnifiedTimeline.tsx`      | 同上                               |
| `src/app/_components/QueryEditor.tsx`          | 同上                               |
| `src/util/provider/StatusStoreProvider.tsx`    | Store 関数の呼び出しは既に async   |
| `src/util/provider/StreamingManagerProvider.tsx` | 同上                             |
| `src/util/timelineFetcher.ts`                  | 同上                               |
| `next.config.mjs`                              | Worker ファイルの配信設定確認      |

## リスクと対策

| リスク                                       | 対策                                                       |
| -------------------------------------------- | ---------------------------------------------------------- |
| Worker 非対応ブラウザ                         | メインスレッド + インメモリ DB へのフォールバックを維持     |
| OPFS 非対応ブラウザ                           | 同上                                                       |
| COOP/COEP ヘッダ未設定環境（Vercel Preview等）| `credentialless` で緩和済み。Worker OPFS は SAB 不要      |
| RPC オーバーヘッドによるパフォーマンス劣化    | `execBatch` でラウンドトリップ削減。ベンチマーク計測       |
| postMessage のシリアライゼーションコスト      | 大量行の場合は Worker 側で JSON パース → 整形まで行う      |
| テスト環境で Worker/OPFS が使えない           | Node.js 用モック（sql.js）で純粋な SQL ロジックをテスト    |

## 成功基準

1. ブラウザコンソールに `SQLite: using OPFS persistence (Worker)` が表示される
2. ページリロード後もデータが保持される
3. 全既存テストが PASS する
4. `yarn build` が成功する
5. `yarn check` が成功する
