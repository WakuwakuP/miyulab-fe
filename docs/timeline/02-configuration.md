# 02. タイムライン設定 (TimelineConfigV2)

## 概要

タイムラインの動作はすべて `TimelineConfigV2` 型で定義されます。この設定オブジェクトは localStorage に永続化され、`TimelineProvider` を通じてアプリケーション全体で共有されます。

## TimelineSettingsV2

タイムライン設定の最上位コンテナです。

```typescript
type TimelineSettingsV2 = {
  /** タイムライン設定の配列 */
  timelines: TimelineConfigV2[];
  /** 設定バージョン（マイグレーション判定用） */
  version: 2;
};
```

- `version: 2` により、localStorage から読み込んだデータが V1 か V2 かを判定できます
- V1 形式の場合は `migrateV1toV2()` で自動マイグレーションされます（詳細は [09-migration.md](./09-migration.md)）

## TimelineConfigV2 の全プロパティ

### 基本プロパティ

| プロパティ | 型             | 必須 | デフォルト | 説明                                 |
| ---------- | -------------- | ---- | ---------- | ------------------------------------ |
| `id`       | `string`       | ✅   | -          | 一意識別子（UUID v4）                |
| `type`     | `TimelineType` | ✅   | -          | タイムラインの種類                   |
| `visible`  | `boolean`      | ✅   | -          | 表示 / 非表示                        |
| `order`    | `number`       | ✅   | -          | 表示順序（0 始まり、昇順）           |
| `label`    | `string`       | -    | undefined  | カスタム表示名（未設定時は自動生成） |

### タイムライン種別 (TimelineType)

```typescript
type TimelineType = "home" | "local" | "public" | "notification" | "tag";
```

| 種別           | 説明                     | ストリーム管理者                      | 初期データ取得        |
| -------------- | ------------------------ | ------------------------------------- | --------------------- |
| `home`         | ホームタイムライン       | `StatusStoreProvider` (userStreaming) | `StatusStoreProvider` |
| `local`        | ローカルタイムライン     | `StreamingManagerProvider`            | `timelineFetcher`     |
| `public`       | 連合タイムライン         | `StreamingManagerProvider`            | `timelineFetcher`     |
| `tag`          | ハッシュタグタイムライン | `StreamingManagerProvider`            | `timelineFetcher`     |
| `notification` | 通知                     | `StatusStoreProvider` (userStreaming) | `StatusStoreProvider` |

### バックエンドフィルタ

```typescript
type BackendFilter =
  | { mode: "all" }
  | { mode: "single"; backendUrl: string }
  | { mode: "composite"; backendUrls: string[] };
```

| プロパティ      | 型              | 必須 | デフォルト        | 説明                   |
| --------------- | --------------- | ---- | ----------------- | ---------------------- |
| `backendFilter` | `BackendFilter` | -    | `{ mode: 'all' }` | 対象バックエンドの選択 |

#### モード詳細

| モード      | 説明                     | ユースケース                   |
| ----------- | ------------------------ | ------------------------------ |
| `all`       | 全登録サーバーを対象     | 統合タイムライン（デフォルト） |
| `single`    | 特定の 1 サーバーのみ    | 特定インスタンスの LTL / FTL   |
| `composite` | 複数サーバーの組み合わせ | サーバー A + B だけの統合 TL   |

#### 正規化ルール (`normalizeBackendFilter`)

`timelineConfigValidator.ts` の `normalizeBackendFilter()` により、以下の正規化が行われます。

1. `single` モードで指定された `backendUrl` が `apps` に存在しない場合 → `{ mode: 'all' }` にフォールバック
2. `composite` モードで `apps` に存在しない URL を除外
   - 残りが 0 件 → `{ mode: 'all' }`
   - 残りが 1 件 → `{ mode: 'single', backendUrl: ... }`
   - 残りが 2 件以上 → URL をソートして正規化

```typescript
// 例: アカウント削除後の自動フォールバック
normalizeBackendFilter(
  { mode: "single", backendUrl: "https://deleted-instance.example" },
  apps, // このURLが含まれていない
);
// → { mode: 'all' }
```

