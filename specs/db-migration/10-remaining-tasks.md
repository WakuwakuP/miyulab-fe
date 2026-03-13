# 未実施タスク一覧

> Phase 1〜8 検証（2026-03-13 実施）で判明した残作業と、Phase 9 の詳細ステップ。

---

## A. 既存 Phase の残作業（後日対応マーク分）

### A-1. Phase 3: `statusStore.ts` — profiles JOIN 追加 ✅

- **対象**: `src/util/db/sqlite/statusStore.ts`
- **現状**: ~~`rowToStoredStatus()` が `account.display_name` / `account.avatar` 等を直接カラムから構築しているが、`profiles` テーブルとの JOIN がない~~ **実装済み** — `STATUS_BASE_JOINS` に `LEFT JOIN profiles pr` が既に存在
- **作業内容**:
  - ~~`STATUS_BASE_JOINS` に `LEFT JOIN profiles pr ON s.author_profile_id = pr.profile_id` を追加~~ 既存
  - ~~`STATUS_SELECT` に `pr.display_name`, `pr.avatar`, `pr.header` 等を追加~~ 既存
  - ~~`rowToStoredStatus()` で profiles カラムから account 情報を優先構築~~ 既存
- **優先度**: 中（カスタム絵文字対応 A-4/9c と連動）

### A-2. Phase 5: `statusStore.ts` — ブックマーク一覧クエリ追加 ✅

- **対象**: `src/util/db/sqlite/statusStore.ts`
- **現状**: ~~`post_engagements` テーブルに bookmark データは保存されているが、ブックマーク一覧を取得するクエリが未実装~~ **実装済み**
- **作業内容**:
  - ~~`getBookmarkedStatuses()` 関数を追加~~ 完了
  - ~~`post_engagements pe` JOIN + `engagement_types et` JOIN で `et.code = 'bookmark'` フィルタ~~ 完了
- **優先度**: 低

### A-3. Phase 5: `queryBuilder.ts` — `pe` エイリアス追加 ✅

- **対象**: `src/util/queryBuilder.ts`, `src/util/db/sqlite/statusStore.ts`, `src/util/explainQueryPlan.ts`, `src/util/hooks/useCustomQueryTimeline.ts`
- **現状**: ~~カスタムクエリで `pe.engagement_type_id` 等を使用できない~~ **実装済み**
- **作業内容**:
  - ~~`ALIAS_TO_TABLE` に `'pe': 'post_engagements'` を追加~~ 完了
  - ~~クエリバリデーションで `pe.*` カラムを許可~~ 完了
  - `QUERY_COMPLETIONS` に `pe` エイリアスとカラム追加 — 完了
  - `detectReferencedAliases` に `pe` 追加 — 完了
  - カスタムクエリの JOIN 構築に `pe` 追加 — 完了
- **優先度**: 低

### A-4. Phase 7: `QueryEditor.tsx` — JSON パス補完のデッドコード削除 ✅

