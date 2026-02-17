# 01. システムアーキテクチャ

## 概要

miyulab-fe のタイムラインシステムは、Mastodon 互換の Fediverse サーバー群からリアルタイムに投稿データを取得し、ブラウザ内 SQLite に蓄積・クエリすることで高度なフィルタリングとマルチバックエンド統合を実現するクライアントサイドアーキテクチャです。

## レイヤー構成

システムは以下の 4 レイヤーで構成されています。

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer (React)                         │
│                                                             │
│  DynamicTimeline ─┬─ UnifiedTimeline (home/local/public/tag)│
│                   └─ NotificationTimeline (notification)    │
│         ↑                                                   │
│    useTimelineData (ファサード Hook)                         │
│    ├── useFilteredTimeline     (home / local / public)       │
│    ├── useFilteredTagTimeline  (tag)                         │
│    ├── useCustomQueryTimeline  (advanced query)              │
│    └── useNotifications       (notification)                │
│         ↑                                                   │
│    SQLite subscribe() によるリアクティブ更新                  │
├─────────────────────────────────────────────────────────────┤
│                Data Layer (SQLite on OPFS)                   │
│                                                             │
│  statuses              ← 投稿本体（正規化カラム + JSON）     │
│  statuses_timeline_types  ← 投稿 × タイムライン種別          │
│  statuses_belonging_tags  ← 投稿 × タグ                     │
│  statuses_backends        ← 投稿 × バックエンド（v3）       │
│  statuses_mentions        ← 投稿 × メンション               │
│  muted_accounts           ← ミュートアカウント              │
│  blocked_instances        ← ブロックインスタンス             │
│  notifications            ← 通知                           │
├─────────────────────────────────────────────────────────────┤
│                  Ingestion Layer                             │
│                                                             │
│  StreamingManagerProvider ← local / public / tag WebSocket  │
│  StatusStoreProvider      ← home userStreaming              │
│  timelineFetcher          ← REST API 初期データ取得          │
├─────────────────────────────────────────────────────────────┤
│                External (Fediverse Servers)                  │
│                                                             │
│  Mastodon / Misskey / Pleroma etc. via megalodon ライブラリ   │
└─────────────────────────────────────────────────────────────┘
```

### 1. External Layer（外部サーバー）

Mastodon 互換 API を持つ Fediverse サーバー群。megalodon ライブラリを通じて REST API と WebSocket Streaming API にアクセスします。複数のサーバー（バックエンド）に同時接続が可能です。

### 2. Ingestion Layer（データ取り込み層）

外部サーバーからデータを取得し、SQLite に書き込む責務を担います。

| コンポーネント | 責務 | 対象 |
|---|---|---|
| `StreamingManagerProvider` | WebSocket ストリームの一元管理 | local / public / tag |
| `StatusStoreProvider` | userStreaming + Home TL 初期取得 | home |
| `timelineFetcher` | REST API による初期データ・追加データ取得 | local / public / tag |

### 3. Data Layer（データ層）

ブラウザ内 SQLite（OPFS 上）に投稿データを蓄積します。正規化カラムにより SQL レベルでのフィルタリングが可能で、LIMIT の精度が高く JavaScript 側のフィルタが不要です。

### 4. UI Layer（表示層）

React Hooks が SQLite の変更通知（`subscribe()`）を購読し、リアクティブにデータを取得・表示します。仮想スクロール（react-virtuoso）により大量の投稿を効率的にレンダリングします。

## データフロー

### リアルタイムデータフロー（ストリーミング）

```
Fediverse Server
  │
  │  WebSocket (update / delete イベント)
  ▼
StreamingManagerProvider
  │
  │  upsertStatus() / handleDeleteEvent()
  ▼
SQLite (statuses テーブル)
  │
  │  subscribe('statuses', callback) による変更通知
  ▼
useFilteredTimeline / useFilteredTagTimeline
  │
  │  SQL クエリ → StatusAddAppIndex[]
  ▼
UnifiedTimeline (Virtuoso)
  │
  │  仮想スクロールレンダリング
  ▼
