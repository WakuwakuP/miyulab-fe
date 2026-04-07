# ストリーミングアーキテクチャ

miyulab-fe は Fediverse サーバー（Mastodon / Pleroma 等）の Streaming API を WebSocket 経由で利用し、タイムラインや通知をリアルタイムに受信する。本ドキュメントでは、ストリーム接続の管理・イベント処理・リトライ戦略・Provider 間の責務分担を解説する。

---

## 1. WebSocket ストリーミングの概要

Mastodon / Pleroma 互換サーバーは、WebSocket ベースの Streaming API を提供する。miyulab-fe では **megalodon** ライブラリを介して接続を確立し、以下のイベントをリアルタイムに受信する。

| イベント | 内容 |
|---|---|
| `update` | 新規ステータス（投稿）の追加 |
| `status_update` | 既存ステータスの編集・更新 |
| `delete` | ステータスの削除 |
| `notification` | 通知（フォロー、メンション、リブログ等） |
| `connect` | WebSocket 接続成功 |
| `error` | 接続エラー |

megalodon の `WebSocketInterface` がこれらのイベントを抽象化し、バックエンド差異を吸収する。

---

## 2. ストリーム種別

### 2.1 種別一覧

| 種別 | 説明 | 管理元 |
|---|---|---|
| **userStreaming** | ホームタイムライン + 通知 | `StatusStoreProvider` |
| **local** | ローカルタイムライン | `StreamingManagerProvider` |
| **public** | 連合タイムライン | `StreamingManagerProvider` |
| **tag** | ハッシュタグストリーム | `StreamingManagerProvider` |

`userStreaming` は認証ユーザー固有のストリームであり、StatusStoreProvider が専用管理する。local / public / tag は StreamingManagerProvider が動的に管理する。

### 2.2 ストリームキー構築パターン

> ソース: `src/util/streaming/streamKey.ts`

ストリーム接続の一意識別にはパイプ（`|`）区切りのキー文字列を使用する。URL やタグ名にコロンが含まれ得るため、`|` を安全なセパレータとして採用している。

```
local:   local|${backendUrl}
public:  public|${backendUrl}
tag:     tag|${backendUrl}|${tagName}
```

**型定義:**

```typescript
type StreamType = 'local' | 'public' | 'tag'

// キー生成
createStreamKey(type: StreamType, backendUrl: string, tag?: string): string

// キー解析
parseStreamKey(key: string): { type: StreamType; backendUrl: string; tag?: string }
```

> **注意**: `userStreaming` は StatusStoreProvider で管理するため、ストリームキーの対象外。

---

## 3. StreamingManager の動的ストリーム管理

### 3.1 モジュール構成

> ソース: `src/util/streaming/`

```
src/util/streaming/
├── streamKey.ts               # ストリームキーの生成・解析
├── streamRegistry.ts          # 接続状態のデータ構造定義
├── constants.ts               # リトライ定数・接続数閾値
├── deriveRequiredStreams.ts    # タイムライン設定 → 必要ストリーム算出
├── buildInitialFetchTasks.ts  # ストリーム接続前の初期データ取得タスク構築
├── initializeStream.ts        # WebSocket 接続の確立
├── setupStreamHandlers.ts     # イベントハンドラ登録
├── runWithConcurrencyLimit.ts # 同時実行数制限付きタスク実行
└── stopStream.ts              # WebSocket のクリーンアップ
```

### 3.2 StreamRegistry — 接続状態トラッキング

> ソース: `src/util/streaming/streamRegistry.ts`

`StreamRegistry` は `Map<string, StreamEntry>` 型で、各ストリームの接続状態を管理する。

```typescript
type StreamEntry = {
  initId: number                              // 初期化サイクルの一意識別子（重複接続防止用）
  retryCount: number                          // 現在のリトライ回数
  retryTimer: ReturnType<typeof setTimeout> | null  // リトライタイマー ID
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  stream: WebSocketInterface | null           // WebSocket インスタンス（初期化中は null）
}
```

参照カウント（refCount）は不要。`syncStreamsEvent` が `deriveRequiredStreams` の結果に基づいてストリームのライフサイクルを一元管理するため、同一キーの重複は `Set` の性質により自然に排除される。

### 3.3 deriveRequiredStreams — 必要ストリームの導出

> ソース: `src/util/streaming/deriveRequiredStreams.ts`

タイムライン設定（`TimelineConfigV2[]`）と登録済みアプリ（`App[]`）から、必要なストリーム接続キーの `Set<string>` を算出する。

**算出ルール:**

