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
│  upsertStatus() ← マイクロバッチ          │
│  addNotification()                      │
│                                         │
│  ・URI重複排除                            │
│  ・正規化 (profiles, media, tags, ...)   │
│  ・トランザクション内で一括処理              │
│  ・changedTables + ChangeHint を返却     │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│          SQLite (OPFS永続化)             │
│                                         │
│  posts, notifications                   │
│  profiles, post_media, ...              │
│  timeline_entries, local_accounts       │
└────────────────┬────────────────────────┘
                 │
                 │  notifyChange('posts', hint)
                 │  80ms デバウンス
                 ▼
┌─────────────────────────────────────────┐
│          React Hooks (読み取り)           │
│                                         │
│  subscribe('posts', (hints) => ...)     │
│  ChangeHint で関連変更のみ再クエリ         │
│  fetchTimeline() バッチ API              │
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

1. **URI ベース重複排除**: ActivityPub URI をユニークキーにして `post_backend_ids` テーブルで複数バックエンドとの関連を管理。同じ投稿が mastodon.social と misskey.io の両方から来ても 1 レコード。
2. **SQL による柔軟なフィルタ**: WHERE 句で言語・可視性・メディア有無・ミュートなどを組み合わせ可能。ユーザーは Advanced Query で直接 SQL を書ける。
3. **OPFS 永続化**: ブラウザの Origin Private File System に保存し、ページリロード後もデータを保持。
4. **Worker 分離**: 書き込みを Dedicated Worker に隔離し、大量の投稿を受信してもメインスレッドがブロックされない。
5. **優先度キュー**: `dbQueue.ts` がタイムライン読み取りと書き込み操作の優先度を動的に制御。

## レイヤー構成

### 1. データ取得レイヤー

| コンポーネント | 責務 |
|--------------|------|
| `StatusStoreProvider` | ホームタイムライン + 通知の WebSocket (`userStreaming`) と初期データ取得 |
| `StreamingManagerProvider` | ローカル・パブリック・タグの WebSocket 管理。全バックエンドに対して常にローカル・パブリックを接続し、タグストリームはタイムライン設定に応じて動的に管理 |
| `timelineFetcher` | API 経由の初期データ取得とページネーション |

### 2. ストレージレイヤー

| コンポーネント | 責務 |
|--------------|------|
| `stores/statusStore` | マイクロバッチ書き込み（100ms or 20件閾値）、正規化処理 |
| `notificationStore` | 通知の upsert・クエリ処理 |
| `schema/` | テーブル定義（テーブル別ファイル） |
| `schema/version.ts` | SemVer バージョン管理（v2.0.1） |
| `migrations/` | マイグレーション実行（v2.0.0, v2.0.1） |
| `connection.ts` | シングルトン接続と変更通知（subscribe/notifyChange + ChangeHint + 80ms デバウンス） |
| `dbQueue.ts` | 二重優先度キュー（timeline 読み取り / other 書き込み） |

### 3. クエリレイヤー

| コンポーネント | 責務 |
|--------------|------|
| `useFilteredTimeline` | home/local/public の 2 フェーズクエリ（fetchTimeline バッチ API） |
| `useFilteredTagTimeline` | タグの OR/AND モードクエリ |
| `useCustomQueryTimeline` | Advanced Query のカスタム SQL 実行（施策 A〜E 最適化） |
| `queries/statusFilter` | TimelineConfigV2 → SQL WHERE 句変換 |

### 4. 表示レイヤー

| コンポーネント | 責務 |
|--------------|------|
| `DynamicTimeline` | 設定に基づき適切なタイムライン実装を選択（visible チェック含む） |
| `UnifiedTimeline` | Virtuoso 仮想スクロール + 無限スクロール + API ページネーション |
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
- **StreamingManagerProvider** は認証不要な public/local/tag ストリームを管理する。local と public は全バックエンドに対して常時接続し、tag ストリームはタイムライン設定の変更に応じて動的に追加・削除する。
- **HomeTimelineProvider** は既存の UI コンポーネントとの後方互換のためのアダプタレイヤー。内部的には同じ SQLite を参照する。

## リアクティブ更新の仕組み

```
WebSocket 受信 → マイクロバッチ (100ms/20件) → Worker 書き込み
                                                    │
                                         changedTables + ChangeHint
                                                    │
                                                    ▼
                              notifyChange('posts', { timelineType, backendUrl, tag })
                                                    │
                                          80ms デバウンスで集約
                                                    │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                         Timeline A   Timeline B   Timeline C
                         (ChangeHint   (ChangeHint   (ChangeHint
                          マッチ→      不一致→       マッチ→
                          requery)     スキップ)     requery)
```

1. ストリーミングイベントはマイクロバッチで蓄積される（100ms or 20件閾値）
2. バッチが Worker にフラッシュされ、トランザクション内で一括処理
3. Worker がデータベースに書き込んだ後、影響を受けたテーブル名と `ChangeHint`（timelineType, backendUrl, tag）を返す
4. `notifyChange()` が 80ms デバウンスでヒントを集約
5. `subscribe()` で登録された各 Hook のコールバックが `ChangeHint[]` 配列と共に発火
6. 各 Hook は ChangeHint を検査し、自身に関連する変更の場合のみ再クエリを実行
7. React の state が更新され、UI が自動的に再描画される

この pub-sub パターンと ChangeHint による選択的再クエリにより、どのストリームからデータが来ても、そのデータを表示すべきタイムラインのみが効率的に自動更新される。
