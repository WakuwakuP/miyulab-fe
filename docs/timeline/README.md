# タイムライン構築リファレンスドキュメント

このディレクトリには、miyulab-fe のタイムラインシステムの設計・実装に関するガイドドキュメントが含まれています。

## 🏗 アーキテクチャ概要

miyulab-fe のタイムラインは、Mastodon 互換の Fediverse サーバーから投稿データを取得し、ブラウザ内の SQLite データベースに蓄積・クエリすることでリアルタイムなタイムライン表示を実現しています。

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (React)                      │
│  DynamicTimeline → UnifiedTimeline / NotificationTL     │
│         ↑                                                │
│    useTimelineData (ファサード Hook)                      │
│    ├── useFilteredTimeline     (home / local / public)   │
│    ├── useFilteredTagTimeline  (tag)                     │
│    ├── useCustomQueryTimeline  (advanced query)          │
│    └── useNotifications       (notification)            │
│         ↑                                                │
│    SQLite subscribe() によるリアクティブ更新              │
├─────────────────────────────────────────────────────────┤
│              Data Layer (SQLite on OPFS)                 │
│  statuses / statuses_timeline_types /                    │
│  statuses_belonging_tags / statuses_backends /           │
│  statuses_mentions / muted_accounts / blocked_instances  │
├─────────────────────────────────────────────────────────┤
│            Ingestion Layer                               │
│  StreamingManagerProvider (local / public / tag WS)      │
│  StatusStoreProvider      (home userStreaming)           │
│  timelineFetcher          (REST 初期データ取得)           │
├─────────────────────────────────────────────────────────┤
│            External (Fediverse Servers)                  │
│  Mastodon / Misskey / Pleroma etc. via megalodon         │
└─────────────────────────────────────────────────────────┘
```

## 📖 ドキュメント一覧

### [01. システムアーキテクチャ](./01-architecture.md)

- 全体のデータフロー
- レイヤー構成と責務分離
- Provider ツリーと初期化順序
- マルチバックエンド対応の設計思想

### [02. タイムライン設定 (TimelineConfigV2)](./02-configuration.md)

- `TimelineConfigV2` の全プロパティ解説
- `TimelineSettingsV2` の構造
- `BackendFilter` の 3 モード（all / single / composite）
- `TagConfig` の OR / AND 条件
- フィルタオプション（メディア・公開範囲・言語・除外系）

### [03. データストレージ (SQLite)](./03-data-storage.md)

- SQLite スキーマ（statuses テーブルと関連テーブル）
- 正規化カラムの設計意図
- compositeKey の生成ルール
- URI ベースの重複排除（v3）
- マイグレーション戦略（V1 → V2 → V3）

### [04. ストリーミング管理](./04-streaming.md)

- `StreamingManagerProvider` の一元管理設計
- `deriveRequiredStreams` によるストリーム算出
- ストリームキーの形式（`type|backendUrl|tag`）
- リトライ戦略（エクスポネンシャルバックオフ）
- WebSocket 接続数の制限と警告

### [05. データ取得 (Fetcher)](./05-data-fetching.md)

- `fetchInitialData` の種別ごとの動作
- `fetchMoreData` のページネーション
- API パラメータと表示層フィルタの使い分け
- マルチバックエンドでの追加読み込み

### [06. フィルタリングシステム](./06-filtering.md)

- `buildFilterConditions` による SQL WHERE 句生成
- 各フィルタ条件の SQL マッピング
- ミュート・インスタンスブロックの適用ルール
- カスタムクエリのサニタイズ
- `queryBuilder` との連携

### [07. React Hooks](./07-hooks.md)

- `useTimelineData` ファサードパターン
- `useFilteredTimeline` の SQL クエリ戦略
- `useFilteredTagTimeline` の OR / AND 条件
- `useCustomQueryTimeline` のセキュリティ設計
- `subscribe()` によるリアクティブ更新の仕組み

### [08. UI コンポーネント](./08-components.md)

- `DynamicTimeline` のルーティング
- `UnifiedTimeline` の仮想スクロール（Virtuoso）
- `TimelineManagement` の設定管理 UI
- `TimelineEditPanel` のフィルタ編集
- 表示名の自動生成（`getDefaultTimelineName`）

### [09. 設定マイグレーション](./09-migration.md)

- V1 → V2 マイグレーションルール
- 型ガード（`isV1Settings` / `isV2Settings`）
- `BackendFilter` / `TagConfig` の正規化
- localStorage からの読み込みと永続化

## 🔑 設計上のキーコンセプト

### 1. SSOT (Single Source of Truth)

- **タイムライン設定**: `TimelineSettingsV2`（localStorage に永続化）が唯一の設定情報源
- **ストリーム管理**: `deriveRequiredStreams` が設定から必要なストリームを宣言的に算出
- **投稿データ**: SQLite が投稿データの唯一のストアであり、React は `subscribe()` で監視するだけ

### 2. SQL ファーストのフィルタリング

正規化カラム（`has_media`, `visibility`, `language` 等）により、フィルタリングを SQL の WHERE 句で直接実行。LIMIT の精度が向上し、JavaScript 側のフィルタが不要。

### 3. マルチバックエンド

複数の Fediverse サーバーに同時接続し、投稿を統合的に表示。`BackendFilter` で対象サーバーを柔軟に選択可能。

### 4. ストリーム一元管理

コンポーネントからの subscribe/unsubscribe は行わず、`StreamingManagerProvider` が `TimelineSettingsV2` の変更に連動してストリームのライフサイクルを完全に管理。

## 📂 関連ファイル一覧

| カテゴリ | ファイルパス | 概要 |
|---|---|---|
| 型定義 | `src/types/types.ts` | `TimelineConfigV2`, `TimelineSettingsV2` 等 |
| Provider | `src/util/provider/TimelineProvider.tsx` | 設定の永続化と Context 提供 |
| Provider | `src/util/provider/StreamingManagerProvider.tsx` | ストリーム一元管理 |
| Provider | `src/util/provider/HomeTimelineProvider.tsx` | Home TL & 通知の Context |
| Hook | `src/util/hooks/useTimelineData.ts` | ファサード Hook |
| Hook | `src/util/hooks/useFilteredTimeline.ts` | home / local / public 用 |
| Hook | `src/util/hooks/useFilteredTagTimeline.ts` | tag 用 |
| Hook | `src/util/hooks/useCustomQueryTimeline.ts` | カスタムクエリ用 |
| Hook | `src/util/hooks/useTimeline.ts` | 旧 Hook（deprecated） |
| Util | `src/util/hooks/timelineFilterBuilder.ts` | SQL WHERE 句生成 |
| Util | `src/util/timelineFetcher.ts` | REST API データ取得 |
| Util | `src/util/timelineConfigValidator.ts` | 設定の正規化 |
| Util | `src/util/timelineDisplayName.ts` | 表示名の自動生成 |
| Util | `src/util/migration/migrateTimeline.ts` | V1→V2 マイグレーション |
| Streaming | `src/util/streaming/deriveRequiredStreams.ts` | 必要ストリーム算出 |
| Streaming | `src/util/streaming/streamKey.ts` | ストリームキー生成・パース |
| Streaming | `src/util/streaming/streamRegistry.ts` | ストリーム状態管理型 |
| Streaming | `src/util/streaming/constants.ts` | リトライ定数 |
| DB | `src/util/db/sqlite/schema.ts` | SQLite スキーマ定義 |
| DB | `src/util/db/sqlite/statusStore.ts` | 投稿の CRUD 操作 |
| Component | `src/app/_components/DynamicTimeline.tsx` | タイムラインルーティング |
| Component | `src/app/_components/UnifiedTimeline.tsx` | 統合タイムライン表示 |
| Component | `src/app/_components/TimelineManagement.tsx` | 設定管理 UI |
| Component | `src/app/_components/TimelineEditPanel.tsx` | フィルタ編集パネル |
