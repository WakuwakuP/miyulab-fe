# 09. マイグレーションと進化

## スキーマバージョニング

### バージョン管理方式

**SemVer** を SQLite の `PRAGMA user_version` にエンコードして管理する。

現在のバージョン: **v2.0.1**（エンコード値: **20001**）

```sql
// エンコード: major * 10000 + minor * 100 + patch
// v2.0.1 → 2 * 10000 + 0 * 100 + 1 = 20001

PRAGMA user_version;         // → 20001
PRAGMA user_version = 20001; // → v2.0.1
```

### SemVer エンコーディング

```typescript
type SemVer = { major: number; minor: number; patch: number }

function encodeSemVer(v: SemVer): number {
  return v.major * 10000 + v.minor * 100 + v.patch
}

function decodeSemVer(encoded: number): SemVer {
  if (encoded > 0 && encoded < 10000) {
    return { major: 0, minor: 0, patch: encoded }  // レガシー値
  }
  return {
    major: Math.floor(encoded / 10000),
    minor: Math.floor((encoded % 10000) / 100),
    patch: encoded % 100,
  }
}
```

### レガシーバージョンの正規化

旧整数バージョン（v1〜v28）は `1.0.0` に正規化される。

```typescript
function normalizeLegacyVersion(pragmaValue: number): SemVer {
  if (pragmaValue === 0) return { major: 0, minor: 0, patch: 0 }  // 未初期化
  if (pragmaValue <= 10000) return { major: 1, minor: 0, patch: 0 }  // レガシー
  return decodeSemVer(pragmaValue)
}
```

## マイグレーションの実行

`migrations/index.ts` のマイグレーションランナーがアプリ起動時にバージョンを確認し、必要なマイグレーションを順次適用する。

```typescript
const migrations: Migration[] = [v2_0_0_migration, v2_0_1_migration]
```

| `user_version` の状態 | アクション |
|---------------------|---------|
| `= 20001` (最新) | No-op |
| `= 0` (新規 DB) | `createFreshSchema()` → LATEST_VERSION をスタンプ |
| レガシー (≤ 10000, 例: v28) | `1.0.0` に正規化 → 適用可能なマイグレーションを実行 |
| 不整合 / ギャップ | **フォールバック**: DROP ALL → `createFreshSchema()` |

**設計判断**: ブラウザのキャッシュ DB であるため、マイグレーション失敗時はデータを捨てて再作成する（ユーザーデータの永久損失にはならない）。

### マイグレーション型

```typescript
type Migration = {
  version: SemVer
  migrate: (db: DbExec) => void
  validate?: (db: DbExec) => boolean
}
```

各マイグレーションは独自のトランザクション内で実行され、オプションの `validate()` で結果を検証できる。

## マイグレーション履歴

### v2.0.0: 正規化スキーマ（28 テーブル）

旧スキーマ（v1〜v28）を **全テーブル DROP + 再作成**。

| カテゴリ | テーブル |
|---------|--------|
| ルックアップ | `servers`, `visibility_types`, `media_types`, `notification_types`, `card_types` |
| レジストリ | `custom_emojis`, `hashtags` |
| プロフィール | `profiles`, `profile_stats`, `profile_fields`, `profile_custom_emojis` |
| アカウント | `local_accounts` |
| 投稿 | `posts`, `post_backend_ids`, `post_stats` |
| 投稿関連 | `post_media`, `post_mentions`, `post_hashtags`, `post_custom_emojis` |
| インタラクション | `post_interactions`, `post_emoji_reactions` |
| 投票 | `polls`, `poll_votes`, `poll_options` |
| カード | `link_cards` |
| タイムライン/通知 | `timeline_entries`, `notifications` |
| メタ | `schema_version` |

**主な変更**:
- `posts_backends` → `post_backend_ids`（`local_account_id` FK ベース）
- `timelines` + `timeline_items` → `timeline_entries`（軽量設計）
- 新規 `local_accounts` テーブル（マルチアカウント管理の中核）
- `posts.id` を INTEGER PK に統一（旧 `post_id`）
- JSON カラム依存を完全排除
- FK 依存順序でテーブルを作成

### v2.0.1: フィルタリングテーブル追加

| テーブル | 用途 |
|---------|------|
| `muted_accounts` | ミュートアカウント管理 |
| `blocked_instances` | インスタンスブロック管理 |

## スキーマファイル構成

```text
src/util/db/sqlite/schema/
  ├── index.ts          ← ensureSchema / createFreshSchema / dropAllTables
  ├── version.ts        ← SemVer 型 + LATEST_VERSION + encode/decode
  ├── types.ts          ← DbExec 型
  └── tables/           ← テーブル別 CREATE 文
       ├── accounts.ts      (local_accounts)
       ├── cards.ts         (link_cards)
       ├── interactions.ts  (post_interactions, post_emoji_reactions)
       ├── lookup.ts        (servers, visibility_types, media_types, etc.)
       ├── meta.ts          (schema_version)
       ├── notifications.ts (notifications)
       ├── polls.ts         (polls, poll_votes, poll_options)
       ├── postRelated.ts   (post_media, post_mentions, post_hashtags, etc.)
       ├── posts.ts         (posts, post_backend_ids, post_stats)
       ├── profiles.ts      (profiles, profile_stats, profile_fields, etc.)
       ├── registries.ts    (custom_emojis, hashtags)
       └── timeline.ts      (timeline_entries)

src/util/db/sqlite/migrations/
  ├── index.ts          ← マイグレーションランナー
  ├── types.ts          ← Migration 型定義
  ├── helpers.ts        ← ユーティリティ (tableExists, recreateTable, etc.)
  ├── v28.ts            ← レガシーバージョン参照
  ├── v2.0.0/index.ts   ← 正規化スキーマ (DROP ALL + 28 テーブル作成)
  └── v2.0.1/index.ts   ← muted_accounts + blocked_instances 追加
```

## 設定マイグレーション

### TimelineSettings の V2 移行

`migrateTimeline.ts` が localStorage の設定を V2 フォーマットに移行する。

```typescript
function isV2Settings(data: unknown): data is TimelineSettingsV2 {
  return (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    data.version === 2
  )
}
```

V2 で追加された主な設定項目：
- `backendFilter` — バックエンドフィルタ
- `advancedQuery` / `customQuery` — Advanced Query
- `visibilityFilter` / `languageFilter` — 詳細フィルタ
- `tabGroup` — タブグループ
- `timelineTypes` — 複数タイムラインタイプ

## 設計判断の変遷

### Dexie → SQLite

**背景**: 初期実装では Dexie.js（IndexedDB のラッパー）を使用していた。

**移行理由**:
- IndexedDB は JOIN ができない。マルチバックエンド統合には JavaScript 側での結合が必要で、パフォーマンスが悪化
- 複雑なフィルタ条件の組み合わせを IndexedDB のクエリで表現できない
- SQL なら WHERE 句でフィルタを宣言的に組み合わせられる

### JSON カラム → 完全正規化

**背景**: 初期は投稿の JSON 全体を `json` カラムに保持していた。

**移行理由**:
- JSON の中身でフィルタするにはパースが必要で、インデックスが効かない
- 正規化カラムにすればサブクエリでフィルタ可能
- v2.0.0 で JSON 依存を完全排除

### 整数バージョン → SemVer

**背景**: v1〜v28 では整数バージョンで段階的にマイグレーションしていた。

**移行理由**:
- 28 段階のマイグレーションチェーンは壊れやすく非効率
- v2.0.0 で全テーブルを一括再作成し、以降は SemVer で管理
- レガシーバージョンは一律 `1.0.0` に正規化してからマイグレーション適用
