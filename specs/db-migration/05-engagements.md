# Phase 5: エンゲージメント統一管理

## 概要

お気に入り・ブースト・ブックマーク・絵文字リアクションを `post_engagements` テーブルに統一し、
JSON blob の書き換えに依存していたアクション管理を正規化する。

## スキーマバージョン

v10 → **v11**

## 前提

- Phase 2（`engagement_types` マスター）が完了していること
- Phase 3（`local_accounts`）が完了していること
- Phase 4（`custom_emojis`）が完了していること

## 現状の問題

- `handleUpdateStatusAction` で JSON を丸ごとパースし、フラグを書き換えて再格納
- reblog 元投稿・関連投稿の JSON も連鎖的に書き換える高コスト処理
- 「ブックマークした投稿一覧」のクエリが直接実行できない
- リアクション（カスタム絵文字）のアカウント単位管理ができない

## 導入するテーブル

### 5-1. `post_engagements`

```sql
CREATE TABLE post_engagements (
  post_engagement_id  INTEGER PRIMARY KEY,
  local_account_id    INTEGER NOT NULL,
  post_id             INTEGER NOT NULL,
  engagement_type_id  INTEGER NOT NULL,
  emoji_id            INTEGER,
  created_at          TEXT NOT NULL,
  FOREIGN KEY (local_account_id) REFERENCES local_accounts(local_account_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (engagement_type_id) REFERENCES engagement_types(engagement_type_id),
  FOREIGN KEY (emoji_id) REFERENCES custom_emojis(emoji_id)
);

-- favourite / reblog / bookmark は (account, post, type) で一意
-- reaction は同じ投稿に複数絵文字が可能なため emoji_id も含む
CREATE UNIQUE INDEX idx_pe_unique ON post_engagements(
  local_account_id, post_id, engagement_type_id
) WHERE emoji_id IS NULL;

CREATE UNIQUE INDEX idx_pe_unique_reaction ON post_engagements(
  local_account_id, post_id, engagement_type_id, emoji_id
) WHERE emoji_id IS NOT NULL;

CREATE INDEX idx_pe_account_type ON post_engagements(
  local_account_id, engagement_type_id, created_at DESC
);
CREATE INDEX idx_pe_post ON post_engagements(post_id);
```

## 手順

### Step 1: テーブル作成

上記テーブルとインデックスを作成する。

### Step 2: 既存データのバックフィル

```sql
-- JSON 内の favourited / reblogged / bookmarked フラグからバックフィル
-- local_account_id の特定は posts_backends の backendUrl + local_accounts で行う

-- favourite
INSERT OR IGNORE INTO post_engagements (
  local_account_id, post_id, engagement_type_id, created_at
)
SELECT
  la.local_account_id,
  p.post_id,
  (SELECT engagement_type_id FROM engagement_types WHERE code = 'favourite'),
  datetime('now')
FROM posts p
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
INNER JOIN servers sv ON pb.server_id = sv.server_id
INNER JOIN local_accounts la ON la.server_id = sv.server_id
WHERE json_extract(p.json, '$.favourited') = 1;

-- reblog
INSERT OR IGNORE INTO post_engagements (
  local_account_id, post_id, engagement_type_id, created_at
)
SELECT
  la.local_account_id,
  p.post_id,
  (SELECT engagement_type_id FROM engagement_types WHERE code = 'reblog'),
  datetime('now')
FROM posts p
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
INNER JOIN servers sv ON pb.server_id = sv.server_id
INNER JOIN local_accounts la ON la.server_id = sv.server_id
WHERE json_extract(p.json, '$.reblogged') = 1;

-- bookmark
INSERT OR IGNORE INTO post_engagements (
  local_account_id, post_id, engagement_type_id, created_at
)
SELECT
  la.local_account_id,
  p.post_id,
  (SELECT engagement_type_id FROM engagement_types WHERE code = 'bookmark'),
  datetime('now')
FROM posts p
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
INNER JOIN servers sv ON pb.server_id = sv.server_id
INNER JOIN local_accounts la ON la.server_id = sv.server_id
WHERE json_extract(p.json, '$.bookmarked') = 1;
```

