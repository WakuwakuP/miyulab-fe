# Phase 8: タイムライン再構築

## 概要

現在の `statuses_timeline_types`（投稿 × タイムライン種別の単純マッピング）を、
設計ドキュメントの `timelines` + `timeline_items` + `feed_events` 体系に移行する。
これにより、アカウントごとの論理タイムライン管理、投稿・通知の混合表示、
sort_key による柔軟な並び順制御が可能になる。

## スキーマバージョン

v13 → **v14**

## 前提

- Phase 1〜7 が全て完了していること
- 特に以下が必須:
  - Phase 1: INTEGER PK (post_id / notification_id が INTEGER)
  - Phase 2: servers / channel_kinds / timeline_item_kinds マスターテーブル
  - Phase 3: local_accounts テーブル
  - Phase 7: JSON blob 廃止済み

## 現状の問題

### `statuses_timeline_types` の課題

- 「どのタイムラインに属するか」を `timelineType TEXT` で管理（home / local / federated 等）
- アカウント情報が紐付いていないため、マルチアカウント時に区別できない
- 通知と投稿が完全に別テーブル管理で、混合タイムラインの表示に追加ロジックが必要
- 並び順制御が投稿の `createdAt` に依存し、任意のソートキーを指定できない

### `timeline_entries`（マテリアライズドビュー）の課題

- Phase 6 で廃止済みの前提だが、残存している場合はこのフェーズで完全除去

## ゴール

- `timelines` テーブルでアカウントごとの論理タイムラインを定義
- `timeline_items` テーブルで投稿・通知のタイムライン帰属を管理
- `feed_events` テーブルで投稿・通知の統合時系列表示を実現
- `statuses_timeline_types` テーブルを廃止

---

## 手順

### Step 1: 新テーブル作成

#### 1.1 `timelines` テーブル

```sql
CREATE TABLE timelines (
  timeline_id        INTEGER NOT NULL PRIMARY KEY,
  local_account_id   INTEGER NOT NULL REFERENCES local_accounts(local_account_id),
  channel_kind_id    INTEGER NOT NULL REFERENCES channel_kinds(channel_kind_id),
  server_id          INTEGER NULL     REFERENCES servers(server_id),
  hashtag_id         INTEGER NULL     REFERENCES hashtags(hashtag_id),
  conversation_id    INTEGER NULL     REFERENCES conversations(conversation_id),
  name               TEXT    NOT NULL,
  created_at         TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_timelines_identity
  ON timelines(local_account_id, channel_kind_id, server_id, hashtag_id, conversation_id, name);
```

> `conversation_id` FK は Phase 9 で `conversations` テーブルが作成されるまで
> 外部キー制約なしで NULL カラムとして定義しておく。

#### 1.2 `timeline_items` テーブル

```sql
CREATE TABLE timeline_items (
  timeline_item_id      INTEGER NOT NULL PRIMARY KEY,
  timeline_id           INTEGER NOT NULL REFERENCES timelines(timeline_id) ON DELETE CASCADE,
  timeline_item_kind_id INTEGER NOT NULL REFERENCES timeline_item_kinds(timeline_item_kind_id),
  post_id               INTEGER NULL     REFERENCES posts(post_id) ON DELETE CASCADE,
  notification_id       INTEGER NULL     REFERENCES notifications(notification_id) ON DELETE CASCADE,
  sort_key              TEXT    NOT NULL,
  inserted_at           TEXT    NOT NULL
);

CREATE INDEX idx_timeline_items_timeline_sort
  ON timeline_items(timeline_id, sort_key DESC);

CREATE UNIQUE INDEX idx_timeline_items_identity
  ON timeline_items(timeline_id, timeline_item_kind_id, post_id, notification_id, sort_key);
```

#### 1.3 `feed_events` テーブル

```sql
CREATE TABLE feed_events (
  feed_event_id      INTEGER NOT NULL PRIMARY KEY,
  local_account_id   INTEGER NOT NULL REFERENCES local_accounts(local_account_id),
  event_type         TEXT    NOT NULL,
  post_id            INTEGER NULL     REFERENCES posts(post_id) ON DELETE CASCADE,
  notification_id    INTEGER NULL     REFERENCES notifications(notification_id) ON DELETE CASCADE,
  actor_profile_id   INTEGER NULL     REFERENCES profiles(profile_id),
  occurred_at        TEXT    NOT NULL,
  sort_key           TEXT    NOT NULL
);

CREATE INDEX idx_feed_events_account_sort
  ON feed_events(local_account_id, sort_key DESC);
```

### Step 2: データ移行

#### 2.1 `timelines` の初期生成

既存の `statuses_timeline_types` + `statuses_backends` から、
アカウント × タイムライン種別の組み合わせを抽出して `timelines` に登録する。

