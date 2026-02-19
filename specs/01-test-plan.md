# 01. テスト計画書 — SQLite OPFS Worker 移行

## 目的

インメモリ → OPFS Worker 移行の前後で **SQLite 関連の全ロジックが同一の挙動を維持している** ことを保証するため、
移行前に網羅的なテストを作成し、移行後に再実行してリグレッションがないことを確認する。

## テスト基盤

### テストランナー

プロジェクトにテストランナーが未導入のため **Vitest** を採用する。

| 項目           | 選定                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| テストランナー | Vitest 3.x                                                                             |
| アサーション   | Vitest 組み込み (`expect`)                                                             |
| SQLite 環境    | `better-sqlite3`（Node.js 向け同期 SQLite）をテスト専用 dependency として導入           |
| モック          | Vitest 組み込み (`vi.mock`, `vi.fn`)                                                  |
| カバレッジ     | `@vitest/coverage-v8`（オプション）                                                    |

### テスト用 SQLite アダプタ

ブラウザ用の `@sqlite.org/sqlite-wasm` は Node.js で動作しないため、
テスト環境では **`better-sqlite3`** を使い、`db.exec()` の互換ラッパーを作成する。

```
src/util/db/sqlite/__tests__/
├── helpers/
│   ├── testDb.ts              # better-sqlite3 を @sqlite.org/sqlite-wasm 互換でラップ
│   └── fixtures.ts            # テスト用 Entity.Status / Entity.Notification ファクトリ
├── schema.test.ts
├── statusStore.test.ts
├── notificationStore.test.ts
├── cleanup.test.ts
├── connection.test.ts
├── migration.test.ts
└── integration.test.ts
```

### testDb.ts の設計

`better-sqlite3` の API を `@sqlite.org/sqlite-wasm` の `db.exec()` 互換に変換する薄いアダプタ。

```typescript
// イメージ
import Database from 'better-sqlite3'

export function createTestDb(): DbHandle {
  const raw = new Database(':memory:')
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')

  const db = {
    exec(sql: string, opts?: { bind?: unknown[]; returnValue?: string }) {
      if (opts?.returnValue === 'resultRows') {
        const stmt = raw.prepare(sql)
        return opts.bind ? stmt.all(...opts.bind) : stmt.all()
      }
      const stmt = raw.prepare(sql)
      opts?.bind ? stmt.run(...opts.bind) : stmt.run()
    },
  }

  return { db, sqlite3: {} } as unknown as DbHandle
}
```

> **注意**: `exec` の返り値形式（配列の配列 vs オブジェクト配列）を
> `@sqlite.org/sqlite-wasm` に合わせる変換が必要。詳細は実装時に調整。

### fixtures.ts の設計

テスト用の `Entity.Status` / `Entity.Notification` を生成するファクトリ関数。

```typescript
export function createMockStatus(overrides?: Partial<Entity.Status>): Entity.Status {
  return {
    id: crypto.randomUUID(),
    uri: `https://mastodon.social/users/test/statuses/${crypto.randomUUID()}`,
    created_at: new Date().toISOString(),
    account: {
      id: '1',
      acct: 'testuser@mastodon.social',
      // ...最小限のフィールド
    },
    content: '<p>Test status</p>',
    visibility: 'public',
    sensitive: false,
    spoiler_text: '',
    media_attachments: [],
    tags: [],
    mentions: [],
    favourites_count: 0,
    reblogs_count: 0,
    replies_count: 0,
    reblog: null,
    language: 'ja',
    in_reply_to_id: null,
    ...overrides,
  } as Entity.Status
}

