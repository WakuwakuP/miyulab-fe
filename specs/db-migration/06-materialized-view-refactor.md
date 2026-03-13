# Phase 6: マテリアライズドビュー見直し

## 概要

v6 で導入した `timeline_entries` / `tag_entries` マテリアライズドビューと
7 つの自動同期トリガーを廃止し、適切なインデックスで置き換える。

設計書の方針:

> 「本体正規化を崩さずに高速化したい場合は、キャッシュ列よりもまず補助テーブルとインデックスで対応する」

## スキーマバージョン

v11 → **v12**

## 前提

- Phase 1（INTEGER PK）が完了していること
- Phase 4（post_hashtags）が完了していること

## 現状の問題

### ストレージの無駄

`timeline_entries` / `tag_entries` は `posts` の正規化カラムを完全にコピーしている。
1 投稿が 3 タイムライン × 2 バックエンドに属する場合、6 行の冗長コピーが発生する。

### 書き込みオーバーヘッド

7 つのトリガーが以下のタイミングで発火:

| トリガー               | 発火条件              | 処理                           |
| ---------------------- | --------------------- | ------------------------------ |
| `trg_mv_stt_insert`    | timeline_types INSERT | → timeline_entries に追加      |
| `trg_mv_stt_delete`    | timeline_types DELETE | → timeline_entries から削除    |
| `trg_mv_sbt_insert`    | belonging_tags INSERT | → tag_entries に追加           |
| `trg_mv_sbt_delete`    | belonging_tags DELETE | → tag_entries から削除         |
| `trg_mv_sb_insert`     | backends INSERT       | → 両テーブルに追加             |
| `trg_mv_sb_delete`     | backends DELETE       | → 両テーブルから削除           |
| `trg_mv_status_update` | statuses UPDATE       | → 両テーブルのフィルタ列を同期 |

bulk insert 時にこれらが全投稿ごとに発火し、書き込み性能を低下させる。

### 設計書との乖離

設計書は `timeline_items(timeline_id, sort_key DESC)` + インデックスで
タイムライン帰属を管理する方針。現在のマテビューはその中間状態。

## 手順

### Step 1: 現在のタイムラインクエリの確認

現在 `timeline_entries` を使っているクエリを特定する。
主に `getStatusesByTimelineType` と `getStatusesByTag` で
v6 導入後もマテビューを直接参照していない場合、影響は限定的。

> **確認ポイント**: `statusStore.ts` のクエリが `timeline_entries` / `tag_entries` を
> 直接参照しているかを確認する。参照していなければ、テーブル削除のリスクは低い。

### Step 2: 代替インデックスの作成

```sql
-- posts_timeline_types の高速化（Phase 1 で既に作成済みの場合はスキップ）
CREATE INDEX IF NOT EXISTS idx_ptt_type_post_created
  ON posts_timeline_types(timelineType, post_id);

-- posts と組み合わせた複合クエリ用
-- タイムラインフィルタの主要パターンをカバー
CREATE INDEX IF NOT EXISTS idx_posts_created_media
  ON posts(created_at_ms DESC, has_media);

CREATE INDEX IF NOT EXISTS idx_posts_created_visibility
  ON posts(created_at_ms DESC, visibility);

CREATE INDEX IF NOT EXISTS idx_posts_created_reblog
  ON posts(created_at_ms DESC, is_reblog);

-- post_hashtags の高速化
CREATE INDEX IF NOT EXISTS idx_ph_hashtag_post
  ON post_hashtags(hashtag_id, post_id);

-- posts_backends の高速化（バックエンドフィルタ用）
CREATE INDEX IF NOT EXISTS idx_pb_backend_post
  ON posts_backends(backendUrl, post_id);
```

### Step 3: トリガーの削除

```sql
DROP TRIGGER IF EXISTS trg_mv_stt_insert;
DROP TRIGGER IF EXISTS trg_mv_stt_delete;
DROP TRIGGER IF EXISTS trg_mv_sbt_insert;
DROP TRIGGER IF EXISTS trg_mv_sbt_delete;
DROP TRIGGER IF EXISTS trg_mv_sb_insert;
DROP TRIGGER IF EXISTS trg_mv_sb_delete;
DROP TRIGGER IF EXISTS trg_mv_status_update;
```