| タイムライン種別 | ストリーム | 備考 |
|---|---|---|
| `home` | 対象外 | userStreaming は StatusStoreProvider 管理 |
| `notification` | 対象外 | userStreaming に含まれる |
| `local` | 全 backendUrl に対して接続 | タイムライン設定の有無に関わらず常時接続 |
| `public` | 全 backendUrl に対して接続 | 同上 |
| `tag` | backendUrl × タグ名 ごとに接続 | tagConfig から動的に算出 |

**非表示タイムラインの扱い:** `visible === false` のタイムラインでもストリーム接続は維持する。表示/非表示切替時のデータ欠損を防止するための設計判断である。

### 3.4 initializeStream — WebSocket 接続の確立

> ソース: `src/util/streaming/initializeStream.ts`

```
initializeStream(key, type, backendUrl, app, options, initId, deps)
```

1. megalodon クライアントから WebSocket ストリームを生成（`localStreaming()` / `publicStreaming()` / `tagStreaming(tag)`）
2. ゴーストエラー防止のため、空の `error` ハンドラを即座に登録
3. レジストリの `initId` を検証し、非同期処理中に `syncStreamsEvent` が発火してストリームが不要になっていないか確認
4. レジストリを更新し、`setupStreamHandlers` でイベントハンドラを登録
5. 失敗時はエクスポネンシャルバックオフでリトライをスケジュール

### 3.5 setupStreamHandlers — イベントハンドラ登録

> ソース: `src/util/streaming/setupStreamHandlers.ts`

WebSocket ストリームに 5 種類のイベントハンドラを登録する。

| イベント | 処理内容 |
|---|---|
| `update` | `upsertStatus()` で SQLite に新規ステータスを保存 |
| `status_update` | `updateStatus()` で既存ステータスを更新 |
| `delete` | `handleDeleteEvent()` で SQLite からステータスを削除 |
| `connect` | 接続状態を `'connected'` に更新、リトライカウントをリセット |
| `error` | 接続状態を `'error'` に更新、`scheduleRetry` でリトライスケジュール |

デバッグモード（`isRawDataCaptureEnabled()`）が有効な場合、各イベントの生データを `captureStreamEvent` でキャプチャする。

### 3.6 buildInitialFetchTasks — 初期データ取得

> ソース: `src/util/streaming/buildInitialFetchTasks.ts`

ストリーム接続だけでは過去のデータが取得できないため、REST API による初期データ取得を並行して行う。

- **local / public**: 全 backendUrl に対してデフォルトで取得
- **tag**: `tagConfig` を持つタイムライン設定から取得
- `fetchedKeys` で取得済みキーを追跡し、重複フェッチを防止

### 3.7 runWithConcurrencyLimit — 同時実行数制限

> ソース: `src/util/streaming/runWithConcurrencyLimit.ts`

初期データ取得タスクを最大 **3 件**（`INITIAL_FETCH_CONCURRENCY`）ずつ並行実行する。Worker キューの圧迫を防ぐためのスロットリング機構。

### 3.8 stopStream — WebSocket のクリーンアップ

> ソース: `src/util/streaming/stopStream.ts`

megalodon の `stop()` には既知の問題がある。`stop()` は `_connectionClosed = true` を設定するが、予約済みの `_reconnect()` setTimeout をキャンセルしない。また `_reconnect()` は `_connectionClosed` をチェックしないため、stop() 後もゴースト再接続が発生し得る。

**ワークアラウンド:**

```typescript
function stopStream(stream: WebSocketInterface): void {
  stream.stop()
  // megalodon 内部プロパティに直接アクセスし、ゴースト再接続を防止
  (stream as any)._reconnectMaxAttempts = 0
}

function restartStream(stream: WebSocketInterface): void {
  // 再接続能力を復元してから start()
  (stream as any)._reconnectMaxAttempts = Infinity
  stream.start()
}
```

---

## 4. イベントフロー

### 4.1 全体フロー図

```
┌─────────────────────┐
│  Fediverse Server   │
│  (Mastodon/Pleroma) │
└────────┬────────────┘
         │ WebSocket
         ▼
┌────────────────────┐
│    megalodon        │
│  WebSocketInterface │
└────────┬───────────┘
         │ イベント発火
         ▼
┌─────────────────────────────┐
│    setupStreamHandlers      │
│  (update/status_update/     │
│   delete/connect/error)     │
└────────┬────────────────────┘
         │ DB 操作
         ▼
┌─────────────────────────────┐
│    StatusStore (SQLite)     │
│  upsertStatus / updateStatus│
│  handleDeleteEvent          │
└────────┬────────────────────┘
         │ リアクティブ更新
         ▼
┌─────────────────────────────┐
│    Timeline Hooks           │
│  (useLiveQuery 等)          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│    React UI                 │
│  (タイムラインコンポーネント) │
└─────────────────────────────┘
```

