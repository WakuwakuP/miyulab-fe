# 04. ストリーミングとデータ取得

## 概要

タイムラインのデータソースは 2 つ：**API フェッチ**（初期データ + ページネーション）と **WebSocket ストリーミング**（リアルタイム更新）。両者は並行して動作し、どちらもデータを SQLite に書き込む。

```
                    ┌─ StatusStoreProvider ──── userStreaming (認証必要)
WebSocket ─────────┤
                    └─ StreamingManagerProvider ─┬─ localStreaming
                                                 ├─ publicStreaming
                                                 └─ tagStreaming
                    ┌─ 初期データ取得
API フェッチ ───────┤
                    └─ ページネーション（スクロール時）
```

## ストリーミング

### 2 つの Provider の役割分担

| Provider | ストリーム種別 | 認証 | ライフサイクル |
|----------|-------------|------|-------------|
| `StatusStoreProvider` | `userStreaming()` | 必要（OAuth トークン） | バックエンドごとに 1 本、常時接続 |
| `StreamingManagerProvider` | `localStreaming()`, `publicStreaming()`, `tagStreaming()` | 不要 | タイムライン設定に応じて動的に接続/切断 |

**なぜ分かれているか**: `userStreaming` はユーザー固有のホームタイムラインと通知を受信するため認証が必要。public/local/tag ストリームは認証不要で、タイムライン設定の変更（タグの追加・タイムラインの削除など）に応じて動的に増減する。ライフサイクルが異なるため別 Provider で管理する。

### StreamingManagerProvider の動作

#### 必要なストリームの導出

`deriveRequiredStreams()` がタイムライン設定から必要なストリームを計算する。

```typescript
// 入力: TimelineConfigV2[], App[]
// 出力: Set<string>  (ストリームキー)

// 全バックエンドに対して常にローカル・パブリックを接続
// タグタイムラインがあればタグストリームも追加
```

ストリームキーは `streamKey.ts` で `'タイプ|URL|タグ'` 形式で管理：
- `local|https://mastodon.social`
- `public|https://mastodon.social`
- `tag|https://mastodon.social|miyulab`

#### ストリームの同期

`syncStreamsEvent()` が現在のストリームと必要なストリームを比較し、差分を適用する。

```
現在のストリーム:  { local|A, public|A, tag|A|foo }
必要なストリーム:  { local|A, public|A, tag|A|bar }

→ 停止: tag|A|foo
→ 新規: tag|A|bar
→ 維持: local|A, public|A
```

#### イベントハンドラ

各ストリームは megalodon ライブラリの WebSocket を使用し、以下のイベントを処理：

| イベント | 処理 |
|---------|------|
| `update` | `upsertStatus()` で SQLite に書き込み |
| `status_update` | `updateStatus()` で既存投稿を更新（編集対応） |
| `delete` | `handleDeleteEvent()` で削除 |
| `connect` | リトライカウンタリセット、ログ出力 |
| `error` | リトライロジック発動 |

### StatusStoreProvider の動作

`userStreaming()` で受信するイベント：

| イベント | 処理 |
|---------|------|
| `update` | `upsertStatus(status, backendUrl, 'home')` |
| `status_update` | `updateStatus(status, backendUrl)` |
| `notification` | `addNotification(notification, backendUrl)` |
| `delete` | `handleDeleteEvent(backendUrl, id, 'home')` |

### リトライロジック

両 Provider で共通のリトライ設定：

```typescript
INITIAL_RETRY_DELAY = 1000     // 初回 1秒
MAX_RETRY_DELAY     = 30000    // 最大 30秒
MAX_RETRY_COUNT     = 10       // 最大 10回
```

指数バックオフ: `delay = min(INITIAL * 2^retryCount, MAX_DELAY)`

### megalodon の reconnect バグ回避

`stopStream.ts` が megalodon 内部の自動再接続メカニズムを回避する：

```typescript
// megalodon の内部プロパティを操作して
// 意図しない再接続を防止
socket._reconnectMaxAttempts = 0
socket.stop()

// 再開時は再接続能力を復元してから start()
socket._reconnectMaxAttempts = Infinity
socket.start()
```

### 同時接続数の警告

`constants.ts` で `MAX_CONNECTIONS_WARNING = 20` を定義。多数のバックエンド × ストリーム種別で接続数が増加した場合にコンソール警告を出す。

## API フェッチ

### 初期データ取得

`timelineFetcher.ts` の `fetchInitialData()` がアプリ起動時にデータを取得する。

| タイムライン種別 | API コール |
|---------------|-----------|
| `home` | スキップ（StatusStoreProvider が処理） |
| `local` | `client.getLocalTimeline({ limit: 40 })` |
| `public` | `client.getPublicTimeline({ limit: 40 })` |
| `tag` | 各タグごとに `client.getTagTimeline(tag, { limit: 40 })` |

取得結果は `bulkUpsertStatuses()` で SQLite に一括格納。

### ページネーション

`fetchMoreData()` がスクロール到達時に追加データを取得する。

```typescript
const FETCH_LIMIT = 40

async function fetchMoreData(
  app: App,
  timelineType: TimelineType,
  maxId: string,        // カーソル位置
  tag?: string
): Promise<number>      // 取得件数を返す
```

- `max_id` パラメータによるカーソルベースページネーション
- 取得件数 < `FETCH_LIMIT` の場合、そのバックエンドのデータは枯渇と判定
- タグタイムラインでは **タグごとに** `max_id` を追跡

### API クライアント

`GetClient.ts` で megalodon の generator を使用：

```typescript
const GetClient = (app: App) => {
  const { backend, backendUrl, tokenData } = app
  return generator(backend, backendUrl, tokenData?.access_token)
}
```

対応バックエンド: mastodon, pleroma, friendica, firefish, gotosocial, pixelfed

### 初期データ取得とストリーミングの並行動作

```
時間 →
     │
     ├── fetchInitialData(local)  ─────→ bulkUpsert 40件
     ├── fetchInitialData(public) ─────→ bulkUpsert 40件
     ├── localStreaming  ──────── 受信開始 ──→ upsert ──→ upsert ──→ ...
     ├── publicStreaming ──────── 受信開始 ──→ upsert ──→ upsert ──→ ...
     │
     ▼ UI表示
     初期データ表示 ─→ ストリーム分が自動追加
```

ストリーミング接続と初期データ取得は **待ち合わせなし** で並行実行される。どちらも同じ SQLite テーブルに書き込み、`notifyChange` で UI が自動更新される。初期データが到着する前にストリーム経由で投稿が来ることもあるが、URI 重複排除により整合性は保たれる。