> **注意**: local_accounts にデータが未投入の場合、バックフィルは空になる。
> その場合は local_accounts の投入後に再実行する必要がある。

### Step 3: handleUpdateStatusAction の書き換え

現在の実装:

```
1. JSON パース → フラグ書き換え → JSON 再格納
2. reblog 元投稿の JSON も同様に書き換え
3. statuses_reblogs 経由で関連投稿の JSON も書き換え
```

新しい実装:

```
1. post_engagements に INSERT / DELETE
2. JSON の書き換えは引き続き行う（Phase 7 で廃止するまでの互換維持）
```

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル               | 変更内容                                                  |
| ---------------------- | --------------------------------------------------------- |
| `schema.ts`            | `SCHEMA_VERSION = 11`、`migrateV10toV11()` 追加           |
| `workerStatusStore.ts` | `handleUpdateStatusAction` に post_engagements 操作を追加 |
| `statusStore.ts`       | ブックマーク一覧クエリの追加                              |
| `queryBuilder.ts`      | `pe` エイリアスの追加（post_engagements）                 |

### エンゲージメント操作のヘルパー

```typescript
// workerStatusStore.ts に追加
function toggleEngagement(
  db: DbExec,
  localAccountId: number,
  postId: number,
  engagementCode: string,
  value: boolean,
  emojiId?: number,
): void {
  if (value) {
    db.exec(
      `INSERT OR IGNORE INTO post_engagements (
        local_account_id, post_id, engagement_type_id, emoji_id, created_at
      ) VALUES (
        ?, ?,
        (SELECT engagement_type_id FROM engagement_types WHERE code = ?),
        ?, datetime('now')
      );`,
      { bind: [localAccountId, postId, engagementCode, emojiId ?? null] },
    );
  } else {
    if (emojiId != null) {
      db.exec(
        `DELETE FROM post_engagements
         WHERE local_account_id = ? AND post_id = ?
           AND engagement_type_id = (SELECT engagement_type_id FROM engagement_types WHERE code = ?)
           AND emoji_id = ?;`,
        { bind: [localAccountId, postId, engagementCode, emojiId] },
      );
    } else {
      db.exec(
        `DELETE FROM post_engagements
         WHERE local_account_id = ? AND post_id = ?
           AND engagement_type_id = (SELECT engagement_type_id FROM engagement_types WHERE code = ?)
           AND emoji_id IS NULL;`,
        { bind: [localAccountId, postId, engagementCode] },
      );
    }
  }
}
```

### 新しいクエリ例

```sql
-- ブックマーク一覧の取得
SELECT p.post_id, p.json
FROM posts p
INNER JOIN post_engagements pe ON p.post_id = pe.post_id
WHERE pe.local_account_id = ?
  AND pe.engagement_type_id = (SELECT engagement_type_id FROM engagement_types WHERE code = 'bookmark')
ORDER BY pe.created_at DESC
LIMIT ?;

-- 特定投稿のエンゲージメント状態取得
SELECT et.code, pe.emoji_id
FROM post_engagements pe
INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
WHERE pe.local_account_id = ? AND pe.post_id = ?;
```

## テスト項目

- [ ] post_engagements テーブルが正しく作成される
- [ ] 既存の favourited/reblogged/bookmarked が正しくバックフィルされる
- [ ] `toggleEngagement` で favourite の ON/OFF が正常に動作する
- [ ] `toggleEngagement` で bookmark の ON/OFF が正常に動作する
- [ ] reaction（emoji_id 付き）の追加・削除が正常に動作する
- [ ] ブックマーク一覧クエリが正しい結果を返す
- [ ] 既存の `handleUpdateStatusAction` の動作が維持される（JSON 互換）
- [ ] `yarn build` / `yarn check` が通る

## 備考

- Phase 7 で JSON 廃止後は、エンゲージメント状態の読み取りも
  `post_engagements` から行うように切り替える
- `local_account_id` の解決は、Phase 3 の `local_accounts` が実運用可能になってから
  完全に機能する。それまでは JSON フラグとの並行運用となる