### 4.2 イベント種別ごとの処理パス

**update（新規投稿）:**
```
WebSocket → update イベント → upsertStatus(status, backendUrl, timelineType, tag) → SQLite INSERT → UI 更新
```

**status_update（投稿編集）:**
```
WebSocket → status_update イベント → updateStatus(status, backendUrl) → SQLite UPDATE → UI 更新
```

**delete（投稿削除）:**
```
WebSocket → delete イベント → handleDeleteEvent(backendUrl, id, timelineType, tag) → SQLite DELETE → UI 更新
```

**notification（通知）— userStreaming のみ:**
```
WebSocket → notification イベント → addNotification(notification, backendUrl) → SQLite INSERT → UI 更新
```

---

## 5. リトライ戦略

> ソース: `src/util/streaming/constants.ts`

### 5.1 エクスポネンシャルバックオフ

接続エラー時、指数関数的に増加する待機時間でリトライを行う。

| 定数 | 値 | 説明 |
|---|---|---|
| `RETRY_DELAY_MS` | 1,000ms | 初回リトライ待機時間 |
| `MAX_RETRY_DELAY_MS` | 30,000ms | 最大待機時間 |
| `MAX_RETRY_COUNT` | 10 | 最大リトライ回数 |

**待機時間の計算式:**

```typescript
getRetryDelay(retryCount) = Math.min(1000 * 2^retryCount, 30000)
```

| リトライ回数 | 待機時間 |
|---|---|
| 1回目 | 1秒 |
| 2回目 | 2秒 |
| 3回目 | 4秒 |
| 4回目 | 8秒 |
| 5回目 | 16秒 |
| 6回目以降 | 30秒（上限） |

### 5.2 リトライフロー

```
WebSocket エラー
  → stopStream() でゴースト再接続防止
  → retryCount インクリメント
  → MAX_RETRY_COUNT (10) 超過チェック
    → 超過: ログ出力して接続放棄
    → 未超過: setTimeout でリトライスケジュール
      → restartStream() で再接続能力を復元し start()
```

### 5.3 megalodon ワークアラウンド

megalodon の `stop()` メソッドには以下の問題がある:

1. `_connectionClosed = true` を設定するが、予約済みの `_reconnect()` をキャンセルしない
2. `_reconnect()` は `_connectionClosed` をチェックしない

このため、`stopStream()` で `_reconnectMaxAttempts` を `0` に強制設定し、ゴースト再接続を防止している。再接続時は `restartStream()` で `Infinity` に復元する。

### 5.4 接続数の警告

> ソース: `src/util/streaming/constants.ts`

`MAX_STREAM_COUNT_WARNING = 20` を超えるストリーム接続が必要な場合、コンソールに警告を出力する。ブラウザの WebSocket 同時接続数制限（Chrome: 同一ドメイン約 6、全体約 256）を考慮した設計。タグタイムライン × 複数バックエンドで接続数が急増するため、UI 側でのタグ数上限（推奨: 5 タグ以内）と併せて運用する。

---

## 6. Provider の責務分担

### 6.1 StatusStoreProvider

> ソース: `src/util/provider/StatusStoreProvider.tsx`

**責務: userStreaming の管理 + ステータス操作 API の提供**

| 機能 | 詳細 |
|---|---|
| **userStreaming 管理** | アプリごとに `client.userStreaming()` で WebSocket 接続 |
| **受信イベント処理** | `update` → `upsertStatus(…, 'home')` |
| | `status_update` → `updateStatus()` |
| | `notification` → `addNotification()` |
| | `delete` → `handleDeleteEvent(…, 'home')` |
| **ステータス操作** | `setFavourited(backendUrl, statusId, value)` |
| | `setReblogged(backendUrl, statusId, value)` |
| | `setBookmarked(backendUrl, statusId, value)` |
| **ユーザー/タグ収集** | ストリームで受信した投稿からユーザー情報・タグを抽出し Context に反映 |
| **定期メンテナンス** | `startPeriodicCleanup()` / `startPeriodicExport()` の起動 |
| **REST API 取得** | `getHomeTimeline` / `getNotifications`（Phase 3 で実行） |

**公開 Context:**

```typescript
type StatusStoreActions = {
  setFavourited: (backendUrl: string, statusId: string, value: boolean) => void
  setReblogged:  (backendUrl: string, statusId: string, value: boolean) => void
  setBookmarked: (backendUrl: string, statusId: string, value: boolean) => void
}
```