### Step 4: マテビューテーブルの削除

```sql
DROP TABLE IF EXISTS timeline_entries;
DROP TABLE IF EXISTS tag_entries;
```

### Step 5: クエリの書き換え（必要な場合）

マテビューを直接参照していたクエリがある場合、
`posts` + `posts_timeline_types` + `posts_backends` の JOIN に書き換える。

書き換え前（マテビュー使用時）:

```sql
SELECT te.compositeKey, ...
FROM timeline_entries te
WHERE te.timelineType = ?
  AND te.backendUrl IN (...)
  AND te.has_media = 1
ORDER BY te.created_at_ms DESC
LIMIT ?;
```

書き換え後（JOIN 方式）:

```sql
SELECT p.post_id, ...
FROM posts p
INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
WHERE ptt.timelineType = ?
  AND pb.backendUrl IN (...)
  AND p.has_media = 1
GROUP BY p.post_id
ORDER BY p.created_at_ms DESC
LIMIT ?;
```

### Step 6: EXPLAIN QUERY PLAN による検証

マイグレーション後に主要クエリのクエリプランを確認し、
SCAN ではなく INDEX が使われていることを検証する。

```sql
EXPLAIN QUERY PLAN
SELECT p.post_id, p.json
FROM posts p
INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
WHERE ptt.timelineType = 'home'
  AND pb.backendUrl = 'https://example.com'
GROUP BY p.post_id
ORDER BY p.created_at_ms DESC
LIMIT 50;
```

期待するプラン:

- `posts_timeline_types` → `idx_ptt_type_post_created` を使用
- `posts_backends` → `idx_pb_backend_post` を使用
- `posts` → PK ルックアップ

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル                      | 変更内容                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `schema.ts`                   | `SCHEMA_VERSION = 12`、`migrateV11toV12()` 追加、`createMaterializedView*` 関数群を削除 |
| `statusStore.ts`              | timeline_entries / tag_entries の参照があれば JOIN 方式に書き換え                       |
| `worker/workerStatusStore.ts` | マテビュートリガーへの依存コードがあれば削除                                            |

### 削除対象のコード

`schema.ts` 内の以下の関数をマイグレーション完了後に不要化:

- `createMaterializedViewTables()`
- `createMaterializedViewTriggers()`
- `createCustomQueryIndexes()`
- `backfillMaterializedViewsV6()`

> **注意**: 既存マイグレーションパス（v5 → v6）は残す必要がある。
> 新規インストール時の `createSchemaV12()` から上記関数の呼び出しを除外する。

## テスト項目

- [ ] トリガーが全て削除されている
- [ ] `timeline_entries` / `tag_entries` テーブルが存在しない
- [ ] `getStatusesByTimelineType` が正常に動作する
- [ ] `getStatusesByTag` が正常に動作する
- [ ] `getStatusesByCustomQuery` が正常に動作する
- [ ] bulk insert の性能が改善されている（トリガー削除効果の確認）
- [ ] EXPLAIN QUERY PLAN でインデックスが使用されている
- [ ] `yarn build` / `yarn check` が通る

## パフォーマンス検証

### 期待される改善

| 操作                 | Before（v6）                      | After（v12）        | 理由         |
| -------------------- | --------------------------------- | ------------------- | ------------ |
| 単一投稿 upsert      | 7 トリガー発火                    | トリガーなし        | トリガー廃止 |
| bulk 100 件 upsert   | 700 トリガー発火                  | なし                | 同上         |
| タイムライン読み取り | 単一テーブルスキャン              | JOIN + インデックス | 同等〜微増   |
| ストレージ           | posts × TL数 × backend数 の冗長行 | posts 1 行のみ      | 大幅削減     |

### 読み取り性能が劣化した場合

JOIN 方式で読み取り性能が許容範囲外に低下した場合は、
Phase 8（タイムライン再構築）で `timeline_items` テーブルを導入し、
`sort_key` 付きの軽量な帰属テーブルで補う（フィルタ列のコピーはしない）。
