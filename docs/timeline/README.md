# タイムラインシステム設計書

miyulab-fe のタイムラインシステムの設計ドキュメント。

## 設計思想

miyulab-fe は **複数の Mastodon 互換サーバ（バックエンド）** を横断的に閲覧できるクライアントである。タイムラインシステムはその中核を成し、以下の設計原則に基づいている。

### データベースファーストアーキテクチャ

従来の Mastodon クライアントは API レスポンスを直接メモリに保持し表示する。miyulab-fe は異なるアプローチを取る。

```
API / WebSocket ──→ SQLite (OPFS) ──→ React UI
                    ↑ 正規化・重複排除     ↑ クエリ・フィルタ
```

すべてのデータは一度 SQLite に格納され、UI はデータベースをクエリして表示する。この設計により：

- **マルチバックエンド統合**: 複数サーバのデータを単一データベースで管理
- **URI 重複排除**: ActivityPub URI で連合上の同一投稿を自動的に統合
- **高度なフィルタリング**: SQL の表現力を活かした柔軟なフィルタ
- **オフライン耐性**: ブラウザを再開しても過去のデータが残る
- **UI 非ブロック**: 書き込みは Web Worker で実行、優先度キューで制御

### マルチバックエンドの統合

複数の Mastodon / Pleroma / Firefish / Misskey 等のアカウントを登録し、それぞれのホーム・ローカル・パブリックタイムラインを **1つのビューに統合** できる。`BackendFilter` により、全バックエンド / 単一 / 任意の組み合わせでフィルタ可能。

### ユーザーによるカスタマイズ

タイムラインの追加・削除・並べ替え・フォルダ管理・タブグループ化に加え、Advanced Query モードでは **任意の SQL WHERE 句** を直接書いてフィルタリングできる。

## ドキュメント構成

| 章 | 内容 |
|----|------|
| [01. アーキテクチャ概要](./01-architecture.md) | データフロー、レイヤー構成、Provider 階層 |
| [02. 設定モデル](./02-configuration.md) | TimelineConfigV2、フィルタ型、永続化 |
| [03. データストレージ](./03-data-storage.md) | SQLite スキーマ、テーブル設計、Worker 構成 |
| [04. ストリーミングとデータ取得](./04-streaming.md) | WebSocket、API フェッチ、初期データロード |
| [05. クエリシステム](./05-data-fetching.md) | 2 フェーズクエリ、フィルタビルダー、Advanced Query |
| [06. フィルタリング](./06-filtering.md) | フィルタ種別、SQL 生成 |
| [07. React Hooks](./07-hooks.md) | useTimelineData ディスパッチ、リアクティブ更新 |
| [08. UI コンポーネント](./08-components.md) | 仮想スクロール、タブ、管理 UI |
| [09. マイグレーション](./09-migration.md) | スキーマ進化、設定マイグレーション |

## 関連ファイル一覧

### コンポーネント
- `src/app/_components/DynamicTimeline.tsx` — ルーティング
- `src/app/_components/UnifiedTimeline.tsx` — メインタイムライン
- `src/app/_components/MixedTimeline.tsx` — 投稿+通知混合
- `src/app/_components/NotificationTimeline.tsx` — 通知専用
- `src/app/_components/TabbedTimeline.tsx` — タブグループ
- `src/app/_components/TimelineEditPanel.tsx` — 設定パネル
- `src/app/_components/TimelineManagement.tsx` — 管理 UI

### Hooks
- `src/util/hooks/useTimelineData.ts` — ディスパッチャー
- `src/util/hooks/useFilteredTimeline.ts` — フィルタ付きクエリ
- `src/util/hooks/useFilteredTagTimeline.ts` — タグタイムライン
- `src/util/hooks/useCustomQueryTimeline.ts` — Advanced Query
- `src/util/hooks/useNotifications.ts` — 通知タイムライン
- `src/util/hooks/useTimeline.ts` — 旧 API（deprecated）

### Provider
- `src/util/provider/TimelineProvider.tsx` — 設定管理
- `src/util/provider/HomeTimelineProvider.tsx` — 後方互換
- `src/util/provider/StreamingManagerProvider.tsx` — ストリーム管理
- `src/util/provider/StatusStoreProvider.tsx` — ホームストリーム

### ユーティリティ
- `src/util/db/sqlite/queries/statusFilter.ts` — SQL フィルタ生成
- `src/util/hooks/timelineFilterBuilder.ts` — バレルエクスポート（deprecated → statusFilter へ）
- `src/util/timelineFetcher.ts` — API フェッチ
- `src/util/timelineRefresh.ts` — リフレッシュ通知
- `src/util/timelineConfigValidator.ts` — 設定バリデーション
- `src/util/timelineDisplayName.ts` — 表示名生成
- `src/util/queryBuilder.ts` — クエリ構築・パース・エイリアス検出
- `src/util/explainQueryPlan.ts` — EXPLAIN QUERY PLAN 出力

### ストリーミング
- `src/util/streaming/deriveRequiredStreams.ts` — 必要ストリーム算出
- `src/util/streaming/streamKey.ts` — ストリームキー管理
- `src/util/streaming/streamRegistry.ts` — 接続レジストリ型
- `src/util/streaming/stopStream.ts` — 安全な停止・再開
- `src/util/streaming/constants.ts` — リトライ定数

### データベース
- `src/util/db/sqlite/schema/` — スキーマ定義（テーブル別ファイル）
- `src/util/db/sqlite/schema/version.ts` — SemVer バージョン管理
- `src/util/db/sqlite/migrations/` — マイグレーション（v2.0.0, v2.0.1）
- `src/util/db/sqlite/queries/` — クエリ構築（statusBatch, statusFetch, statusFilter, statusMapper, statusSelect, statusCustomQuery）
- `src/util/db/sqlite/stores/statusStore.ts` — 投稿ストア（マイクロバッチ書き込み）
- `src/util/db/sqlite/stores/statusReadStore.ts` — 読み取り専用ストア
- `src/util/db/sqlite/notificationStore.ts` — 通知ストア
- `src/util/db/sqlite/connection.ts` — 接続管理 + subscribe/notifyChange（ChangeHint 付き）
- `src/util/db/sqlite/worker/` — Worker 実装（handlers/ サブディレクトリ付き）
- `src/util/db/sqlite/workerClient.ts` — Worker RPC クライアント
- `src/util/db/dbQueue.ts` — 優先度キューシステム（timeline/other 二重キュー）