export function createMockNotification(
  overrides?: Partial<Entity.Notification>,
): Entity.Notification {
  return {
    id: crypto.randomUUID(),
    type: 'mention',
    created_at: new Date().toISOString(),
    account: { id: '1', acct: 'testuser@mastodon.social', /* ... */ },
    status: createMockStatus(),
    ...overrides,
  } as Entity.Notification
}
```

---

## テストケース一覧

### 1. schema.test.ts — スキーマ管理

#### 1.1 ensureSchema: フレッシュインストール

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 1.1.1 | `user_version` が 0 の DB に対して `ensureSchema` を呼ぶと v3 スキーマが作成される | `PRAGMA user_version` が 3 を返す |
| 1.1.2 | `statuses` テーブルが作成される | 全カラム (`compositeKey`, `backendUrl`, `created_at_ms`, `storedAt`, `uri`, `account_acct`, `account_id`, `visibility`, `language`, `has_media`, `media_count`, `is_reblog`, `reblog_of_id`, `reblog_of_uri`, `is_sensitive`, `has_spoiler`, `in_reply_to_id`, `favourites_count`, `reblogs_count`, `replies_count`, `json`) が存在する |
| 1.1.3 | `statuses_timeline_types` テーブルが作成される | PK は `(compositeKey, timelineType)` |
| 1.1.4 | `statuses_belonging_tags` テーブルが作成される | PK は `(compositeKey, tag)` |
| 1.1.5 | `statuses_mentions` テーブルが作成される | PK は `(compositeKey, acct)` |
| 1.1.6 | `statuses_backends` テーブルが作成される | PK は `(backendUrl, local_id)` |
| 1.1.7 | `muted_accounts` テーブルが作成される | PK は `(backendUrl, account_acct)` |
| 1.1.8 | `blocked_instances` テーブルが作成される | PK は `instance_domain` |
| 1.1.9 | `notifications` テーブルが作成される | 全カラムが存在する |
| 1.1.10 | 全インデックスが作成される | `idx_statuses_backendUrl`, `idx_statuses_backend_created`, `idx_statuses_storedAt`, `idx_statuses_account_acct`, `idx_statuses_reblog_of_id`, `idx_statuses_media_filter`, `idx_statuses_visibility_filter`, `idx_statuses_language_filter`, `idx_statuses_reblog_filter`, `idx_statuses_uri`, `idx_statuses_reblog_of_uri`, `idx_stt_type`, `idx_sbt_tag`, `idx_sm_acct`, `idx_sb_compositeKey`, `idx_sb_backendUrl`, `idx_notifications_backendUrl`, `idx_notifications_backend_created`, `idx_notifications_storedAt`, `idx_notifications_type`, `idx_notifications_status_id`, `idx_notifications_account_acct` |
| 1.1.11 | `FOREIGN KEY` が有効であることを確認 | `statuses` の行を削除すると関連テーブルの行も CASCADE 削除される |

#### 1.2 ensureSchema: マイグレーション

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 1.2.1 | `user_version = 1` → v2 → v3 マイグレーションが実行される | 新カラム・テーブルが追加され `user_version` が 3 になる |
| 1.2.2 | `user_version = 2` → v3 マイグレーションが実行される | `uri`, `reblog_of_uri` カラムと `statuses_backends` テーブルが追加される |
| 1.2.3 | `user_version = 3` → 何も実行されない | テーブル構造が変わらない |
| 1.2.4 | 冪等性: `ensureSchema` を 2 回呼んでもエラーにならない | 2 回目の呼び出しが正常に完了する |

#### 1.3 ensureSchema: エラーハンドリング

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 1.3.1 | マイグレーション中にエラーが発生した場合、ROLLBACK される | `user_version` が変更されない |

---

### 2. statusStore.test.ts — Status ストア

#### 2.1 createCompositeKey

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.1.1 | `createCompositeKey('https://mastodon.social', '123')` | `'https://mastodon.social:123'` を返す |

#### 2.2 extractStatusColumns

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.2.1 | 通常の Status から正規化カラムが正しく抽出される | `account_acct`, `visibility`, `has_media`, `is_reblog` 等が期待値と一致 |
| 2.2.2 | メディア付き Status で `has_media = 1`, `media_count` が正しい | |
| 2.2.3 | reblog の Status で `is_reblog = 1`, `reblog_of_id`, `reblog_of_uri` が正しい | |
| 2.2.4 | CW 付き Status で `has_spoiler = 1` | |
| 2.2.5 | sensitive Status で `is_sensitive = 1` | |
| 2.2.6 | language が null の Status で `language = null` | |
| 2.2.7 | in_reply_to_id 付き Status で正しく抽出される | |

#### 2.3 upsertStatus

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.3.1 | 新規 Status が INSERT される | `statuses` テーブルに 1 行追加される |
| 2.3.2 | INSERT 後に `statuses_timeline_types` に行が追加される | `(compositeKey, timelineType)` が存在する |
| 2.3.3 | INSERT 後に `statuses_backends` に行が追加される | `(compositeKey, backendUrl, local_id)` が存在する |
| 2.3.4 | tag 指定時に `statuses_belonging_tags` に行が追加される | `(compositeKey, tag)` が存在する |
| 2.3.5 | Status のタグ情報が `statuses_belonging_tags` に書き込まれる | Status.tags 内の全タグ名が登録される |
| 2.3.6 | メンション情報が `statuses_mentions` に書き込まれる | Status.mentions 内の全 acct が登録される |
| 2.3.7 | 同一 compositeKey の Status を再 upsert すると UPDATE される | `json` と正規化カラムが更新される |
| 2.3.8 | URI ベースの重複排除: 同一 URI の Status が別 backendUrl から来た場合、既存行が UPDATE される | compositeKey が再利用される |
| 2.3.9 | URI ベースの重複排除時に `statuses_backends` に新 backendUrl が追加される | 2 つの backendUrl が関連付けられる |
| 2.3.10 | `notifyChange('statuses')` が呼ばれる | subscribe したリスナーが発火する |
| 2.3.11 | トランザクション中のエラーで ROLLBACK される | データが中間状態にならない |
| 2.3.12 | `json` カラムに Entity.Status 全体が JSON シリアライズされている | `JSON.parse` で復元可能 |
| 2.3.13 | `created_at_ms` が正しいミリ秒値に変換される | `new Date(status.created_at).getTime()` と一致 |

#### 2.4 bulkUpsertStatuses

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.4.1 | 空配列を渡すと何も起きない | テーブルに行が追加されない |
| 2.4.2 | 複数 Status が一括 INSERT される | 全件が `statuses` に存在する |
| 2.4.3 | バッチ内で同一 URI が重複する場合、最初の compositeKey が再利用される | URI キャッシュが機能する |
| 2.4.4 | 既存行と URI が一致する Status は UPDATE される | |
| 2.4.5 | トランザクション中のエラーで全件 ROLLBACK される | 部分的に INSERT されない |
| 2.4.6 | `notifyChange('statuses')` が 1 回だけ呼ばれる | バッチ完了後に 1 回 |

#### 2.5 resolveCompositeKey

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.5.1 | 存在する `(backendUrl, local_id)` で compositeKey が返される | |
| 2.5.2 | 存在しない `(backendUrl, local_id)` で `null` が返される | |

#### 2.6 upsertMentions

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.6.1 | メンションが `statuses_mentions` に書き込まれる | |
| 2.6.2 | 既存メンションが削除されてから再挿入される（編集対応） | 古いメンションが消え、新しいメンションのみが残る |
| 2.6.3 | 空のメンション配列で呼ぶと既存メンションが全削除される | |

#### 2.7 removeFromTimeline

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.7.1 | 指定 timelineType が `statuses_timeline_types` から削除される | |
| 2.7.2 | tag TL 除外時に `statuses_belonging_tags` からも削除される | |
| 2.7.3 | 他のタグが残っている場合は `'tag'` タイプが復元される | |
| 2.7.4 | どのタイムラインにも属さなくなったら `statuses` から物理削除される | CASCADE で関連テーブルも削除 |
| 2.7.5 | 他のタイムラインに属している場合は物理削除されない | |

#### 2.8 handleDeleteEvent

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.8.1 | `statuses_backends` から該当 backendUrl の行が削除される | |
| 2.8.2 | 他の backendUrl がまだ参照している場合は物理削除されない | |
| 2.8.3 | どの backendUrl からも参照されなくなったら物理削除される | |
| 2.8.4 | 他 backendUrl 参照あり時、sourceTimelineType が `statuses_timeline_types` から削除される | |
| 2.8.5 | tag + 他 backendUrl 参照あり時、`statuses_belonging_tags` からも削除される | |
| 2.8.6 | 存在しない compositeKey の場合は何もしない（エラーにならない） | |
| 2.8.7 | `notifyChange('statuses')` が呼ばれる | |

#### 2.9 updateStatusAction

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.9.1 | `favourited = true` が `json` カラムに反映される | JSON パース後の `favourited` が `true` |
| 2.9.2 | `reblogged = true` が反映される | |
| 2.9.3 | `bookmarked = true` が反映される | |
| 2.9.4 | reblog 元の Status も連動更新される (`reblog_of_uri` 経由) | |
| 2.9.5 | この Status を reblog として持つ他の Status の `reblog.favourited` 等も更新される | |
| 2.9.6 | 存在しない compositeKey の場合は何もしない | |

#### 2.10 updateStatus（編集された投稿）

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.10.1 | 既存 Status の json と正規化カラムが更新される | |
| 2.10.2 | タグが再構築される（古いタグが消え新しいタグが入る） | |
| 2.10.3 | メンションが再構築される | |
| 2.10.4 | 存在しない Status の場合は何もしない | |

#### 2.11 getStatusesByTimelineType

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.11.1 | 指定 timelineType に属する Status のみ返される | |
| 2.11.2 | `backendUrls` フィルタが効く | |
| 2.11.3 | `limit` が効く | |
| 2.11.4 | `created_at_ms DESC` でソートされる | |
| 2.11.5 | 結果が `SqliteStoredStatus` 型に正しくマッピングされる | |
| 2.11.6 | 0 件の場合は空配列を返す | |

#### 2.12 getStatusesByTag

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.12.1 | 指定タグに属する Status のみ返される | |
| 2.12.2 | `backendUrls` フィルタが効く | |
| 2.12.3 | `limit` が効く | |
| 2.12.4 | `created_at_ms DESC` でソートされる | |

#### 2.13 getStatusesByCustomQuery

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.13.1 | カスタム WHERE 句でフィルタされた Status が返される | |
| 2.13.2 | `backendUrls` フィルタが AND 条件として追加される | |
| 2.13.3 | `limit` / `offset` が適用される | |
| 2.13.4 | DML/DDL 含む WHERE 句で Error が throw される | |
| 2.13.5 | SQL コメント (`--`, `/* */`) 含む WHERE 句で Error が throw される | |
| 2.13.6 | `LIMIT` / `OFFSET` 句がユーザー入力から除去される | |
| 2.13.7 | セミコロンが除去される | |
| 2.13.8 | 空文字列で全件返される (`1=1`) | |

#### 2.14 toStoredStatus

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.14.1 | `Entity.Status` が `SqliteStoredStatus` に正しく変換される | compositeKey, created_at_ms, storedAt, belongingTags, timelineTypes が設定される |

#### 2.15 validateCustomQuery

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 2.15.1 | 有効な WHERE 句でバリデーション成功 | `{ valid: true }` を返す |
| 2.15.2 | DML/DDL 含む句でバリデーション失敗 | `{ valid: false, error }` を返す |
| 2.15.3 | 構文エラーの SQL でバリデーション失敗 | SQLite エラーメッセージが含まれる |
| 2.15.4 | `?` プレースホルダー含む句でバリデーション失敗 | |

---

### 3. notificationStore.test.ts — Notification ストア

#### 3.1 extractNotificationColumns

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 3.1.1 | 通常の Notification から正規化カラムが抽出される | `notification_type`, `status_id`, `account_acct` |
| 3.1.2 | `status` なし Notification で `status_id = null` | |
| 3.1.3 | `account` なし Notification で `account_acct = ''` | |

#### 3.2 addNotification

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 3.2.1 | 新規 Notification が INSERT される | `notifications` テーブルに 1 行 |
| 3.2.2 | 同一 compositeKey で再挿入すると UPDATE される (ON CONFLICT DO UPDATE) | |
| 3.2.3 | 正規化カラムが正しく書き込まれる | |
| 3.2.4 | `json` カラムに全体が JSON 化される | |
| 3.2.5 | `notifyChange('notifications')` が呼ばれる | |

#### 3.3 bulkAddNotifications

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 3.3.1 | 空配列で何も起きない | |
| 3.3.2 | 複数 Notification が一括 INSERT される | |
| 3.3.3 | トランザクション中のエラーで全件 ROLLBACK | |
| 3.3.4 | `notifyChange('notifications')` が 1 回だけ呼ばれる | |

#### 3.4 getNotifications

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 3.4.1 | 全件取得（backendUrls 未指定） | |
| 3.4.2 | `backendUrls` フィルタで対象バックエンドのみ返される | |
| 3.4.3 | `limit` が適用される | |
| 3.4.4 | `created_at_ms DESC` でソートされる | |
| 3.4.5 | 結果が `SqliteStoredNotification` 型に正しくマッピングされる | |

#### 3.5 updateNotificationStatusAction

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 3.5.1 | Notification 内の Status の `favourited` が更新される | |
| 3.5.2 | 同一 URI の他バックエンド local_id でも通知が更新される (v3 跨サーバー対応) | |
| 3.5.3 | Status なし Notification は更新されない | |
| 3.5.4 | 該当通知がない場合は `notifyChange` が呼ばれない | |

---

### 4. cleanup.test.ts — クリーンアップ

#### 4.1 enforceMaxLength

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 4.1.1 | MAX_LENGTH 以下のデータは削除されない | |
| 4.1.2 | MAX_LENGTH を超えた分のデータが古い順に削除される | `created_at_ms ASC` で超過分を削除 |
| 4.1.3 | 他のタイムラインに属する Status は物理削除されない | `statuses_timeline_types` に他タイプが残る場合 |
| 4.1.4 | notifications も MAX_LENGTH で制限される | |
| 4.1.5 | タイムライン種類ごとに独立してカウントされる | home, local, public, tag |
| 4.1.6 | `notifyChange('statuses')` と `notifyChange('notifications')` が呼ばれる | |
| 4.1.7 | エラー時に ROLLBACK される | |

#### 4.2 startPeriodicCleanup

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 4.2.1 | 初回実行で `enforceMaxLength` が呼ばれる | |
| 4.2.2 | 返り値の関数を呼ぶと interval がクリアされる | |

---

### 5. connection.test.ts — 接続管理・イベントバス

#### 5.1 subscribe / notifyChange

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 5.1.1 | `subscribe('statuses', fn)` で登録したリスナーが `notifyChange('statuses')` で発火する | |
| 5.1.2 | `subscribe('notifications', fn)` は `notifyChange('statuses')` では発火しない | テーブル単位の分離 |
| 5.1.3 | 返り値の関数 (unsubscribe) を呼ぶとリスナーが解除される | `notifyChange` しても発火しない |
| 5.1.4 | 複数リスナーを登録すると全て発火する | |
| 5.1.5 | リスナー内で例外が発生しても他のリスナーは発火する | `console.error` が呼ばれる |
| 5.1.6 | 同一関数を 2 回 subscribe しても 1 回しか登録されない (Set) | |

#### 5.2 getSqliteDb

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 5.2.1 | 初回呼び出しで DB が初期化される | |
| 5.2.2 | 2 回目以降は同じインスタンスが返される（シングルトン） | |
| 5.2.3 | スキーマが自動適用される (`ensureSchema`) | |

---

### 6. migration.test.ts — IndexedDB → SQLite マイグレーション

> **注**: IndexedDB (Dexie) は Node.js で動作しないため、モック化する。

#### 6.1 isMigrated

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 6.1.1 | `localStorage` に `miyulab-fe:sqlite-migrated = '1'` がある場合 `true` | |
| 6.1.2 | `localStorage` に値がない場合 `false` | |
| 6.1.3 | `localStorage` が未定義の場合 `true`（SSR 環境） | |

#### 6.2 migrateFromIndexedDb

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 6.2.1 | マイグレーション済みの場合はスキップ | |
| 6.2.2 | IndexedDB が空の場合はスキップ + フラグ設定 | |
| 6.2.3 | Statuses が正しく移行される（正規化カラム含む） | |
| 6.2.4 | Notifications が正しく移行される | |
| 6.2.5 | URI ベース重複排除が移行時にも適用される | |
| 6.2.6 | `statuses_backends` に正しく登録される | |
| 6.2.7 | メンション情報が移行される | |
| 6.2.8 | バッチ処理 (500 件単位) でコミットされる | |
| 6.2.9 | マイグレーション完了後にフラグが設定される | |
| 6.2.10 | エラー発生時はフラグが設定されない（次回再試行） | |
| 6.2.11 | `notifyChange('statuses')` と `notifyChange('notifications')` が呼ばれる | |

---

### 7. integration.test.ts — 統合テスト

#### 7.1 エンドツーエンドのデータフロー

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 7.1.1 | Status を upsert → getStatusesByTimelineType で取得できる | |
| 7.1.2 | bulkUpsert → getStatusesByTag で取得できる | |
| 7.1.3 | upsert → updateStatusAction → json に反映されている | |
| 7.1.4 | upsert → handleDeleteEvent → getStatusesByTimelineType で取得できない | |
| 7.1.5 | upsert → removeFromTimeline → 他 TL には残る | |
| 7.1.6 | Notification を add → getNotifications → updateNotificationStatusAction → json に反映 | |

#### 7.2 跨サーバー重複排除 (v3)

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 7.2.1 | 同一 URI の Status を 2 つの backendUrl から upsert → `statuses` は 1 行 | |
| 7.2.2 | `statuses_backends` に 2 行登録される | |
| 7.2.3 | 片方の backendUrl で delete → `statuses` は残る（もう一方が参照） | |
| 7.2.4 | 両方の backendUrl で delete → `statuses` から物理削除 | |
| 7.2.5 | 一方で favourited → 両方の取得結果に反映される | |

#### 7.3 クリーンアップとの統合

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 7.3.1 | MAX_LENGTH + 10 件 upsert → enforceMaxLength → MAX_LENGTH 件に削減される | |
| 7.3.2 | 複数タイムラインに属する Status はクリーンアップで他 TL から消えない | |

#### 7.4 subscribe の統合

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 7.4.1 | `subscribe('statuses', fn)` → `upsertStatus` → `fn` が呼ばれる | |
| 7.4.2 | `subscribe('notifications', fn)` → `addNotification` → `fn` が呼ばれる | |
| 7.4.3 | unsubscribe 後は呼ばれない | |

#### 7.5 カスタムクエリ

| # | テストケース | 検証内容 |
|---|-------------|---------|
| 7.5.1 | `s.visibility = 'public'` で public のみ取得される | |
| 7.5.2 | `s.has_media = 1` でメディア付きのみ取得される | |
| 7.5.3 | `s.language = 'ja'` で日本語のみ取得される | |
| 7.5.4 | `s.is_reblog = 0` でブースト除外される | |
| 7.5.5 | `sm.acct = 'user@example.com'` でメンション検索できる | |
| 7.5.6 | `stt.timelineType = 'home'` で home TL のみ取得される | |
| 7.5.7 | `sbt.tag = 'mastodon'` でタグ検索できる | |
| 7.5.8 | `sb.backendUrl = 'https://example.com'` でバックエンドフィルタできる | |

---

## テスト実行手順

### セットアップ

```bash
# 1. devDependencies 追加
yarn add -D vitest better-sqlite3 @types/better-sqlite3

