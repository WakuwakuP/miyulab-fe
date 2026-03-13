# DB マイグレーション計画 概要

## 目的

現在の v6 スキーマを `docs/db-table-design.md` の設計に段階的に移行し、
正規化・パフォーマンス・拡張性を改善する。

## 現状の課題

| #   | 課題                                                 | 影響度 |
| --- | ---------------------------------------------------- | ------ |
| 1   | `compositeKey` (TEXT PK) によるインデックス肥大化    | 高     |
| 2   | JSON blob への二重保持（正規化カラム + json カラム） | 高     |
| 3   | プロフィール・サーバー情報の未正規化                 | 高     |
| 4   | マテリアライズドビューの書き込みオーバーヘッド       | 高     |
| 5   | 列挙値が TEXT のまま（マスターテーブル未導入）       | 中     |
| 6   | エンゲージメント（ふぁぼ・ブースト等）が JSON 依存   | 中     |
| 7   | メディア・投票・OGP カードが正規化されていない       | 中     |
| 8   | 投稿統計が投稿本体テーブルに同居                     | 低     |

## フェーズ構成

依存関係を考慮し、以下の順序で段階的に移行する。

```
Phase 1: INTEGER PK 移行
    ↓
Phase 2: サーバー・マスターテーブル導入
    ↓
Phase 3: プロフィール正規化
    ↓
Phase 4: 投稿データ正規化（メディア・ハッシュタグ・統計）
    ↓
Phase 5: エンゲージメント統一
    ↓
Phase 6: マテリアライズドビュー見直し
    ↓
Phase 7: JSON blob 廃止
    ↓
Phase 8: タイムライン再構築
    ↓
Phase 9: 将来拡張（フォロー・DM・取り込み管理等）
```

## 依存関係図

```
Phase 1 (INTEGER PK)
  └─→ Phase 2 (servers / masters)
        └─→ Phase 3 (profiles)
              └─→ Phase 5 (engagements) ← requires local_accounts
  └─→ Phase 4 (post normalization)
        └─→ Phase 7 (JSON elimination) ← requires Phase 3〜6
  └─→ Phase 6 (materialized view refactor)
        └─→ Phase 8 (timeline restructure)
Phase 9 (future) ← requires Phase 1〜3
```

## 各フェーズの対応ドキュメント

| フェーズ | ファイル                                                             | 概要                                |
| -------- | -------------------------------------------------------------------- | ----------------------------------- |
| Phase 1  | [01-integer-pk.md](01-integer-pk.md)                                 | compositeKey → INTEGER PK 移行      |
| Phase 2  | [02-servers-and-masters.md](02-servers-and-masters.md)               | servers / マスターテーブル導入      |
| Phase 3  | [03-profiles.md](03-profiles.md)                                     | profiles / local_accounts 正規化    |
| Phase 4  | [04-post-normalization.md](04-post-normalization.md)                 | post_media / post_stats 等の分離    |
| Phase 5  | [05-engagements.md](05-engagements.md)                               | post_engagements 統一テーブル       |
| Phase 6  | [06-materialized-view-refactor.md](06-materialized-view-refactor.md) | マテビュー廃止 → インデックス最適化 |
| Phase 7  | [07-json-elimination.md](07-json-elimination.md)                     | json カラム廃止                     |
| Phase 8  | [08-timeline-restructure.md](08-timeline-restructure.md)             | timelines / timeline_items 再構築   |
| Phase 9  | [09-future-extensions.md](09-future-extensions.md)                   | フォロー・DM・取り込み管理等        |

## 共通ルール

### スキーマバージョン管理

- `PRAGMA user_version` を引き続き使用（現在 v6）
- 各フェーズで 1 バージョン加算（Phase 1 → v7, Phase 2 → v8, ...）
- `ensureSchema()` に新バージョンのマイグレーション関数を追加

### マイグレーション原則

1. **後方互換**: 各フェーズは独立してデプロイ可能にする
2. **データ保全**: マイグレーション中のデータロスを防ぐためバックフィルを必ず実施
3. **ロールバック不可前提**: SQLite にはトランザクション DDL の制限があるため、十分なテストを事前実施
4. **段階的移行**: アプリケーション層は旧・新両方のカラムを読めるよう一時的に互換コードを入れる

### テスト方針

- 各フェーズのマイグレーション関数に対するユニットテスト
- バックフィル後のデータ整合性検証
- 既存クエリ API の回帰テスト
- `yarn build` / `yarn check` の通過確認

### ファイル影響範囲（共通）

```
src/util/db/sqlite/
  schema.ts              — スキーマ定義・マイグレーション
  shared.ts              — 共有ユーティリティ
  statusStore.ts         — Status 読み取り API
  notificationStore.ts   — Notification 読み取り API
  worker/
    workerStatusStore.ts — Status 書き込みハンドラ
    workerNotificationStore.ts — Notification 書き込みハンドラ
    workerCleanup.ts     — クリーンアップ処理
src/util/queryBuilder.ts — クエリビルダー
```