### 6.2 StreamingManagerProvider

> ソース: `src/util/provider/StreamingManagerProvider.tsx`

**責務: local / public / tag ストリームの動的管理**

| 機能 | 詳細 |
|---|---|
| **syncStreamsEvent** | `deriveRequiredStreams` の結果と現在のレジストリを diff し、不要ストリーム切断 + 新規ストリーム接続 |
| **初期データ取得** | `buildInitialFetchTasks` + `runWithConcurrencyLimit` で REST API から初期データを取得 |
| **接続状態参照** | `getStatus(key)` で特定ストリームの状態を取得 |
| **ライフサイクル管理** | アンマウント時に全ストリームをクリーンアップ |

**公開 Context:**

```typescript
type StreamingManagerActions = {
  getStatus: (key: string) => 'connected' | 'connecting' | 'disconnected' | 'error' | null
}
```

**設計方針:** コンポーネントからの `subscribe/unsubscribe` は行わない。`TimelineSettingsV2` を唯一の情報源（SSOT）とし、`syncStreamsEvent` がストリームのライフサイクルを一元管理する。

### 6.3 責務分担の比較

```
┌──────────────────────────────────────────────────┐
│              StatusStoreProvider                  │
│                                                  │
│  ・userStreaming (ホーム + 通知)                   │
│  ・ステータス操作 API (fav/reblog/bookmark)        │
│  ・REST API 初期取得 (home/notifications)          │
│  ・定期クリーンアップ / エクスポート               │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│           StreamingManagerProvider                │
│                                                  │
│  ・local / public / tag ストリーム               │
│  ・diff-based ストリーム同期 (syncStreamsEvent)    │
│  ・初期データ取得 (REST + 同時実行数制限)          │
│  ・接続状態の公開 (getStatus)                     │
└──────────────────────────────────────────────────┘
```

---

## 7. ストリーム接続のライフサイクル

### 7.1 起動シーケンス（StartupCoordinator 連携）

> ソース: `src/util/provider/StartupCoordinator.tsx`

アプリケーションの起動は 5 つのフェーズで段階的に進行する。ストリーミング接続はフェーズ 4〜5 に位置する。

```
Phase 1: init
  │  初期状態
  ▼
Phase 2: db-ready
  │  DB マイグレーション + accountResolver 初期化完了
  ▼
Phase 3: timeline-displayed → rest-fetched
  │  StatusStoreProvider:
  │    ・DB キャッシュからタイムライン表示
  │    ・REST API で getHomeTimeline / getNotifications を取得
  │    ・SQLite に書き込み
  ▼
Phase 4: rest-fetched → streaming
  │  StatusStoreProvider:
  │    ・userStreaming WebSocket 接続開始
  │  StreamingManagerProvider:
  │    ・deriveRequiredStreams で必要ストリーム算出
  │    ・syncStreamsEvent で diff-based 接続
  │    ・buildInitialFetchTasks で初期データ取得
  ▼
Phase 5: streaming
     ストリーミング接続完了・リアルタイム更新稼働中
```

### 7.2 タイムライン設定変更時の再計算

ユーザーがタイムライン設定を変更すると、以下の流れでストリームが再構成される:

```
TimelineSettingsV2 変更
  ▼
StreamingManagerProvider の useEffect 発火
  ▼
syncStreamsEvent()
  ├─ deriveRequiredStreams() → 新しい必要ストリーム Set を算出
  ├─ 差分比較:
  │    ├─ レジストリにあるが不要 → stopStream() で切断、レジストリから削除
  │    └─ 必要だがレジストリにない → プレースホルダー登録 → initializeStream()
  └─ 重複防止: initId による非同期初期化の整合性保証
  ▼
fetchInitialDataForTimelines()
  ├─ buildInitialFetchTasks() → 未取得の初期データタスクを構築
  └─ runWithConcurrencyLimit(tasks, 3) → 並行度制限付き実行
```

**重要な設計判断:**

- `syncStreamsEvent` は diff ベースで動作するため、設定変更時に全ストリームを再構築しない
- `initId` カウンターにより、非同期初期化中に `syncStreamsEvent` が再発火しても古い初期化結果が反映されない
- `fetchedInitialKeysRef` により、同一ストリームの初期データを重複取得しない
- バックエンド構成（apps）が変更された場合のみ `fetchedInitialKeysRef` をリセットする

---

## 次に読むべきドキュメント

- [`06-provider-architecture.md`](./06-provider-architecture.md) — Provider アーキテクチャ全体の設計と Context チェーン
