# Phase 9: 将来拡張

## 概要

Phase 1〜8 で投稿・通知・タイムラインの正規化が完了した後、
設計ドキュメントに定義されている残りのテーブルを段階的に追加する。
これらは現行実装に直接の対応物がなく、新機能として導入するテーブル群である。

## スキーマバージョン

v14 → **v15+**（サブフェーズごとにバージョンを上げる）

## 前提

- Phase 1〜8 が全て完了していること
- 特に以下が必須:
  - Phase 2: servers / マスターテーブル
  - Phase 3: profiles / local_accounts
  - Phase 4: hashtags / posts

## 対象テーブル一覧

| サブフェーズ | テーブル                                                      | 設計ドキュメント節 | 優先度 |
| ------------ | ------------------------------------------------------------- | ------------------ | ------ |
| 9a           | `follows`                                                     | 6.2.6              | 高     |
| 9b           | `post_aliases`                                                | 6.3.2              | 高     |
| 9c           | `custom_emojis`, `post_custom_emojis`                         | 6.3.7, 6.3.8       | 中     |
| 9d           | `polls`, `poll_options`                                       | 6.3.9, 6.3.10      | 中     |
| 9e           | `conversations`, `conversation_members`, `conversation_posts` | 6.5.3〜6.5.5       | 中     |
| 9f           | `tag_history`                                                 | 6.5.6              | 低     |
| 9g           | `ingest_channels`, `ingest_checkpoints`                       | 6.6.1, 6.6.2       | 低     |

---

## 9a: フォロー関係 (`follows`)

### 目的

ローカルアカウントごとのフォロー関係を明示的に保持し、
ホームタイムライン再構成やフォロー中ユーザーの投稿フィルタに活用する。

### スキーマ

```sql
CREATE TABLE follows (
  follow_id          INTEGER NOT NULL PRIMARY KEY,
  local_account_id   INTEGER NOT NULL REFERENCES local_accounts(local_account_id),
  target_profile_id  INTEGER NOT NULL REFERENCES profiles(profile_id),
  created_at         TEXT    NULL,
  fetched_at         TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_follows_identity
  ON follows(local_account_id, target_profile_id);

CREATE INDEX idx_follows_target
  ON follows(target_profile_id);
```

### データ取得

- Mastodon / Misskey API の `/api/v1/accounts/:id/following` からバッチ取得
- ストリーミングでのフォロー・アンフォローイベントで差分更新

### アプリケーション変更

- `workerStatusStore.ts`: フォローリスト同期のコマンドハンドラ追加
- ホームタイムラインのフィルタ条件に `follows` JOIN を追加可能に

---

## 9b: 投稿エイリアス (`post_aliases`)

### 目的

1 つの投稿 (canonical post) を複数サーバー経由で受信した場合に、
各サーバーの status ID と canonical post の対応を管理する。
重複投稿の排除を URI ベースから ID マッピングベースに移行する。

### スキーマ

```sql
CREATE TABLE post_aliases (
  post_alias_id       INTEGER NOT NULL PRIMARY KEY,
  server_id           INTEGER NOT NULL REFERENCES servers(server_id),
  remote_status_id    TEXT    NOT NULL,
  post_id             INTEGER NOT NULL REFERENCES posts(post_id),
  fetched_at          TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_post_aliases_identity
  ON post_aliases(server_id, remote_status_id);

CREATE INDEX idx_post_aliases_post
  ON post_aliases(post_id);
```

### データ移行

既存の `posts` テーブルから初期データを生成:

```sql
INSERT INTO post_aliases (server_id, remote_status_id, post_id, fetched_at)
SELECT
  sv.server_id,
  p.remote_id,        -- 現在の compositeKey から抽出した statusId 部分
  p.post_id,
  datetime('now')
FROM posts p
JOIN servers sv ON sv.server_id = p.origin_server_id;
```

### アプリケーション変更

- `workerStatusStore.ts` の重複チェック:
  現在の `object_uri` ベース → `post_aliases` の `(server_id, remote_status_id)` ルックアップに変更
- 受信時に常に `post_aliases` に INSERT/ON CONFLICT IGNORE

---

## 9c: カスタム絵文字 (`custom_emojis`, `post_custom_emojis`)

### 目的