### タグ設定

| プロパティ  | 型          | 必須 | デフォルト | 説明                                        |
| ----------- | ----------- | ---- | ---------- | ------------------------------------------- |
| `tagConfig` | `TagConfig` | -    | undefined  | タグ設定（`type === 'tag'` の場合のみ有効） |

```typescript
type TagConfig = {
  /** タグの結合モード */
  mode: "or" | "and";
  /** タグ名の配列（# なし、小文字） */
  tags: string[];
};
```

#### OR / AND モード

| モード | SQL 戦略                                                | 説明                           |
| ------ | ------------------------------------------------------- | ------------------------------ |
| `or`   | `IN (tag1, tag2, ...) + GROUP BY + DISTINCT`            | いずれかのタグを含む投稿を表示 |
| `and`  | `IN (tag1, tag2, ...) + HAVING COUNT(DISTINCT tag) = N` | すべてのタグを含む投稿のみ表示 |

```typescript
// OR 例: #cat または #dog のいずれかを含む投稿
{ mode: 'or', tags: ['cat', 'dog'] }

// AND 例: #cat と #dog の両方を含む投稿のみ
{ mode: 'and', tags: ['cat', 'dog'] }
```

#### 正規化ルール (`normalizeTagConfig`)

- 重複タグを `Set` で除去

### メディアフィルタ

| プロパティ      | 型        | 必須 | デフォルト | 説明                     |
| --------------- | --------- | ---- | ---------- | ------------------------ |
| `onlyMedia`     | `boolean` | -    | `false`    | メディア付き投稿のみ表示 |
| `minMediaCount` | `number`  | -    | undefined  | メディア添付の最小枚数   |

- `minMediaCount` が指定されている場合、`onlyMedia` より優先される
- `onlyMedia` は SQL の `s.has_media = 1` にマッピング
- `minMediaCount` は SQL の `s.media_count >= ?` にマッピング
- API 側の `only_media` パラメータが使える場合（local / public）は API 側でもフィルタ

```typescript
// メディア付きのみ
{
  onlyMedia: true;
}
// → SQL: s.has_media = 1

// メディア2枚以上
{
  minMediaCount: 2;
}
// → SQL: s.media_count >= 2
```

### 公開範囲フィルタ

| プロパティ         | 型                 | 必須 | デフォルト          | 説明             |
| ------------------ | ------------------ | ---- | ------------------- | ---------------- |
| `visibilityFilter` | `VisibilityType[]` | -    | undefined（全表示） | 表示する公開範囲 |

```typescript
type VisibilityType = "public" | "unlisted" | "private" | "direct";
```

- 未指定時はすべての公開範囲を表示
- 4 種類すべてが指定された場合はフィルタ条件を生成しない（全表示と同義）
- SQL の `s.visibility IN (?)` にマッピング

```typescript
// 公開 + 未収載のみ表示
{
  visibilityFilter: ["public", "unlisted"];
}
// → SQL: s.visibility IN ('public', 'unlisted')
```

### 言語フィルタ

| プロパティ       | 型         | 必須 | デフォルト          | 説明               |
| ---------------- | ---------- | ---- | ------------------- | ------------------ |
| `languageFilter` | `string[]` | -    | undefined（全表示） | 表示する言語コード |

- 未指定時はすべての言語を表示
- **言語が未設定（`NULL`）の投稿は常に表示する**（除外しない）
- SQL の `(s.language IN (?) OR s.language IS NULL)` にマッピング

```typescript
// 日本語 + 英語のみ表示（言語未設定の投稿も表示）
{
  languageFilter: ["ja", "en"];
}
// → SQL: (s.language IN ('ja', 'en') OR s.language IS NULL)
```

### 除外フィルタ