# 2. vitest.config.ts 作成
# → baseUrl: src を pathsAlias に変換

# 3. package.json に scripts 追加
# "test": "vitest run"
# "test:watch": "vitest"
# "test:coverage": "vitest run --coverage"
```

### vitest.config.ts の想定

```typescript
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'util': resolve(__dirname, 'src/util'),
      'types': resolve(__dirname, 'src/types'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/util/db/sqlite/__tests__/helpers/setup.ts'],
  },
})
```

### 実行

```bash
# 全テスト実行
yarn test

# 特定ファイルのみ
yarn test src/util/db/sqlite/__tests__/statusStore.test.ts

# watch モード
yarn test:watch

# カバレッジ付き
yarn test:coverage
```

---

## テスト実行タイミング

| タイミング | 目的 |
|-----------|------|
| Phase 1 完了後 | 現行挙動の確認（全テスト PASS が前提） |
| Phase 5 完了後 | initSqlite / connection 変更後のスモークテスト |
| Phase 6 完了後 | Store 層の非同期化後のリグレッション確認 |
| Phase 8 (最終) | 全テスト PASS + ビルド成功を確認 |

---

## カバレッジ目標

| モジュール | 行カバレッジ目標 |
|-----------|-----------------|
| `schema.ts` | 90%+ |
| `statusStore.ts` | 85%+ |
| `notificationStore.ts` | 90%+ |
| `cleanup.ts` | 90%+ |
| `connection.ts` | 95%+ |
| `migration.ts` | 80%+ (Dexie モック部分は除外) |

## 備考

- Hook 層 (`useTimeline`, `useFilteredTimeline` 等) は React コンポーネントテストが必要になるため、本フェーズではスコープ外とする。OPFS Worker 移行後に別途検討する。
- `InstanceBlockManager.tsx`, `MuteManager.tsx` のコンポーネント内 SQL 実行は、Store 層のテストで間接的にカバーされる。
- Worker RPC 層のテストは `specs/02-design.md` で別途定義する。