サーバーごとのカスタム絵文字をマスター管理し、
投稿内で使用された絵文字を多対多で紐付ける。

### スキーマ

```sql
CREATE TABLE custom_emojis (
  emoji_id           INTEGER NOT NULL PRIMARY KEY,
  server_id          INTEGER NOT NULL REFERENCES servers(server_id),
  shortcode          TEXT    NOT NULL,
  domain             TEXT    NULL,
  image_url          TEXT    NOT NULL,
  static_url         TEXT    NULL,
  visible_in_picker  INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX idx_custom_emojis_identity
  ON custom_emojis(server_id, shortcode);

CREATE TABLE post_custom_emojis (
  post_id        INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id),
  usage_context  TEXT    NOT NULL,
  PRIMARY KEY (post_id, emoji_id, usage_context)
);
```

### データ取得元

- `Entity.Status.emojis` 配列（投稿受信時に抽出）
- 各サーバーのカスタム絵文字 API（`/api/v1/custom_emojis`）

### アプリケーション変更

- 投稿保存時に `emojis` 配列を `custom_emojis` に UPSERT し、
  `post_custom_emojis` に紐付けを INSERT
- 絵文字ピッカー（`EmojiReactionPicker.tsx`）のデータソースを
  `custom_emojis` テーブルに変更可能

---

## 9d: 投票 (`polls`, `poll_options`)

### 目的

投稿に紐づく投票データを正規化し、投票状態の更新を効率化する。

### スキーマ

```sql
CREATE TABLE polls (
  poll_id        INTEGER NOT NULL PRIMARY KEY,
  post_id        INTEGER NOT NULL UNIQUE REFERENCES posts(post_id) ON DELETE CASCADE,
  expires_at     TEXT    NULL,
  multiple       INTEGER NOT NULL DEFAULT 0,
  votes_count    INTEGER NULL,
  voters_count   INTEGER NULL
);

CREATE TABLE poll_options (
  poll_option_id  INTEGER NOT NULL PRIMARY KEY,
  poll_id         INTEGER NOT NULL REFERENCES polls(poll_id) ON DELETE CASCADE,
  option_index    INTEGER NOT NULL,
  title           TEXT    NOT NULL,
  votes_count     INTEGER NULL
);

CREATE UNIQUE INDEX idx_poll_options_identity
  ON poll_options(poll_id, option_index);
```

### データ取得元

- `Entity.Status.poll` オブジェクト（投稿受信時に抽出）

### アプリケーション変更

- 投稿保存時に `poll` が存在する場合は `polls` + `poll_options` に INSERT
- `Entity.Status` 組み立て時に `polls` + `poll_options` から復元

---

## 9e: DM 会話 (`conversations`, `conversation_members`, `conversation_posts`)

### 目的

DM 会話スレッドを構造化して管理し、会話一覧・未読管理を実現する。

### スキーマ

```sql
CREATE TABLE conversations (
  conversation_id          INTEGER NOT NULL PRIMARY KEY,
  local_account_id         INTEGER NOT NULL REFERENCES local_accounts(local_account_id),
  server_id                INTEGER NOT NULL REFERENCES servers(server_id),
  remote_conversation_id   TEXT    NOT NULL,
  last_post_id             INTEGER NULL     REFERENCES posts(post_id),
  unread_count             INTEGER NOT NULL DEFAULT 0,
  updated_at               TEXT    NOT NULL
);

CREATE UNIQUE INDEX idx_conversations_identity
  ON conversations(local_account_id, remote_conversation_id);

CREATE TABLE conversation_members (
  conversation_id  INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  profile_id       INTEGER NOT NULL REFERENCES profiles(profile_id),
  PRIMARY KEY (conversation_id, profile_id)
);

CREATE TABLE conversation_posts (
  conversation_id  INTEGER NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  post_id          INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, post_id)
);
```

### データ取得元

- Mastodon API の `/api/v1/conversations` エンドポイント
- ストリーミングの `conversation` イベント

### アプリケーション変更

- 会話タイムライン（`channel_kinds.code = 'conversation'`）と連携
- Phase 8 の `timelines` テーブルの `conversation_id` FK を有効化

---

## 9f: タグ履歴 (`tag_history`)

### 目的