| プロパティ         | 型        | 必須 | デフォルト | 説明                   |
| ------------------ | --------- | ---- | ---------- | ---------------------- |
| `excludeReblogs`   | `boolean` | -    | `false`    | ブースト投稿を除外     |
| `excludeReplies`   | `boolean` | -    | `false`    | リプライを除外         |
| `excludeSpoiler`   | `boolean` | -    | `false`    | CW 付き投稿を除外      |
| `excludeSensitive` | `boolean` | -    | `false`    | センシティブ投稿を除外 |

```typescript
// ブーストとリプライを除外してオリジナル投稿のみ
{ excludeReblogs: true, excludeReplies: true }
// → SQL: s.is_reblog = 0 AND s.in_reply_to_id IS NULL
```

### ミュート・ブロックフィルタ

| プロパティ           | 型        | 必須 | デフォルト | 説明                             |
| -------------------- | --------- | ---- | ---------- | -------------------------------- |
| `applyMuteFilter`    | `boolean` | -    | `true`     | ミュートアカウントの投稿を除外   |
| `applyInstanceBlock` | `boolean` | -    | `true`     | ブロックインスタンスの投稿を除外 |

- `applyMuteFilter` が `true` で `accountFilter.mode === 'include'` の場合、ミュートは適用されない（明示的に指定ユーザーの投稿を見たい場合にミュートで消えるのは不適切）
- カスタムクエリモードではこれらのフィルタは適用されない

### アカウントフィルタ

| プロパティ      | 型              | 必須 | デフォルト | 説明                      |
| --------------- | --------------- | ---- | ---------- | ------------------------- |
| `accountFilter` | `AccountFilter` | -    | undefined  | 特定アカウントの包含/除外 |

```typescript
type AccountFilter = {
  mode: "include" | "exclude";
  accts: string[];
};
```

| モード    | 説明                         | SQL                         |
| --------- | ---------------------------- | --------------------------- |
| `include` | 指定アカウントの投稿のみ表示 | `s.account_acct IN (?)`     |
| `exclude` | 指定アカウントの投稿を除外   | `s.account_acct NOT IN (?)` |

```typescript
// 特定ユーザーの投稿のみ表示
{ accountFilter: { mode: 'include', accts: ['user@mastodon.social'] } }

// スパムアカウントを除外
{ accountFilter: { mode: 'exclude', accts: ['spam@example.com'] } }
```

**注意:** `include` モードの場合、`applyMuteFilter` は自動的に無効化されます。

### カスタムクエリ

| プロパティ      | 型        | 必須 | デフォルト | 説明                            |
| --------------- | --------- | ---- | ---------- | ------------------------------- |
| `customQuery`   | `string`  | -    | undefined  | カスタム SQL WHERE 句           |
| `advancedQuery` | `boolean` | -    | `false`    | Advanced Query モードの UI 状態 |

- `customQuery` が設定されている場合、他のフィルタオプションより優先される
- DML / DDL は拒否される（`DROP`, `DELETE`, `INSERT`, `UPDATE` 等）
- SQL コメント（`--`, `/* */`）も拒否される
- `LIMIT` / `OFFSET` は自動的に除去・再設定される
- `advancedQuery` は UI のトグル状態の永続化のみに使用

参照可能なテーブル:

| エイリアス | テーブル名                | 説明             |
| ---------- | ------------------------- | ---------------- |
| `s`        | `statuses`                | 投稿本体         |
| `stt`      | `statuses_timeline_types` | タイムライン種別 |
| `sbt`      | `statuses_belonging_tags` | タグ             |
| `sm`       | `statuses_mentions`       | メンション       |
| `sb`       | `statuses_backends`       | バックエンド     |

```typescript
// 日本語の画像付き投稿のみ
{
  customQuery: "s.language = 'ja' AND s.has_media = 1";
}

// 特定タグの特定サーバーの投稿
{
  customQuery: "sbt.tag = 'gochisou_photo' AND sb.backendUrl = 'https://mastodon.social'";
}
```

## 設定の永続化と復元

### localStorage への保存

`TimelineProvider` が `timelineSettings` の変更を監視し、自動的に localStorage に書き込みます。

```typescript
// 保存時
localStorage.setItem(
  "timelineSettings",
  JSON.stringify({
    timelines: timelineSettings.timelines,
    version: 2,
  }),
);
```