```sql
-- local_accounts と channel_kinds の突合で timelines を生成
INSERT INTO timelines (local_account_id, channel_kind_id, server_id, hashtag_id, conversation_id, name, created_at, updated_at)
SELECT DISTINCT
  la.local_account_id,
  ck.channel_kind_id,
  CASE WHEN stt.timelineType IN ('local', 'federated') THEN sv.server_id ELSE NULL END,
  NULL,  -- hashtag_id は別途 tag 系で設定
  NULL,  -- conversation_id は Phase 9
  stt.timelineType,
  datetime('now'),
  datetime('now')
FROM statuses_timeline_types stt
JOIN statuses_backends sb ON sb.compositeKey = stt.compositeKey
JOIN local_accounts la ON la.backend_url = sb.backendUrl
JOIN channel_kinds ck ON ck.code = stt.timelineType
LEFT JOIN servers sv ON sv.host = replace(replace(sb.backendUrl, 'https://', ''), 'http://', '')
GROUP BY la.local_account_id, ck.channel_kind_id, sv.server_id;
```

> **注**: 上記 SQL は概念的なもの。実際にはアプリケーション層で
> `statuses_timeline_types` のユニークな組み合わせをクエリし、
> ループで `timelines` に INSERT する方が安全。

#### 2.2 `timeline_items` へのデータ移行

```sql
INSERT INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, notification_id, sort_key, inserted_at)
SELECT
  t.timeline_id,
  (SELECT timeline_item_kind_id FROM timeline_item_kinds WHERE code = 'post'),
  stt.post_id,   -- Phase 1 で INTEGER PK に移行済み
  NULL,
  p.created_at,  -- sort_key として投稿日時を使用
  datetime('now')
FROM statuses_timeline_types stt
JOIN posts p ON p.post_id = stt.post_id
JOIN statuses_backends sb ON sb.compositeKey = stt.compositeKey
JOIN local_accounts la ON la.backend_url = sb.backendUrl
JOIN channel_kinds ck ON ck.code = stt.timelineType
JOIN timelines t ON t.local_account_id = la.local_account_id
                AND t.channel_kind_id = ck.channel_kind_id;
```

#### 2.3 `feed_events` 初期データ

既存の投稿・通知データから feed_events を生成する。

```sql
-- 投稿イベント
INSERT INTO feed_events (local_account_id, event_type, post_id, notification_id, actor_profile_id, occurred_at, sort_key)
SELECT
  la.local_account_id,
  'post',
  p.post_id,
  NULL,
  p.author_profile_id,
  p.created_at,
  p.created_at
FROM posts p
JOIN timeline_items ti ON ti.post_id = p.post_id
JOIN timelines t ON t.timeline_id = ti.timeline_id
JOIN local_accounts la ON la.local_account_id = t.local_account_id
GROUP BY la.local_account_id, p.post_id;

-- 通知イベント
INSERT INTO feed_events (local_account_id, event_type, post_id, notification_id, actor_profile_id, occurred_at, sort_key)
SELECT
  n.local_account_id,
  'notification',
  n.post_id,
  n.notification_id,
  n.actor_profile_id,
  n.created_at,
  n.created_at
FROM notifications n;
```

### Step 3: アプリケーション層の改修

#### 3.1 タイムライン帰属の書き込み変更

**対象ファイル**: `src/util/db/sqlite/worker/workerStatusStore.ts`

現在の `handleUpsertStatus` / `handleBulkUpsertStatuses` で行っている
`statuses_timeline_types` への INSERT を `timeline_items` への INSERT に変更する。

```typescript
// Before: statuses_timeline_types への直接 INSERT
// INSERT INTO statuses_timeline_types (compositeKey, timelineType) VALUES (?, ?)

// After: timelines のルックアップ → timeline_items へ INSERT
// 1. timeline_id の取得（なければ timelines に INSERT）
// 2. timeline_items に INSERT
```

**主な変更点**:

- タイムライン種別の文字列ではなく `timeline_id` (INTEGER FK) で帰属を管理
- 帰属登録時に `local_account_id` を必ず紐付け
- `sort_key` の指定（デフォルトは `created_at`）

#### 3.2 タイムライン読み取りの変更

**対象ファイル**: `src/util/db/sqlite/statusStore.ts`

- `getStatusesByTimelineType()` → `timeline_items JOIN timelines` ベースのクエリに変更
- `getStatusesByTag()` → `timeline_items` でタグ用タイムラインをフィルタ、
  または従来通り `post_hashtags` JOIN で取得
- 混合タイムラインは `feed_events` から取得

```typescript
// 例: タイムラインタイプでの取得
async function getStatusesByTimeline(
  timelineId: number,
  limit: number,
  beforeSortKey?: string,
): Promise<StoredPost[]> {
  const sql = `
    SELECT p.*
    FROM timeline_items ti
    JOIN posts p ON p.post_id = ti.post_id
    WHERE ti.timeline_id = ?
      AND ti.timeline_item_kind_id = (
        SELECT timeline_item_kind_id FROM timeline_item_kinds WHERE code = 'post'
      )
      ${beforeSortKey ? "AND ti.sort_key < ?" : ""}
    ORDER BY ti.sort_key DESC
    LIMIT ?
  `;
  // ...
}
```