アカウント単位でのハッシュタグ利用履歴を管理し、
タグのオートコンプリートや利用頻度順の表示に活用する。

### スキーマ

```sql
CREATE TABLE tag_history (
  local_account_id  INTEGER NOT NULL REFERENCES local_accounts(local_account_id),
  hashtag_id        INTEGER NOT NULL REFERENCES hashtags(hashtag_id),
  last_used_at      TEXT    NOT NULL,
  use_count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (local_account_id, hashtag_id)
);
```

### アプリケーション変更

- `HashtagHistory.tsx` のデータソースを `tag_history` テーブルに変更
- タグ付き投稿の受信時に `tag_history` を UPSERT (use_count + 1)

---

## 9g: 取り込み管理 (`ingest_channels`, `ingest_checkpoints`)

### 目的

ストリーミングおよび REST API からのデータ取り込みチャネルと、
差分取得位置を管理する。現在はインメモリまたは
アプリケーション変数で管理している取り込み状態を永続化する。

### スキーマ

```sql
CREATE TABLE ingest_channels (
  channel_id         INTEGER NOT NULL PRIMARY KEY,
  server_id          INTEGER NOT NULL REFERENCES servers(server_id),
  local_account_id   INTEGER NULL     REFERENCES local_accounts(local_account_id),
  channel_kind_id    INTEGER NOT NULL REFERENCES channel_kinds(channel_kind_id),
  hashtag_id         INTEGER NULL     REFERENCES hashtags(hashtag_id),
  conversation_id    INTEGER NULL     REFERENCES conversations(conversation_id)
);

CREATE UNIQUE INDEX idx_ingest_channels_identity
  ON ingest_channels(server_id, local_account_id, channel_kind_id, hashtag_id, conversation_id);

CREATE TABLE ingest_checkpoints (
  channel_id         INTEGER NOT NULL PRIMARY KEY REFERENCES ingest_channels(channel_id),
  newest_remote_id   TEXT    NULL,
  oldest_remote_id   TEXT    NULL,
  last_event_at      TEXT    NULL,
  last_backfill_at   TEXT    NULL
);
```

### アプリケーション変更

- `src/util/streaming/` 配下のストリーミング管理ロジックで
  チャネルの状態を `ingest_channels` + `ingest_checkpoints` に永続化
- REST ポーリング時の `since_id` / `max_id` を `ingest_checkpoints` から取得
- アプリ再起動時に `ingest_checkpoints` から取り込み位置を復元

---

## 実施順序の考え方

サブフェーズは独立性が高いため、必要に応じて並行実施可能。
ただし以下の依存関係に注意:

```
9a (follows)         ← 独立。profiles / local_accounts のみ依存
9b (post_aliases)    ← 独立。servers / posts のみ依存
9c (custom_emojis)   ← 独立。servers / posts のみ依存
9d (polls)           ← 独立。posts のみ依存
9e (conversations)   ← 9d より先でも可。posts / profiles / servers 依存
9f (tag_history)     ← Phase 4 の hashtags 依存
9g (ingest_channels) ← 9e (conversations) が先に必要（conversation_id FK）
```

## テスト観点

### 共通

- [ ] 各テーブルの CREATE / INSERT / SELECT が正常に動作すること
- [ ] UNIQUE 制約が重複挿入を正しくブロックすること
- [ ] FK の CASCADE DELETE が正しく伝搬すること

### サブフェーズ固有

- [ ] 9a: フォローリストの同期（追加・削除）が正しく動作すること
- [ ] 9b: 同じ投稿を異なるサーバー経由で受信した場合に `post_aliases` で名寄せできること
- [ ] 9c: 絵文字のサーバー間での同一 shortcode/異なる画像が区別されること
- [ ] 9d: 投票選択肢の追加・投票数更新が正しく反映されること
- [ ] 9e: 会話の未読カウント更新と会話メンバーの増減が正しく動作すること
- [ ] 9f: タグ利用回数のインクリメントと最終利用日時の更新が正しいこと
- [ ] 9g: アプリ再起動後に取り込み位置が維持されること

## ロールバック手順

各サブフェーズは独立したテーブル追加のため、
問題発生時は該当テーブルを DROP し、`PRAGMA user_version` を前バージョンに戻す。
既存テーブルへの破壊的変更がないため、ロールバックリスクは低い。