Status コンポーネント表示
```

### 初期データ取得フロー

```
アプリ起動 / タイムライン設定変更
  │
  ▼
StreamingManagerProvider.useEffect()
  │
  ├── syncStreamsEvent()         ← ストリーム接続の同期
  └── fetchInitialDataForTimelines() ← 初期データ取得
        │
        │  fetchInitialData(client, config, backendUrl)
        ▼
      REST API (getLocalTimeline / getPublicTimeline / getTagTimeline)
        │
        │  bulkUpsertStatuses()
        ▼
      SQLite (statuses テーブル)
        │
        │  subscribe() 通知
        ▼
      React Hooks → UI 更新
```

### 追加読み込みフロー（スクロール末尾到達時）

```
UnifiedTimeline: endReached イベント
  │
  ▼
moreLoad() コールバック
  │
  │  resolveBackendUrls() で対象バックエンドを特定
  │  各バックエンドの最古投稿 ID を算出
  ▼
fetchMoreData(client, config, backendUrl, maxId)
  │
  │  REST API (max_id パラメータ)
  │  bulkUpsertStatuses()
  ▼
SQLite (statuses テーブル)
  │
  │  subscribe() 通知
  ▼
React Hooks → UI 更新
```

## Provider ツリーと初期化順序

タイムライン関連の Provider は以下の順序でネストされます。

```tsx
<AppsProvider>              {/* 登録済みアカウント（App[]）を管理 */}
  <TimelineProvider>        {/* タイムライン設定を localStorage から復元 */}
    <StatusStoreProvider>   {/* home TL の userStreaming + 初期取得 */}
      <StreamingManagerProvider>  {/* local/public/tag のストリーム一元管理 */}
        <HomeTimelineProvider>    {/* home TL / 通知の Context 提供 */}
          {/* アプリケーション本体 */}
        </HomeTimelineProvider>
      </StreamingManagerProvider>
    </StatusStoreProvider>
  </TimelineProvider>
</AppsProvider>
```

### 初期化の流れ

1. **`AppsProvider`**: IndexedDB から登録済みアカウント情報を読み込み、`AppsContext` で提供
2. **`TimelineProvider`**: localStorage から `TimelineSettingsV2` を読み込み（V1 形式の場合はマイグレーション実行）
3. **`StatusStoreProvider`**: 各アカウントに対して `userStreaming()` を開始し、`getHomeTimeline()` で Home TL の初期データを取得
4. **`StreamingManagerProvider`**: `TimelineSettingsV2` と `apps` を監視し、`deriveRequiredStreams()` で必要なストリームを算出。不要なストリームを切断し、未接続のストリームを新規接続。同時に `fetchInitialData()` で REST API から初期データを取得

## マルチバックエンド設計

### 概要

miyulab-fe は複数の Fediverse サーバーに同時にログインし、それぞれのタイムラインを統合表示できます。

### BackendFilter による対象サーバー選択

各タイムライン設定（`TimelineConfigV2`）に `BackendFilter` を指定することで、対象サーバーを柔軟に制御できます。

| モード | 説明 | 例 |
|---|---|---|
| `all` | 全登録サーバーを対象 | デフォルト動作 |
| `single` | 特定の 1 サーバーのみ | 特定インスタンスの LTL |
| `composite` | 複数サーバーの組み合わせ | サーバー A + B の統合 TL |

### appIndex の算出

投稿データは `backendUrl` を持ちますが、UI 操作（ブースト・お気に入り等）には `appIndex`（`apps` 配列のインデックス）が必要です。`appIndex` は DB に永続化せず、表示時に `resolveAppIndex()` で都度算出します。

```typescript
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}
```

`-1` を返した場合は該当アカウントが削除済みのため、その投稿は表示対象から除外されます。

### compositeKey

投稿の一意識別子として `compositeKey`（`backendUrl + ":" + status.id`）を使用します。v3 スキーマでは同一投稿が複数バックエンドから取得される場合、`uri` ベースの重複排除により単一の `compositeKey` に統合されます。

```
compositeKey = "https://mastodon.social:123456"
```

## ストリーム管理の設計思想

### 宣言的ストリーム管理

従来のイベント駆動型の subscribe/unsubscribe パターンではなく、**宣言的な同期モデル**を採用しています。

```
TimelineSettingsV2 が変更される
  ↓
