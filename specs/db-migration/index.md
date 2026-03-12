# DB マイグレーション 進捗管理

> 現行スキーマ: **v14** → 目標: **v15+**

## 全体進捗

| Phase | タイトル                                                         | バージョン | 状態      | 依存          |
| ----- | ---------------------------------------------------------------- | ---------- | --------- | ------------- |
| 1     | [INTEGER PK 移行](01-integer-pk.md)                              | v6 → v7    | ✅ 完了   | —             |
| 2     | [サーバー・マスターテーブル導入](02-servers-and-masters.md)      | v7 → v8    | ✅ 完了   | Phase 1       |
| 3     | [プロフィール正規化](03-profiles.md)                             | v8 → v9    | ✅ 完了   | Phase 2       |
| 4     | [投稿データ正規化](04-post-normalization.md)                     | v9 → v10   | ✅ 完了   | Phase 1, 2    |
| 5     | [エンゲージメント統一](05-engagements.md)                        | v10 → v11  | ✅ 完了   | Phase 2, 3, 4 |
| 6     | [マテリアライズドビュー見直し](06-materialized-view-refactor.md) | v11 → v12  | ✅ 完了   | Phase 1, 4    |
| 7     | [JSON blob 廃止](07-json-elimination.md)                         | v12 → v13  | ✅ 完了   | Phase 1〜6    |
| 8     | [タイムライン再構築](08-timeline-restructure.md)                 | v13 → v14  | ✅ 完了   | Phase 1〜7    |
| 9     | [将来拡張](09-future-extensions.md)                              | v14 → v15+ | 🔲 未着手 | Phase 1〜3    |

**凡例**: 🔲 未着手 / 🔶 進行中 / ✅ 完了

---

## Phase 1: compositeKey → INTEGER PK 移行 (v6 → v7)

- [x] Step 1: `posts_new` テーブル定義
- [x] Step 2: `statuses` → `posts_new` へデータ移行
- [x] Step 3: `compositeKey` → `post_id` マッピングテーブル作成
- [x] Step 4: 関連テーブルの移行
  - [x] `statuses_timeline_types` → `post_timeline_types`
  - [x] `statuses_belonging_tags` → `post_belonging_tags`
  - [x] `statuses_mentions` → `post_mentions`
  - [x] `statuses_backends` → `post_backends`
  - [x] `statuses_reblogs` → `post_reblogs`
- [x] Step 5: マテリアライズドビューの移行 (`timeline_entries_new`, `tag_entries_new`)
- [x] Step 6: `notifications` テーブルの移行
- [x] Step 7: 旧テーブル削除・リネーム
- [x] Step 8: インデックス再作成
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 7`, `migrateV6toV7()` 追加
  - [x] `statusStore.ts` — クエリを `post_id` ベースに書き換え
  - [x] `workerStatusStore.ts` — INSERT/UPDATE を新スキーマに変更
  - [x] `queryBuilder.ts` — テーブル名・カラム名の更新
- [x] テスト・検証
  - [x] `yarn build` 成功
  - [x] `yarn check` 成功
  - [x] 既存データの移行検証

---

## Phase 2: サーバー・マスターテーブル導入 (v7 → v8)

- [x] Step 1: マスターテーブル作成と初期データ投入
  - [x] `software_types`
  - [x] `servers`
  - [x] `visibility_types`
  - [x] `notification_types`
  - [x] `media_types`
  - [x] `engagement_types`
  - [x] `channel_kinds`
  - [x] `timeline_item_kinds`
- [x] Step 2: `servers` テーブルへの既存データ移行
- [x] Step 3: `posts` テーブルに `server_id` カラム追加・バックフィル
- [x] Step 4: `posts_backends` テーブルに `server_id` カラム追加・バックフィル
- [x] Step 5: `notifications` テーブルに `server_id` カラム追加・バックフィル
- [x] Step 6: `posts` テーブルに `visibility_id` カラム追加・バックフィル
- [x] Step 7: `notifications` テーブルに `notification_type_id` カラム追加・バックフィル
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 8`, `migrateV7toV8()` 追加
  - [x] `shared.ts` — `ensureServer(db, backendUrl)` ヘルパー追加
  - [x] `workerStatusStore.ts` — upsert 時に `servers` への UPSERT + `visibility_id` 設定
  - [x] `workerNotificationStore.ts` — upsert 時に `servers` への UPSERT + `notification_type_id` 設定
