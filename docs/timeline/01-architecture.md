# 01. アーキテクチャ概要

## データフロー全体像

```
┌─────────────────┐     ┌─────────────────┐
│ Mastodon API    │     │ WebSocket       │
│ (初期/ページング) │     │ (リアルタイム)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  Entity.Status        │  stream events
         │  Entity.Notification  │  (update/delete/notification)
         ▼                       ▼
┌─────────────────────────────────────────┐
│          Web Worker (書き込み専用)         │
│                                         │
│  bulkUpsertStatuses()                   │
│  upsertStatus()                         │
│  addNotification()                      │
│                                         │
│  ・URI重複排除                            │
│  ・正規化 (profiles, media, tags, ...)   │
│  ・トランザクション内で一括処理              │
│  ・changedTables を返却                  │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│          SQLite (OPFS永続化)             │
│                                         │
│  posts, notifications                   │
│  profiles, post_media, ...              │
│  timeline_items, timelines              │
└────────────────┬────────────────────────┘
                 │
                 │  notifyChange('posts')
                 ▼
┌─────────────────────────────────────────┐
│          React Hooks (読み取り)           │
│                                         │
│  subscribe('posts', requery)            │
│  execAsync(SELECT ...)                  │
│  2フェーズクエリ                          │
└────────────────┬────────────────────────┘
                 │
                 │  SqliteStoredStatus[]
                 ▼
┌─────────────────────────────────────────┐
│          UI コンポーネント                │
│                                         │
│  Virtuoso 仮想スクロール                  │
│  無限スクロール                           │
│  タブグループ                             │
└─────────────────────────────────────────┘
```

## なぜデータベースファーストか

### 問題: マルチバックエンドの統合

一般的な Mastodon クライアントは 1 つのサーバに接続する。miyulab-fe は **複数サーバのデータを統合** する必要がある。

API レスポンスをメモリに保持するアプローチでは：
- 同じ投稿が異なるサーバから到着した場合の重複排除が困難
- フィルタやソートをサーバ横断で行うには全データをメモリに保持する必要がある
- ページ離脱でデータが消失する

### 解決: SQLite をデータハブにする

SQLite をすべてのデータの単一ソース（Single Source of Truth）とすることで：

1. **URI ベース重複排除**: ActivityPub URI をユニークキーにして `posts_backends` テーブルで複数バックエンドとの関連を管理。同じ投稿が mastodon.social と misskey.io の両方から来ても 1 レコード。
2. **SQL による柔軟なフィルタ**: WHERE 句で言語・可視性・メディア有無・ミュートなどを組み合わせ可能。ユーザーは Advanced Query で直接 SQL を書ける。
3. **OPFS 永続化**: ブラウザの Origin Private File System に保存し、ページリロード後もデータを保持。
4. **Worker 分離**: 書き込みを Dedicated Worker に隔離し、大量の投稿を受信してもメインスレッドがブロックされない。

## レイヤー構成

### 1. データ取得レイヤー

| コンポーネント | 責務 |
|--------------|------|
| `StatusStoreProvider` | ホームタイムライン + 通知の WebSocket (`userStreaming`) と初期データ取得 |
| `StreamingManagerProvider` | ローカル・パブリック・タグの WebSocket 管理。タイムライン設定に基づき必要なストリームを動的に接続・切断 |
| `timelineFetcher` | API 経由の初期データ取得とページネーション |

### 2. ストレージレイヤー

| コンポーネント | 責務 |
|--------------|------|
| `workerStatusStore` | Worker 内での投稿 upsert・正規化処理 |
| `workerNotificationStore` | Worker 内での通知 upsert 処理 |
| `schema.ts` | スキーマ定義とマイグレーション（v1〜v20） |
| `connection.ts` | シングルトン接続と変更通知（subscribe/notifyChange） |

### 3. クエリレイヤー

| コンポーネント | 責務 |
|--------------|------|
| `useFilteredTimeline` | home/local/public の 2 フェーズクエリ |
| `useFilteredTagTimeline` | タグの OR/AND モードクエリ |
| `useCustomQueryTimeline` | Advanced Query のカスタム SQL 実行 |
| `timelineFilterBuilder` | TimelineConfigV2 → SQL WHERE 句変換 |

### 4. 表示レイヤー

| コンポーネント | 責務 |
|--------------|------|
| `DynamicTimeline` | 設定に基づき適切なタイムライン実装を選択 |
| `UnifiedTimeline` | Virtuoso 仮想スクロール + 無限スクロール |
| `MixedTimeline` | 投稿と通知を混合表示 |
| `TabbedTimeline` | タブグループのラッパー |

## Provider 階層

アプリケーション起動時の Provider 階層（タイムライン関連のみ抜粋）：

```
AppsProvider              ← App[] 管理（バックエンド認証情報）
  └─ TimelineProvider     ← TimelineConfigV2[] 管理（設定永続化）
       └─ StatusStoreProvider   ← ホームストリーム + 通知ストリーム
            └─ StreamingManagerProvider  ← ローカル/パブリック/タグストリーム
                 └─ HomeTimelineProvider ← 後方互換アダプタ
                      └─ Page コンポーネント
```

### なぜ Provider が分かれているか

- **StatusStoreProvider** はユーザー認証が必要な `userStreaming()` を管理する。各バックエンドにつき 1 本のストリーム。
- **StreamingManagerProvider** は認証不要な public/local/tag ストリームを管理する。タイムライン設定の変更に応じて動的にストリームを追加・削除する。
- **HomeTimelineProvider** は既存の UI コンポーネントとの後方互換のためのアダプタレイヤー。内部的には同じ SQLite を参照する。

## リアクティブ更新の仕組み

```
WebSocket 受信 → Worker 書き込み → changedTables: ['posts']
                                           │
                                           ▼
                              notifyChange('posts')
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         Timeline A   Timeline B   Timeline C
                         (requery)    (requery)    (requery)
```

1. Worker がデータベースに書き込んだ後、影響を受けたテーブル名を返す
2. `workerClient` が各テーブルの `notifyChange()` を呼ぶ
3. `subscribe()` で登録された各 Hook のコールバックが発火
4. 各 Hook が再クエリを実行し、React の state が更新される
5. UI が自動的に再描画される

この pub-sub パターンにより、どのストリームからデータが来ても、そのデータを表示すべきすべてのタイムラインが自動更新される。