### localStorage からの復元

起動時に以下の順序で復元を試みます。

1. localStorage から `timelineSettings` を読み込み
2. `isV2Settings()` で V2 形式か判定 → そのまま使用
3. `isV1Settings()` で V1 形式か判定 → `migrateV1toV2()` でマイグレーション
4. 不明な形式 → デフォルト設定を使用

### デフォルト設定

```typescript
const initialTimelineSettings: TimelineSettings = {
  timelines: [
    {
      id: "home",
      type: "home",
      order: 0,
      visible: true,
      backendFilter: { mode: "all" },
    },
    {
      id: "notification",
      type: "notification",
      order: 1,
      visible: true,
      backendFilter: { mode: "all" },
    },
    {
      id: "tag-gochisou_photo",
      type: "tag",
      order: 2,
      visible: true,
      onlyMedia: true,
      backendFilter: { mode: "all" },
      tagConfig: { mode: "or", tags: ["gochisou_photo"] },
    },
    {
      id: "public",
      type: "public",
      order: 3,
      visible: true,
      onlyMedia: true,
      backendFilter: { mode: "all" },
    },
  ],
  version: 2,
};
```

## 表示名の自動生成

`getDefaultTimelineName()` が `TimelineConfigV2` からデフォルトの表示名を生成します。

### 基本名

| type           | 基本名         |
| -------------- | -------------- |
| `home`         | `Home`         |
| `local`        | `Local`        |
| `public`       | `Public`       |
| `notification` | `Notification` |
| `tag` (OR)     | `#cat \| #dog` |
| `tag` (AND)    | `#cat & #dog`  |

### サフィックス

フィルタオプションに応じて絵文字サフィックスが追加されます（最大 4 つ）。

| フィルタ                        | サフィックス | 例            |
| ------------------------------- | ------------ | ------------- |
| `onlyMedia`                     | `📷`         | `Public 📷`   |
| `minMediaCount: 2`              | `📷2+`       | `Public 📷2+` |
| `visibilityFilter: ['public']`  | `🌐`         | `Local 🌐`    |
| `visibilityFilter: ['private']` | `🔒`         | `Home 🔒`     |
| `languageFilter: ['ja']`        | `🌍ja`       | `Public 🌍ja` |
| `excludeReblogs`                | `🚫🔁`       | `Home 🚫🔁`   |
| `excludeReplies`                | `🚫💬`       | `Home 🚫💬`   |
| `excludeSpoiler`                | `🚫CW`       | `Local 🚫CW`  |
| `excludeSensitive`              | `🚫⚠️`       | `Local 🚫⚠️`  |

サフィックスが 5 つ以上になる場合は末尾に `…` が追加されます。

### カスタムラベル

`config.label` が設定されている場合は自動生成を行わず、そのまま返します。

```typescript
// カスタムラベルあり → そのまま使用
{ label: 'My Feed', type: 'home' }
// → "My Feed"

// カスタムラベルなし → 自動生成
{ type: 'public', onlyMedia: true, excludeReblogs: true }
// → "Public 📷 🚫🔁"
```

## 設定の CRUD 操作

### TimelineManagement コンポーネント

`TimelineManagement` が設定の CRUD UI を提供します。

| 操作            | 説明                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **追加**        | コアタイムライン（home/local/public/notification）はワンクリック追加。tag は `AddTagTimelineDialog` で複数タグを入力して作成 |
| **編集**        | `TimelineEditPanel` で各種フィルタを GUI で編集。Advanced Query モードでは SQL を直接記述可能                                |
| **削除**        | タイムラインを設定から削除                                                                                                   |
| **並び替え**    | ドラッグ＆ドロップ（@dnd-kit）または ↑↓ ボタンで順序変更                                                                     |
| **表示/非表示** | 👁 アイコンで toggle（非表示でもストリーム接続は維持）                                                                       |

### ID 生成

タイムライン追加時に `crypto.randomUUID()`（利用不可の場合はフォールバック生成関数）で一意の ID を付与します。