- [x] テスト・検証
  - [x] `yarn build` 成功
  - [x] `yarn check` 成功

---

## Phase 3: プロフィール正規化 (v8 → v9)

- [x] Step 1: テーブル作成 (`profiles`, `profile_aliases`, `profile_fields`, `local_accounts`)
- [x] Step 2: 既存データからプロフィールを抽出 (JSON → `profiles`)
- [x] Step 3: `profile_aliases` の生成
- [x] Step 4: `posts` に `author_profile_id` カラム追加・バックフィル
- [x] Step 5: `notifications` に `actor_profile_id` カラム追加・バックフィル
- [x] Step 6: `home_server_id` の補完
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 9`, `migrateV8toV9()` 追加
  - [x] `shared.ts` — `ensureProfile(db, account)` ヘルパー追加
  - [x] `workerStatusStore.ts` — upsert 時に profiles UPSERT 追加
  - [x] `workerNotificationStore.ts` — 同上
  - [ ] `statusStore.ts` — クエリに profiles JOIN 追加（将来の表示名取得用、後日対応）
- [x] テスト・検証

---

## Phase 4: 投稿データ正規化 (v9 → v10)

- [x] Step 1: テーブル作成
  - [x] `post_media`
  - [x] `hashtags` / `post_hashtags`
  - [x] `post_stats`
  - [x] `custom_emojis`
  - [x] `polls` / `poll_options`
  - [x] `link_cards` / `post_links`
- [x] Step 2: `post_media` のバックフィル (JSON → `post_media`)
- [x] Step 3: `hashtags` / `post_hashtags` のバックフィル
- [x] Step 4: `post_stats` のバックフィル
- [x] Step 5: `polls` / `poll_options` のバックフィル
- [x] Step 6: `link_cards` / `post_links` のバックフィル
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 10`, `migrateV9toV10()` 追加
  - [x] `workerStatusStore.ts` — 投稿保存時にサブテーブルへ分離保存
- [x] テスト・検証

---

## Phase 5: エンゲージメント統一 (v10 → v11)

- [x] Step 1: `post_engagements` テーブル作成
- [x] Step 2: 既存データのバックフィル (JSON フラグ → `post_engagements`)
  - [x] favourite
  - [x] reblog
  - [x] bookmark