deriveRequiredStreams() が「あるべきストリームの集合」を算出
  ↓
syncStreamsEvent() が現在の接続状態と比較
  ├── 不要なストリーム → 切断・削除
  └── 未接続のストリーム → 新規接続
```

この設計により、コンポーネントからの明示的な subscribe/unsubscribe が不要となり、設定変更時のストリーム状態の不整合が発生しません。

### ストリーム種別と担当

| ストリーム種別 | 管理者 | WebSocket API |
|---|---|---|
| userStreaming | `StatusStoreProvider` | `client.userStreaming()` |
| localStreaming | `StreamingManagerProvider` | `client.localStreaming()` |
| publicStreaming | `StreamingManagerProvider` | `client.publicStreaming()` |
| tagStreaming | `StreamingManagerProvider` | `client.tagStreaming(tag)` |

`userStreaming` のみ `StatusStoreProvider` が管理する理由は、Home タイムラインと通知が `userStreaming` に含まれるため、アカウントごとに 1 接続で済むからです。

## リアクティブ更新の仕組み

### subscribe / notify パターン

SQLite のデータ変更は `subscribe()` / `notify()` パターンで React Hooks に通知されます。

```typescript
// connection.ts
const listeners = new Map<string, Set<() => void>>()

export function subscribe(table: string, callback: () => void) {
  // テーブルの変更リスナーを登録
  if (!listeners.has(table)) listeners.set(table, new Set())
  listeners.get(table)!.add(callback)
  return () => listeners.get(table)?.delete(callback)
}

export function notify(table: string) {
  // テーブルの変更を通知 → 全リスナーが再実行
  listeners.get(table)?.forEach((cb) => cb())
}
```

### Hook での利用

```typescript
// useFilteredTimeline.ts
useEffect(() => {
  fetchData()                          // 初回データ取得
  return subscribe('statuses', fetchData) // 変更通知で再取得
}, [fetchData])
```

`upsertStatus()` や `bulkUpsertStatuses()` が SQLite に書き込むと `notify('statuses')` が発火し、全タイムライン Hook が再クエリを実行します。

## パフォーマンス最適化

### SQL ファーストのフィルタリング

正規化カラム（`has_media`, `visibility`, `language`, `is_reblog` 等）を SQLite のカラムとして保持し、WHERE 句で直接フィルタリングします。

**メリット:**
- LIMIT の精度が向上（「メディア付き投稿 40 件」を正確に取得可能）
- JavaScript 側の配列フィルタが不要
- インデックスによる高速クエリ

### 仮想スクロール

`react-virtuoso` ライブラリにより、DOM に実際にマウントされるのは画面に表示される投稿のみ。数千件の投稿があっても一定のメモリ使用量でレンダリングできます。

### Hook の無条件呼び出しと早期リターン

`useTimelineData` ファサードでは React の Hook ルール（条件分岐内での Hook 呼び出し禁止）を遵守するため、全 Hook を無条件に呼び出します。各 Hook 内部で `config.type` をチェックし、不要な場合は DB クエリをスキップして空配列を返すため、パフォーマンスへの影響はありません。

```typescript
export function useTimelineData(config: TimelineConfigV2) {
  // 全 Hook を無条件に呼び出す（Hook ルール遵守）
  const filteredTimeline = useFilteredTimeline(config)
  const filteredTagTimeline = useFilteredTagTimeline(config)
  const notifications = useNotifications(config)
  const customQueryTimeline = useCustomQueryTimeline(config)

  // type に応じて結果を選択
  switch (config.type) {
    case 'home':
    case 'local':
    case 'public':
      return filteredTimeline
    // ...
  }
}
```