#### 3.3 クエリビルダーの更新

**対象ファイル**: `src/util/queryBuilder.ts`

- `buildTimelineTypeCondition()` を `timeline_id` ベースに変更
- テーブルエイリアスの更新:
  - `stt` (statuses_timeline_types) → `ti` (timeline_items)
  - `detectReferencedAliases()` の更新
- `buildQueryFromConfig()` の WHERE 句生成で `ti.timeline_id = ?` を使用

#### 3.4 feed_events の書き込み

**新規ロジック**:

- 投稿受信時に `feed_events` に `event_type = 'post'` イベントを INSERT
- 通知受信時に `feed_events` に `event_type = 'notification'` イベントを INSERT
- 混合タイムライン（`MixedTimeline.tsx`）は `feed_events` テーブルから取得

### Step 4: 旧テーブルの廃止

```sql
-- statuses_timeline_types を削除
DROP TABLE IF EXISTS statuses_timeline_types;

-- timeline_entries が残存していれば削除（Phase 6 で廃止済みのはず）
DROP TABLE IF EXISTS timeline_entries;
DROP TABLE IF EXISTS tag_entries;
```

### Step 5: クリーンアップ処理の更新

**対象ファイル**: `src/util/db/sqlite/worker/workerCleanup.ts`

- `handleEnforceMaxLength()` を `timeline_items` ベースに変更
- タイムラインごとの最大件数管理: `timeline_items` の `sort_key` 順に古いものから削除
- `feed_events` も同様に古いイベントを定期的にパージ

```typescript
// タイムラインごとの件数制限
async function enforceTimelineMaxLength(timelineId: number, maxItems: number) {
  const sql = `
    DELETE FROM timeline_items
    WHERE timeline_item_id IN (
      SELECT timeline_item_id
      FROM timeline_items
      WHERE timeline_id = ?
      ORDER BY sort_key DESC
      LIMIT -1 OFFSET ?
    )
  `;
  await execAsync(sql, [timelineId, maxItems]);
}
```

---

## インデックス戦略

| テーブル         | インデックス                                                                               | 用途                          |
| ---------------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| `timelines`      | `(local_account_id, channel_kind_id, server_id, hashtag_id, conversation_id, name)` UNIQUE | タイムライン特定              |
| `timeline_items` | `(timeline_id, sort_key DESC)`                                                             | タイムライン表示（主クエリ）  |
| `timeline_items` | `(post_id)`                                                                                | 投稿削除時の CASCADE / 逆引き |
| `timeline_items` | `(notification_id)`                                                                        | 通知削除時の CASCADE / 逆引き |
| `feed_events`    | `(local_account_id, sort_key DESC)`                                                        | フィード表示（主クエリ）      |
| `feed_events`    | `(post_id)`                                                                                | 投稿削除時の逆引き            |

## UI コンポーネントへの影響

| ファイル                   | 変更内容                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `UnifiedTimeline.tsx`      | `timeline_id` ベースのフェッチに変更                                      |
| `MixedTimeline.tsx`        | `feed_events` からの統合フェッチに変更                                    |
| `NotificationTimeline.tsx` | `feed_events` の通知フィルタに変更（または従来通り `notifications` 直接） |
| `TabbedTimeline.tsx`       | `timelines` テーブルからタブ一覧を取得                                    |
| `TimelineManagement.tsx`   | `timelines` の CRUD に対応                                                |
| `TimelineEditPanel.tsx`    | `timelines` レコードの更新 UI                                             |

## テスト観点

- [ ] 既存データの `statuses_timeline_types` → `timelines` + `timeline_items` への変換が正しく行われること
- [ ] `timeline_items` の `sort_key` 順でのページネーションが正しく動作すること
- [ ] `feed_events` で投稿と通知が正しい時系列で混合表示されること
- [ ] 投稿・通知の削除が `timeline_items` / `feed_events` に CASCADE すること
- [ ] タイムラインごとの件数制限（cleanup）が正しく動作すること
- [ ] マルチアカウント環境で `local_account_id` によるタイムライン分離が機能すること
- [ ] クエリビルダーが新テーブル構造に対応した SQL を生成すること

## ロールバック手順

1. `statuses_timeline_types` テーブルは `timeline_items` からのデータ復元用に
   移行完了後もしばらく保持する（`_deprecated_statuses_timeline_types` にリネーム）
2. 問題発生時は `PRAGMA user_version` を v13 に戻し、
   リネームしたテーブルを元の名前に復元
3. アプリケーション層の読み書き先を旧テーブルに切り戻す