- [x] Step 3: `handleUpdateStatusAction` の書き換え
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 11`, `migrateV10toV11()` 追加
  - [x] `workerStatusStore.ts` — `toggleEngagement()` ヘルパー追加
  - [ ] `statusStore.ts` — ブックマーク一覧クエリ追加（後日対応）
  - [ ] `queryBuilder.ts` — `pe` エイリアス追加（後日対応）
- [x] テスト・検証

---

## Phase 6: マテリアライズドビュー見直し (v11 → v12)

- [x] Step 1: 現在のタイムラインクエリの `timeline_entries` / `tag_entries` 参照を確認
- [x] Step 2: 代替インデックスの作成
- [x] Step 3: トリガーの削除 (7つ)
- [x] Step 4: `timeline_entries` / `tag_entries` テーブル削除
- [x] Step 5: クエリの書き換え (JOIN 方式へ)
- [x] Step 6: EXPLAIN QUERY PLAN による検証（代替インデックス作成で対応）
- [x] アプリケーション層の変更
  - [x] `schema.ts` — `SCHEMA_VERSION = 12`, `migrateV11toV12()` 追加
  - [x] `useFilteredTimeline.ts` — JOIN 方式に書き換え
  - [x] `useFilteredTagTimeline.ts` — JOIN 方式に書き換え
  - [x] `timelineFilterBuilder.ts` / `queryBuilder.ts` — コメント更新
- [x] テスト・検証
  - [x] `yarn build` / `yarn check` 成功

---

## Phase 7: JSON blob 廃止 (v12 → v13)

- [x] Step 1: `posts` に不足カラム追加 (`content_html`, `spoiler_text`, `is_local_only`, `edited_at`, `canonical_url`)
- [x] Step 2: 新カラムへのバックフィル (`json_extract` → 正規化カラム)
- [x] Step 3: `notifications` に不足カラム追加 (`related_post_id`)
- [x] Step 4: `json` カラム廃止 — テーブル再構築 (`posts_v13`, `notifications_v13`)
- [x] Step 5: テーブル置き換え (DROP → RENAME)
- [x] Step 6: インデックス再作成
- [x] アプリケーション層の変更（大規模）
  - [x] `schema.ts` — `SCHEMA_VERSION = 13`, `migrateV12toV13()` 追加
  - [x] `statusStore.ts` — `rowToStoredStatus()` で正規化カラムから Entity を構築、JSON 関連補完機能を削除、`ALIAS_TO_TABLE` / `COLUMN_TABLE_OVERRIDE` の v13 対応
  - [x] `notificationStore.ts` — `rowToStoredNotification()` で正規化カラムから Entity を構築、`NOTIFICATION_SELECT` / `NOTIFICATION_BASE_JOINS` エクスポート
  - [x] `workerStatusStore.ts` — 全ハンドラを v13 スキーマ (`origin_server_id`, `author_profile_id`, `visibility_id`, `content_html` 等) に変更
  - [x] `workerNotificationStore.ts` — `server_id` / `notification_type_id` / `actor_profile_id` ベースに変更
  - [x] `workerMigration.ts` — v13 スキーマに合わせた INSERT/UPDATE 書き換え (ensureServer/ensureProfile/resolveVisibilityId 使用)
  - [x] `shared.ts` — `extractNotificationColumns` 削除（未使用化）
  - [x] `queryBuilder.ts` — `upgradeQueryToV2` で `sb.backendUrl` 正規化、`parseQueryToConfig` で `backend_url|backendUrl` 両方マッチ
  - [x] `QueryEditor.tsx` — JSON パス補完 / `json_extract` 値補完を全削除
  - [x] `useTimeline.ts`, `useFilteredTimeline.ts`, `useFilteredTagTimeline.ts` — `STATUS_SELECT` / `STATUS_BASE_JOINS` ベースに書き換え
  - [x] `useNotifications.ts` — `NOTIFICATION_SELECT` / `NOTIFICATION_BASE_JOINS` ベースに書き換え
  - [x] `useCustomQueryTimeline.ts` — `STATUS_COMPAT_FROM` / `NOTIF_COMPAT_FROM` サブクエリ + カラム名リライトチェーン
  - [x] `explainQueryPlan.ts` — 全6ビルダーを v13 JOIN 方式に書き換え
  - [x] `timelineFilterBuilder.ts` — `sb.backend_url` → `pb.backendUrl` リライトチェーン対応
  - [x] `index.ts` — 不要 re-export 削除
- [x] テスト・検証
  - [x] `yarn build` 成功
  - [x] `yarn check` 成功

---

## Phase 8: タイムライン再構築 (v13 → v14)

- [x] Step 1: 新テーブル作成
  - [x] `timelines` (server_id, channel_kind_id, tag)
  - [x] `timeline_items` (timeline_id, timeline_item_kind_id, post_id, notification_id, sort_key, inserted_at)
  - [x] `feed_events` (server_id, event_type, post_id, notification_id, actor_profile_id, occurred_at, sort_key)
  - [x] `channel_kinds` に 'public' エントリー追加
- [x] Step 2: データ移行
  - [x] `posts_timeline_types` → `timelines` + `timeline_items` へのデータ移行
  - [x] タグタイムライン（`posts_belonging_tags`）→ `timelines` + `timeline_items`
  - [x] `posts_timeline_types` テーブル DROP
- [x] Step 3: アプリケーション層の改修（大規模）
  - [x] `schema.ts` — `SCHEMA_VERSION = 14`, `createSchemaV14()`, `migrateV13toV14()` 追加、`ensureSchema` 全14バージョン対応
  - [x] `shared.ts` — `resolveChannelKindId()`, `resolvePostItemKindId()`, `ensureTimeline()` ヘルパー追加
  - [x] `workerStatusStore.ts` — 4関数を `ensureTimeline + timeline_items INSERT/DELETE` に書き換え
  - [x] `workerMigration.ts` — `ensureTimeline + timeline_items INSERT` に書き換え
  - [x] `statusStore.ts` — `STATUS_SELECT` の timelineTypes サブクエリを `timeline_items+timelines+channel_kinds` JOIN に変更、`ALIAS_TO_TABLE['stt']` 更新
  - [x] `useTimeline.ts` — JOIN を `timeline_items+timelines+channel_kinds` に変更
  - [x] `useFilteredTimeline.ts` — 同上
  - [x] `useCustomQueryTimeline.ts` — `STT_COMPAT` サブクエリ定数追加（`stt.timelineType` 後方互換）
  - [x] `explainQueryPlan.ts` — 3つのビルダー関数を新 JOIN 方式に変更
  - [x] `DatabaseStatsPanel.tsx` — `TABLE_NAMES` を `timeline_items`, `timelines` に変更
  - [x] `UnifiedTimeline.tsx` — DB フォールバッククエリを `status_id` 取得方式に簡略化
  - [x] `workerCleanup.ts` — `timelines` テーブルイテレーション + `timeline_items` ベースのクリーンアップに書き換え
  - [x] `queryBuilder.ts` — 変更不要（`STT_COMPAT` で `stt.timelineType` 後方互換）
- [x] テスト・検証
  - [x] `yarn build` 成功
  - [x] `yarn check` 成功

---

## Phase 9: 将来拡張 (v14 → v15+)

- [ ] 9a: フォロー関係 (`follows`) — 優先度: 高
- [ ] 9b: 投稿エイリアス (`post_aliases`) — 優先度: 高
- [ ] 9c: カスタム絵文字 (`custom_emojis`, `post_custom_emojis`) — 優先度: 中
- [ ] 9d: 投票 (`polls`, `poll_options`) — 優先度: 中
- [ ] 9e: DM 会話 (`conversations`, `conversation_members`, `conversation_posts`) — 優先度: 中
- [ ] 9f: タグ履歴 (`tag_history`) — 優先度: 低
- [ ] 9g: 取り込み管理 (`ingest_channels`, `ingest_checkpoints`) — 優先度: 低

---

## 依存関係図

```
Phase 1 (INTEGER PK)
  ├─→ Phase 2 (servers / masters)
  │     └─→ Phase 3 (profiles)
  │           └─→ Phase 5 (engagements) ← requires local_accounts
  ├─→ Phase 4 (post normalization)
  │     └─→ Phase 7 (JSON elimination) ← requires Phase 3〜6
  └─→ Phase 6 (materialized view refactor)
        └─→ Phase 8 (timeline restructure)
Phase 9 (future) ← requires Phase 1〜3
```

---

## 更新履歴

| 日付       | 内容                          |
| ---------- | ----------------------------- |
| 2026-03-12 | 進捗管理ドキュメント作成      |
| 2026-03-12 | Phase 1 完了を反映（現行 v7） |
| 2026-03-12 | Phase 2 完了を反映（現行 v8） |
