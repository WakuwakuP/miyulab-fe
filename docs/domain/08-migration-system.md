# マイグレーションシステム

miyulab-fe はブラウザ内 SQLite (OPFS) をキャッシュ DB として使用しており、スキーマ変更を安全に適用するためのマイグレーションシステムを備えている。本ドキュメントではバージョン管理の仕組み、マイグレーション実行フロー、各バージョンの変更内容、および新しいマイグレーションの追加手順を解説する。

---

## 目次

1. [SemVer エンコーディング](#1-semver-エンコーディング)
2. [Migration インターフェース](#2-migration-インターフェース)
3. [Migration Runner 実行フロー](#3-migration-runner-実行フロー)
4. [各バージョンの変更内容](#4-各バージョンの変更内容)
5. [ヘルパー関数](#5-ヘルパー関数)
6. [マイグレーション追加手順](#6-マイグレーション追加手順)
7. [Dexie → SQLite 移行の経緯](#7-dexie--sqlite-移行の経緯)
8. [次に読むべきドキュメント](#8-次に読むべきドキュメント)

---

## 1. SemVer エンコーディング

**ソース**: `src/util/db/sqlite/schema/version.ts`

SQLite の `PRAGMA user_version` は整数値のみを格納できるため、SemVer (Semantic Versioning) を整数にエンコードして管理する。

### エンコード方式

```
encoded = major × 10000 + minor × 100 + patch
```

| SemVer  | エンコード値 |
|---------|-------------|
| 0.0.0   | 0           |
| 1.0.0   | 10000       |
| 2.0.0   | 20000       |
| 2.0.5   | 20005       |

### 型定義とユーティリティ

```typescript
type SemVer = { major: number; minor: number; patch: number }

encodeSemVer(v)       // SemVer → 整数
decodeSemVer(n)       // 整数 → SemVer
parseSemVer(str)      // 文字列 "2.0.5" → SemVer
formatSemVer(v)       // SemVer → 文字列 "2.0.5"
compareSemVer(a, b)   // 比較: -1 | 0 | 1
```

### レガシーバージョンの正規化

SemVer 導入前の旧スキーマ（`user_version` が `1`〜`10000` の範囲）との互換性を保つため、`normalizeLegacyVersion()` が変換を行う。

```typescript
function normalizeLegacyVersion(pragmaValue: number): SemVer {
  if (pragmaValue === 0)     return { major: 0, minor: 0, patch: 0 }  // 新規DB
  if (pragmaValue <= 10000)  return { major: 1, minor: 0, patch: 0 }  // 旧スキーマ → v1.0.0 扱い
  return decodeSemVer(pragmaValue)                                      // SemVer エンコード済み
}
```

### 最新バージョン定数

```typescript
export const LATEST_VERSION: SemVer = { major: 2, minor: 0, patch: 5 }
```

この定数は新規インストール時のスキーマバージョン設定や、マイグレーション適用範囲の判定に使用される。

---

## 2. Migration インターフェース

**ソース**: `src/util/db/sqlite/migrations/types.ts`

各マイグレーションは以下の型に従う。

```typescript
type Migration = {
  version: SemVer           // このマイグレーションが適用された後のバージョン
  description: string       // 変更内容の説明文
  up: (handle: DbHandle) => void       // スキーマ変更の実行関数
  validate?: (handle: DbHandle) => boolean  // マイグレーション後の検証（任意）
}
```

| プロパティ    | 説明 |
|-------------|------|
| `version`   | マイグレーション適用後の目標バージョン |
| `description` | ログ出力やスキーマ履歴テーブルに記録される説明文 |
| `up`        | DDL/DML を実行してスキーマを変更する関数 |
| `validate`  | マイグレーション適用後にテーブル・カラムの存在やデータ整合性を検証する関数。`false` を返すとマイグレーション失敗として扱われる |

---

## 3. Migration Runner 実行フロー

**ソース**: `src/util/db/sqlite/migrations/index.ts`

### マイグレーション一覧

`migrations` 配列に全マイグレーションが登録されている。

```typescript
export const migrations: Migration[] = [
  v2_0_0_migration,
  v2_0_1_migration,
  v2_0_2_migration,
  v2_0_3_migration,
  v2_0_4_migration,
  v2_0_5_migration,
]
```

### 実行フローチャート

```
┌─────────────────────────────────────┐
│  PRAGMA user_version を読み取り      │
│  rawVersion を取得                   │
└────────────────┬────────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ rawVersion ===  │───Yes──▶ 何もしない（最新）
        │ latestEncoded?  │
        └───────┬────────┘
                │ No
                ▼
        ┌────────────────┐
        │ rawVersion === │───Yes──▶ 【新規DB】
        │      0 ?       │         BEGIN
        └───────┬────────┘         ├─ createFreshSchema()
                │ No               ├─ PRAGMA user_version = latest
                ▼                  └─ COMMIT
   ┌──────────────────────┐
   │ normalizeLegacyVersion│
   │ で SemVer に正規化     │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ 適用可能な Migration  │
   │ をフィルタ＆ソート     │
   │ (current < m.version │
   │  <= LATEST_VERSION)  │
   └──────────┬───────────┘
              │
       ┌──────┴──────┐
       │ applicable  │───空──▶ 【バージョンギャップ/ダウングレード】
       │ .length > 0?│        resetSchema() でフルリセット
       └──────┬──────┘
              │ あり
              ▼
   ┌─────────────────────────────┐
   │ 各マイグレーションを順次適用   │
   │ ┌─────────────────────────┐ │
   │ │ BEGIN                   │ │
   │ │ ├─ migration.up()       │ │
   │ │ ├─ migration.validate() │ │
   │ │ │  └─ false → throw     │ │
   │ │ ├─ stampSchemaVersion() │ │
   │ │ ├─ PRAGMA user_version  │ │
   │ │ └─ COMMIT               │ │
   │ └──────────┬──────────────┘ │
   │            │ 例外発生時       │
   │            ▼                 │
   │    ROLLBACK → resetSchema() │
   │    (フォールバック)            │
   └─────────────────────────────┘
```

### 実行ロジックの詳細

#### 1. 最新バージョンの場合

`rawVersion === latestEncoded` であれば即座に `return`。何も実行しない。

#### 2. 新規インストール（user_version = 0）

マイグレーションは一切実行せず、`createFreshSchema()` で最新スキーマを一括作成する。FK 依存順に全テーブルが作成され、`PRAGMA user_version` に最新バージョンがセットされる。トランザクション内で実行され、失敗時は `ROLLBACK` される。

#### 3. 既存 DB: インクリメンタルマイグレーション

1. `normalizeLegacyVersion()` で `rawVersion` を SemVer に変換
2. `migrations` 配列から適用可能なマイグレーションを抽出（現在のバージョンより大きく、LATEST_VERSION 以下）
3. バージョン順にソート
4. 各マイグレーションを**個別トランザクション**で適用

#### 4. バリデーション失敗 / バージョンギャップ: フルリセット

以下のいずれかの場合、`resetSchema()` によるフルリセットが実行される：

- 適用可能なマイグレーションが空（バージョンギャップまたはダウングレード）
- マイグレーション実行中の例外
- `validate()` が `false` を返した場合

`resetSchema()` は全テーブルを DROP し、`createFreshSchema()` で最新スキーマを再作成する。ブラウザキャッシュ DB であり、マスターデータは Fediverse サーバー側にあるため、データロストは許容される設計。

### トランザクション管理

| シナリオ | トランザクション範囲 |
|---------|-------------------|
| 新規 DB | `createFreshSchema` 全体を 1 トランザクション |
| インクリメンタル | 各マイグレーションごとに個別トランザクション |
| フルリセット | `dropAllTables` + `createFreshSchema` を 1 トランザクション |

### スキーマバージョン履歴

`stampSchemaVersion()` により、`schema_version` テーブルにマイグレーション履歴が記録される。

```sql
INSERT OR REPLACE INTO schema_version (version, applied_at, description)
VALUES ('2.0.5', 1719000000000, 'Add missing UNIQUE(...) constraint')
```

---

## 4. 各バージョンの変更内容

### v2.0.0 — 正規化スキーマ（フル再構築）

**ソース**: `src/util/db/sqlite/migrations/v2.0.0/index.ts`

| 項目 | 内容 |
|-----|------|
| 対象 | v1.0.0（旧 v28 以下）→ v2.0.0 |
| 方式 | `dropAllTables()` + `createFreshSchema()` によるフル再構築 |
| テーブル数 | 28 テーブル |
| データ移行 | なし（ブラウザキャッシュのためデータロスト許容） |

主要な変更:
- JSON カラムに格納されていたデータを正規化テーブルに分割
- SemVer ベースのバージョン管理導入
- マルチアカウント対応のスキーマ設計

バリデーションでは 28 個の必須テーブル（`servers`, `profiles`, `posts`, `notifications`, `timeline_entries`, `schema_version` 等）の存在を確認する。

### v2.0.1 — ミュート/ブロックテーブル追加

**ソース**: `src/util/db/sqlite/migrations/v2.0.1/index.ts`

| 項目 | 内容 |
|-----|------|
| 追加テーブル | `muted_accounts`, `blocked_instances` |
| 既存データへの影響 | なし（新規テーブルの追加のみ） |

```sql
-- muted_accounts: ミュート済みアカウント管理
CREATE TABLE muted_accounts (
  server_id    INTEGER NOT NULL,
  account_acct TEXT    NOT NULL,
  muted_at     INTEGER NOT NULL,
  PRIMARY KEY (server_id, account_acct)
);

-- blocked_instances: ブロック済みインスタンス管理
CREATE TABLE blocked_instances (
  instance_domain TEXT PRIMARY KEY NOT NULL,
  blocked_at      INTEGER NOT NULL
);
```

### v2.0.2 — 通知タイプリネーム

**ソース**: `src/util/db/sqlite/migrations/v2.0.2/index.ts`

| 項目 | 内容 |
|-----|------|
| 変更対象 | `notification_types` テーブル |
| 内容 | `id=5` の `name` を `'reaction'` → `'emoji_reaction'` にリネーム |
| 目的 | Misskey / Pleroma の絵文字リアクション通知の名前を統一 |

### v2.0.3 — canonical_acct カラム追加

**ソース**: `src/util/db/sqlite/migrations/v2.0.3/index.ts`

| 項目 | 内容 |
|-----|------|
| 変更対象 | `profiles` テーブル |
| 追加カラム | `canonical_acct TEXT NOT NULL DEFAULT ''` |
| 目的 | 同一 Fediverse ユーザーが異なるサーバー経由で別々の `profile_id` を持つ問題の解決 |

処理内容:
1. `canonical_acct` カラムを追加
2. 既存行を一括更新: `acct` に `@` が含まれればそのまま、含まれなければ `acct@host` 形式に変換
3. `idx_profiles_canonical_acct` インデックスを作成

バリデーションではカラムの存在と、空の `canonical_acct` が残っていないことを確認する。

### v2.0.4 — プロフィール重複統合 + canonical_acct UNIQUE 化

**ソース**: `src/util/db/sqlite/migrations/v2.0.4/index.ts`

| 項目 | 内容 |
|-----|------|
| 変更対象 | `profiles` テーブルおよび関連 FK |
| 目的 | `canonical_acct` の重複を統合し、UNIQUE INDEX を追加 |

**Phase 1: 重複プロフィールの統合**
1. `_profile_merge_map` 一時テーブルを作成し、同一 `canonical_acct` のうち最小 ID を winner、残りを loser としてマッピング
2. loser を参照する全 FK を winner に付け替え（`posts.author_profile_id`, `post_mentions.profile_id`, `notifications.actor_profile_id`, `local_accounts.profile_id`, `profiles.moved_to_profile_id`）
3. loser 行を削除（`profile_stats`, `profile_fields`, `profile_custom_emojis` は CASCADE で自動削除）

**Phase 2: UNIQUE INDEX 追加**
- 既存の非 UNIQUE インデックス `idx_profiles_canonical_acct` を DROP
- UNIQUE INDEX として再作成

### v2.0.5 — UNIQUE(username, server_id) 制約追加

**ソース**: `src/util/db/sqlite/migrations/v2.0.5/index.ts`

| 項目 | 内容 |
|-----|------|
| 変更対象 | `profiles` テーブルおよび関連 FK |
| 目的 | v2.0.0 の `createFreshSchema` で欠落していた `UNIQUE(username, server_id)` 制約を追加 |
| 原因 | `ensureProfile` の dual `ON CONFLICT` チェーンが失敗する問題の修正 |

v2.0.4 と同じパターン（Phase 1: 重複統合、Phase 2: UNIQUE INDEX 追加）で、`(username, server_id)` の組み合わせに対する UNIQUE 制約を追加する。

### レガシー: v28 マイグレーション

**ソース**: `src/util/db/sqlite/migrations/v28.ts`

SemVer 導入前の旧形式マイグレーション。`version: { major: 0, minor: 0, patch: 28 }` として定義されている。現在は `normalizeLegacyVersion()` により v1.0.0 として扱われ、v2.0.0 マイグレーション（フルリセット）の対象となる。

---

## 5. ヘルパー関数

**ソース**: `src/util/db/sqlite/migrations/helpers.ts`

マイグレーション内で使われる汎用ユーティリティ。

| 関数 | 説明 |
|------|------|
| `tableExists(db, tableName)` | テーブルが `sqlite_master` に存在するかチェック |
| `addColumnIfNotExists(db, tableName, columnName, columnDef)` | `PRAGMA table_info` でカラムの存在を確認し、なければ `ALTER TABLE ADD COLUMN` |
| `recreateTable(db, tableName, newCreateSql, columnMapping, selectExpr?, options?)` | バックアップリネーム方式でテーブルを再作成（データ移行付き） |
| `createIndexSafe(db, sql)` | `CREATE INDEX IF NOT EXISTS` をラップ |

### recreateTable の処理フロー

`recreateTable` はカラム削除やカラム型変更など、`ALTER TABLE` では対応できない変更に使用する。

```
1. preSql を実行（オプション）
2. 旧テーブルを _<tableName>_v1_backup にリネーム
3. newCreateSql で新テーブルを作成
4. バックアップからデータをコピー（columnMapping で制御）
5. バックアップテーブルを DROP
6. postSql を実行（オプション）
```

---

## 6. マイグレーション追加手順

### Step 1: バージョンディレクトリの作成

`src/util/db/sqlite/migrations/` 配下に新バージョンのディレクトリを作成する。

```
src/util/db/sqlite/migrations/
├── v2.0.0/
│   └── index.ts
├── v2.0.1/
│   └── index.ts
├── ...
└── v2.0.6/          ← 新規作成
    └── index.ts
```

### Step 2: マイグレーション実装

`index.ts` に `Migration` 型のオブジェクトをエクスポートする。

```typescript
import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

export const v2_0_6_migration: Migration = {
  description: '変更内容の説明',

  up(handle: SchemaDbHandle) {
    const { db } = handle
    // DDL/DML を実行
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle
    // マイグレーション後の検証
    return true
  },

  version: { major: 2, minor: 0, patch: 6 },
}
```

### Step 3: migrations/index.ts への登録

```typescript
import { v2_0_6_migration } from './v2.0.6'

export const migrations: Migration[] = [
  v2_0_0_migration,
  v2_0_1_migration,
  // ...
  v2_0_5_migration,
  v2_0_6_migration,  // ← 追加
]
```

### Step 4: LATEST_VERSION の更新

`src/util/db/sqlite/schema/version.ts` の `LATEST_VERSION` を更新する。

```typescript
export const LATEST_VERSION: SemVer = { major: 2, minor: 0, patch: 6 }
```

### Step 5: createFreshSchema の更新（必要な場合）

新規 DB インストール時にもテーブルが作成されるよう、`src/util/db/sqlite/schema/` 配下のテーブル定義も更新する。マイグレーションはインクリメンタル適用のみに使用されるため、`createFreshSchema` が最新の完全なスキーマを反映している必要がある。

### 実装時の注意点

- **冪等性**: `IF NOT EXISTS` や `IF EXISTS` を適切に使用する
- **バリデーション**: `validate` 関数でマイグレーション後の状態を検証する。`false` を返すとフルリセットが発生する
- **データ移行**: ブラウザキャッシュ DB のためデータロストは許容されるが、可能な限り既存データを保持する設計が望ましい
- **FK 参照の付け替え**: プロフィール統合のように重複解消が必要な場合は、一時テーブルで loser → winner のマッピングを作成し、全 FK を付け替えてから loser を削除するパターンを使用する

---

## 7. Dexie → SQLite 移行の経緯

### 旧アーキテクチャ（Dexie / IndexedDB）

miyulab-fe は当初、[Dexie.js](https://dexie.org/) を使用して IndexedDB にデータをキャッシュしていた。Dexie はバージョニングと自動マイグレーションの仕組みを内蔵しており、旧スキーマの `user_version` は `1`〜`28` の範囲で管理されていた（`v28.ts` が残存するレガシーマイグレーション）。

### 移行の動機

IndexedDB / Dexie から SQLite OPFS (Origin Private File System) への移行は、以下の理由で行われた:

- **複雑なクエリ対応**: IndexedDB は KV ストアベースのため、JOIN やサブクエリなど複雑なクエリが困難。タイムラインのフィルタリングや正規化テーブル間の結合には SQL が不可欠
- **正規化スキーマ**: JSON カラムに格納されていたネストデータを正規化テーブルに分割することで、データ整合性とクエリ効率が向上
- **パフォーマンス**: OPFS VFS を使用した SQLite は、IndexedDB と比較して大量データの読み書きでパフォーマンス面の利点がある
- **マルチアカウント対応**: 複数アカウントのデータを単一 DB で管理するために、外部キー制約付きの正規化スキーマが必要

### 現在の状態

- Dexie への直接的な依存は現在のソースコードから除去されている（`dexie` 名前付きファイルは存在しない）
- `src/util/db/errors.ts` に `IndexedDB` への言及が残るが、これは汎用エラーハンドリング用
- SQLite は Dedicated Worker + OPFS SAH Pool VFS で永続化される（`src/util/db/sqlite/initSqlite.ts`）
- Worker が利用できない環境ではメインスレッド + インメモリ DB にフォールバック

---

## 関連ファイル一覧

| ファイルパス | 説明 |
|------------|------|
| `src/util/db/sqlite/schema/version.ts` | SemVer 型定義・エンコード・LATEST_VERSION |
| `src/util/db/sqlite/migrations/types.ts` | Migration インターフェース定義 |
| `src/util/db/sqlite/migrations/index.ts` | マイグレーション一覧・Runner |
| `src/util/db/sqlite/migrations/helpers.ts` | ヘルパー関数 |
| `src/util/db/sqlite/migrations/v2.0.0/index.ts` | v2.0.0 フル正規化マイグレーション |
| `src/util/db/sqlite/migrations/v2.0.1/index.ts` | v2.0.1 ミュート/ブロックテーブル追加 |
| `src/util/db/sqlite/migrations/v2.0.2/index.ts` | v2.0.2 通知タイプリネーム |
| `src/util/db/sqlite/migrations/v2.0.3/index.ts` | v2.0.3 canonical_acct 追加 |
| `src/util/db/sqlite/migrations/v2.0.4/index.ts` | v2.0.4 プロフィール重複統合 |
| `src/util/db/sqlite/migrations/v2.0.5/index.ts` | v2.0.5 UNIQUE(username, server_id) 追加 |
| `src/util/db/sqlite/migrations/v28.ts` | レガシーマイグレーション（SemVer 前） |
| `src/util/db/sqlite/schema/index.ts` | スキーマ初期化・createFreshSchema・dropAllTables |
| `src/util/db/sqlite/initSqlite.ts` | SQLite 初期化（Worker + OPFS / フォールバック） |

---

## 8. 次に読むべきドキュメント

- **[09-media-proxy.md](./09-media-proxy.md)** — メディアプロキシシステム