- **対象**: `src/app/_components/QueryEditor.tsx`
- **現状**: ~~JSON パスマッチング正規表現（268〜282行）とコメント（31行）が残存。~~ **削除済み**
- **作業内容**:
  - ~~31行目のコメント `$.` を入力すると json_extract パスの補完候補を表示する。` を削除~~ 完了
  - ~~268〜282行の `jsonPathMatch` ブロックを削除~~ 完了
- **優先度**: 低（コード衛生）

---

## B. Phase 9: 将来拡張 — 詳細ステップ

### 9a: フォロー関係 (`follows`) — 優先度: 高

#### Step 1: スキーマ

- [ ] `schema.ts` — `follows` テーブル作成を `migrateV14toV15()` に追加
- [ ] インデックス: `idx_follows_identity(local_account_id, target_profile_id)`, `idx_follows_target(target_profile_id)`

#### Step 2: データ取得

- [ ] `workerStatusStore.ts` — `handleSyncFollows` コマンドハンドラ追加
- [ ] megalodon の `/api/v1/accounts/:id/following` エンドポイント呼び出し
- [ ] ページネーション対応（Link ヘッダ or max_id）

#### Step 3: ストリーミング連携

- [ ] `StreamingManager` — フォロー/アンフォローイベントで差分更新

#### Step 4: アプリケーション層

- [ ] ホームタイムラインのフィルタ条件に `follows` JOIN を追加可能にする

#### Step 5: 検証

- [ ] `yarn build` / `yarn check` 成功
- [ ] フォロー同期の動作確認

---

### 9b: 投稿エイリアス (`post_aliases`) — 優先度: 高

#### Step 1: スキーマ

- [ ] `schema.ts` — `post_aliases` テーブル作成
- [ ] インデックス: `idx_post_aliases_identity(server_id, remote_status_id)`, `idx_post_aliases_post(post_id)`

#### Step 2: データ移行

- [ ] 既存の `posts_backends` から初期データを `post_aliases` に INSERT

#### Step 3: アプリケーション層

- [ ] `workerStatusStore.ts` — 重複チェックを `object_uri` ベースから `post_aliases(server_id, remote_status_id)` ルックアップに変更
- [ ] 受信時に常に `post_aliases` に INSERT/ON CONFLICT IGNORE

#### Step 4: 検証

- [ ] `yarn build` / `yarn check` 成功
- [ ] マルチサーバー受信時の重複排除確認

---

### 9c: カスタム絵文字 (`custom_emojis`, `post_custom_emojis`) — 優先度: 高 ✅

> ~~**現在カスタム絵文字の表示が完全に壊れている。**~~ **修正済み。** Phase 7 で JSON blob を廃止した際に欠落していた `status.emojis` / `account.emojis` の保存・復元処理を実装した。

#### 背景: カスタム絵文字の2種類

1. **投稿内カスタム絵文字**: `Entity.Status.emojis` — 投稿本文の `:shortcode:` を画像に置換
2. **表示名カスタム絵文字**: `Entity.Account.emojis` — アカウント表示名の `:shortcode:` を画像に置換

#### 現在の破損状態

- `workerStatusStore.ts`: `handleUpsertStatus()` で `status.emojis` / `status.account.emojis` を抽出していない
- `statusStore.ts`: `rowToStoredStatus()` が `emojis: []` をハードコードで返している（83行, 111行）
- UI コンポーネント（`Status.tsx`, `UserInfo.tsx`, `AccountDetail.tsx`, `Notification.tsx`, `MainPanel.tsx`）は `emojis` 配列をループして `:shortcode:` → `<img>` 置換を行うが、配列が常に空のため置換されない

#### Step 1: スキーマ

- [x] `schema.ts` — `custom_emojis` テーブル作成（Phase 4 で定義済み — `migrateV9toV10` に存在確認済み）
- [x] `post_custom_emojis` テーブル作成（`usage_context` カラムで投稿/表示名を区別） — `migrateV15toV16` で追加

```sql
CREATE TABLE post_custom_emojis (
  post_id        INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id),
  usage_context  TEXT    NOT NULL,  -- 'status' | 'account'
  PRIMARY KEY (post_id, emoji_id, usage_context)
);
```

#### Step 2: 保存処理 — 投稿のカスタム絵文字

- [x] `shared.ts` — `ensureCustomEmoji(db, serverId, emoji)` ヘルパー追加
  - `custom_emojis` に UPSERT し emoji_id を返す
- [x] `shared.ts` — `syncPostCustomEmojis(db, postId, serverId, statusEmojis, accountEmojis)` ヘルパー追加
- [x] `workerStatusStore.ts` — `handleUpsertStatus()` / `handleBulkUpsertStatuses()` に `syncPostCustomEmojis` 呼び出しを追加

#### Step 3: 保存処理 — 表示名のカスタム絵文字

- [x] `workerStatusStore.ts` — `syncPostCustomEmojis` が `status.account.emojis` も `usage_context = 'account'` で保存
- [ ] `workerNotificationStore.ts` — 通知の actor にも同様の処理を追加（未実装・通知投稿の絵文字は読み取り側で対応済み）

#### Step 4: 読み取りクエリ

- [x] `statusStore.ts` — `STATUS_SELECT` に絵文字サブクエリを追加
  - 投稿絵文字: `post_custom_emojis pce JOIN custom_emojis ce` で `usage_context = 'status'` をJSON配列として集約
  - 表示名絵文字: 同上で `usage_context = 'account'` をJSON配列として集約
- [x] `rowToStoredStatus()` の `emojis: []` ハードコードを削除し、`parseEmojis()` で `Entity.Emoji[]` を構築

#### Step 5: 通知の絵文字読み取り

- [x] `notificationStore.ts` — `NOTIFICATION_SELECT` に関連投稿の絵文字サブクエリを追加（`rp_status_emojis_json`, `rp_account_emojis_json`）
- [x] `rowToStoredNotification()` で `status.emojis` / `status.account.emojis` を `parseEmojis()` で構築

#### Step 6: 既存データのバックフィル（オプション）

- [ ] マイグレーション関数で既存の投稿に対して絵文字を遡及的に取得するか検討
  - 新規受信分から対応し、既存データは再取得時に自然復旧とする方針でも可

#### Step 7: 検証

- [x] `yarn build` / `yarn check` 成功
- [ ] 投稿本文内のカスタム絵文字 `:shortcode:` が画像に置換される（要動作確認）
- [ ] アカウント表示名のカスタム絵文字が画像に置換される（要動作確認）
- [ ] 通知内の actor 表示名の絵文字が置換される（要動作確認）

---

### 9d: 投票 (`polls`, `poll_options`) — 優先度: 中

> Phase 4 (v10) でテーブル定義とバックフィルが実装済みだが、読み取りクエリでの復元状況を確認する必要がある。

#### Step 1: 現状確認

- [ ] `rowToStoredStatus()` で `poll` オブジェクトが正しく復元されているか確認
- [ ] `workerStatusStore.ts` で投票データが `polls` / `poll_options` に INSERT されているか確認

#### Step 2: 読み取りクエリ（必要な場合）

- [ ] `STATUS_SELECT` に `polls` + `poll_options` サブクエリを追加
- [ ] `rowToStoredStatus()` で `Entity.Poll` を構築

#### Step 3: 投票アクション

- [ ] 投票送信後の `poll_options.votes_count` 更新処理

#### Step 4: 検証

- [ ] `yarn build` / `yarn check` 成功
- [ ] 投票付き投稿が正しく表示される
- [ ] 投票の送信・更新が反映される

---

### 9e: DM 会話 — 優先度: 中

#### Step 1: スキーマ

- [ ] `conversations`, `conversation_members`, `conversation_posts` テーブル作成

#### Step 2: データ取得

- [ ] megalodon の `/api/v1/conversations` エンドポイント呼び出し
- [ ] ストリーミングの `conversation` イベント受信

#### Step 3: アプリケーション層

- [ ] 会話タイムライン表示（`channel_kinds.code = 'conversation'` 連携）
- [ ] 未読管理

#### Step 4: 検証

- [ ] `yarn build` / `yarn check` 成功

---

### 9f: タグ履歴 (`tag_history`) — 優先度: 低

#### Step 1: スキーマ

- [ ] `tag_history` テーブル作成

#### Step 2: データ投入

- [ ] タグ付き投稿の受信時に `tag_history` を UPSERT (`use_count + 1`)

#### Step 3: アプリケーション層

- [ ] `HashtagHistory.tsx` のデータソースを `tag_history` テーブルに変更

#### Step 4: 検証

- [ ] `yarn build` / `yarn check` 成功

---

### 9g: 取り込み管理 (`ingest_channels`, `ingest_checkpoints`) — 優先度: 低

#### Step 1: スキーマ

- [ ] `ingest_channels`, `ingest_checkpoints` テーブル作成

#### Step 2: アプリケーション層

- [ ] 現在インメモリで管理しているストリーミング/REST の取り込み状態を `ingest_checkpoints` に永続化
- [ ] `StreamingManager` の接続状態を `ingest_channels` で管理

#### Step 3: 検証

- [ ] `yarn build` / `yarn check` 成功

---

## 優先順位まとめ

| 優先度        | タスク                        | 理由                             | 状態       |
| ------------- | ----------------------------- | -------------------------------- | ---------- |
| ~~**🔴 最優先**~~ | 9c: カスタム絵文字            | ~~現在壊れている機能の復旧~~ 修正済み | ✅ 完了    |
| ~~高~~        | A-1: profiles JOIN            | 表示名の正規化取得、9c と連動    | ✅ 既存実装 |
| 高            | 9a: フォロー関係              | ホームTL再構成の基盤             | 未着手     |
| 高            | 9b: 投稿エイリアス            | 重複排除の改善                   | 未着手     |
| 中            | 9d: 投票                      | Phase 4 で部分実装済み、復元確認 | 未着手     |
| 中            | 9e: DM 会話                   | 新機能                           | 未着手     |
| ~~低~~        | A-2: ブックマーク一覧         | 将来機能                         | ✅ 完了    |
| ~~低~~        | A-3: pe エイリアス            | カスタムクエリ用                 | ✅ 完了    |
| ~~低~~        | A-4: QueryEditor デッドコード | コード衛生                       | ✅ 完了    |
| 低            | 9f: タグ履歴                  | 将来機能                         | 未着手     |
| 低            | 9g: 取り込み管理              | 将来機能                         | 未着手     |
