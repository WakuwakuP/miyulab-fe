# ドメイン知識ドキュメント

miyulab-fe の開発に必要なドメイン知識をまとめたドキュメント群です。
現在の実装をソースオブトゥルースとして、コードから読み取れる事実を体系的に文書化しています。

## ドキュメント一覧

| # | ドキュメント | 概要 |
|---|-------------|------|
| 01 | [Fediverseドメイン概念](./01-fediverse-concepts.md) | ActivityPub基本、7バックエンド、Megalodon、エンティティモデル、用語集 |
| 02 | [マルチアカウントアーキテクチャ](./02-multi-account.md) | アカウント分離、post_backend_ids、accountResolver、重複排除 |
| 03 | [データ層](./03-data-layer.md) | SQLite OPFS、Worker RPC、キュー管理、変更通知、DBスキーマ |
| 04 | [Query IRシステム](./04-query-ir.md) | クエリコンパイルパイプライン、ノード定義、2フェーズ戦略、FlowEditor |
| 05 | [ストリーミング](./05-streaming.md) | WebSocket管理、StreamRegistry、イベントフロー、リトライ戦略 |
| 06 | [Provider構成](./06-provider-architecture.md) | Context Providerチェーン、各Providerの責務、初期化シーケンス |
| 07 | [コンポーネント設計](./07-component-architecture.md) | _components vs _parts、タイムライン表示、投稿コンポーネント |
| 08 | [マイグレーションシステム](./08-migration-system.md) | SemVerエンコード、Migration Runner、バージョン履歴 |
| 09 | [メディアプロキシ](./09-media-proxy.md) | CORSプロキシ、セキュリティ、キャッシュ戦略 |
| 10 | [開発ワークフロー](./10-development-workflow.md) | セットアップ、コマンド、ディレクトリ構造、コミット前チェック |

## 推奨の読み順

### 初めての開発者

1. **[開発ワークフロー](./10-development-workflow.md)** — まずローカル環境を構築
2. **[Fediverseドメイン概念](./01-fediverse-concepts.md)** — Fediverseの前提知識を理解
3. **[マルチアカウント](./02-multi-account.md)** — データモデルの核心
4. **[Provider構成](./06-provider-architecture.md)** — アプリ全体の状態管理を把握
5. **[コンポーネント設計](./07-component-architecture.md)** — UI層の構造を理解

### データ層に触れる開発者

1. **[データ層](./03-data-layer.md)** — SQLite + Worker の基盤
2. **[Query IRシステム](./04-query-ir.md)** — クエリコンパイルの仕組み
3. **[マイグレーション](./08-migration-system.md)** — スキーマ変更の手順

### リアルタイム機能に触れる開発者

1. **[ストリーミング](./05-streaming.md)** — WebSocket管理の全体像
2. **[Provider構成](./06-provider-architecture.md)** — StatusStoreProvider / StreamingManagerProvider の責務

## 関連ドキュメント

- [`docs/timeline/`](../timeline/) — タイムラインシステムの詳細設計（設定、フィルタリング、コンポーネント）
- [`docs/db-table-design.md`](../db-table-design.md) — DBテーブル設計
- [`docs/knowledge/`](../knowledge/) — Next.js / ZenStack 汎用パターンガイド

## データフロー全体像

```
Fediverse Server
    │
    ├─ REST API (megalodon / MisskeyAdapter)
    │   └─ timelineFetcher → StatusStore → SQLite Worker → OPFS
    │
    └─ WebSocket Streaming (megalodon)
        └─ StreamingManager → setupStreamHandlers → StatusStore → SQLite Worker → OPFS
                                                                       │
                                                                  変更通知 (ChangeHint)
                                                                       │
                                                              useTimelineData (Query IR)
                                                                       │
                                                              React Context (Provider)
                                                                       │
                                                              UI Components (Virtuoso)
```
