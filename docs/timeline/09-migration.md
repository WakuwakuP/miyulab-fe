# 09. 設定マイグレーション

## 概要

miyulab-fe のタイムライン設定は localStorage に永続化されており、アプリケーションのバージョンアップに伴ってスキーマが変更される場合があります。マイグレーションシステムは、古い形式の設定データを現行の `TimelineSettingsV2` 形式に自動変換し、ユーザーの設定を損なわずにアップグレードを実現します。

## 関連ファイル

| ファイル                                 | 説明                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `src/util/migration/migrateTimeline.ts`  | V1 → V2 マイグレーションロジック                 |
| `src/util/provider/TimelineProvider.tsx` | 設定の読み込み・バージョン判定・永続化           |
| `src/types/types.ts`                     | `TimelineConfigV2` / `TimelineSettingsV2` 型定義 |
| `src/util/timelineConfigValidator.ts`    | `BackendFilter` / `TagConfig` の正規化           |

## バージョン体系

| バージョン | 識別方法                 | 特徴                                                            |
| ---------- | ------------------------ | --------------------------------------------------------------- |
| V1         | `version` プロパティなし | 初期形式。`tag` フィールドで単一タグを指定                      |
| V2         | `version: 2`             | 現行形式。`tagConfig` で複数タグ対応、v2 フィルタオプション対応 |

## バージョン判定

### 型ガード関数

`migrateTimeline.ts` に定義された型ガード関数により、localStorage から読み込んだデータの形式を判定します。

#### isV1Settings

```typescript
export function isV1Settings(parsed: unknown): parsed is V1TimelineSettings {
  if (typeof parsed !== "object" || parsed == null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    !("version" in obj) && "timelines" in obj && Array.isArray(obj.timelines)
  );
}
```

**判定条件:**

1. `object` 型であること
2. `null` でないこと
3. `version` プロパティが**存在しない**こと
4. `timelines` プロパティが存在し、配列であること

#### isV2Settings

```typescript
export function isV2Settings(parsed: unknown): parsed is TimelineSettingsV2 {
  if (typeof parsed !== "object" || parsed == null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    obj.version === 2 && "timelines" in obj && Array.isArray(obj.timelines)
  );
}
```

**判定条件:**

1. `object` 型であること
2. `null` でないこと
3. `version === 2` であること
4. `timelines` プロパティが存在し、配列であること

### 判定フロー

```
localStorage から timelineSettings を読み込み
  │
  │  JSON.parse(timelineStr)
  ▼
parsed: unknown
  │
  ├── isV2Settings(parsed) === true
  │   └── そのまま使用（マイグレーション不要）
  │
  ├── isV1Settings(parsed) === true
  │   └── migrateV1toV2(parsed) で V2 に変換
  │
  └── どちらにも該当しない
      └── デフォルト設定を使用（データ破損等）
```

## V1 → V2 マイグレーション

### V1 の型定義

```typescript
// src/util/migration/types.ts

type V1TimelineConfig = {
  id: string;
  type: "home" | "local" | "public" | "notification" | "tag";
  visible: boolean;
  order: number;
  tag?: string; // 単一タグ（V2 では tagConfig に変換）
};

type V1TimelineSettings = {
  timelines: V1TimelineConfig[];
  // version プロパティなし
};
```

### 変換ルール

`migrateConfigV1toV2()` 関数が V1 の各タイムライン設定を V2 形式に変換します。

| V1 プロパティ | V2 プロパティ   | 変換ルール                                          |
| ------------- | --------------- | --------------------------------------------------- |
| `id`          | `id`            | そのまま維持                                        |
| `type`        | `type`          | そのまま維持                                        |
| `visible`     | `visible`       | そのまま維持                                        |
| `order`       | `order`         | そのまま維持                                        |
| -             | `backendFilter` | `{ mode: 'all' }` を設定                            |
| -             | `onlyMedia`     | `type === 'public'` の場合 `true`、それ以外 `false` |
| `tag`         | `tagConfig`     | `tag` が存在する場合 `{ tags: [tag], mode: 'or' }`  |
| -             | `label`         | 未設定（`undefined`）                               |

### 変換関数

```typescript
function migrateConfigV1toV2(v1: V1TimelineConfig): TimelineConfigV2 {
  const v2: TimelineConfigV2 = {
    backendFilter: { mode: "all" },
    id: v1.id,
    onlyMedia: v1.type === "public",
    order: v1.order,
    type: v1.type,
    visible: v1.visible,
  };

  // tag → tagConfig 変換
  if (v1.type === "tag" && v1.tag != null && v1.tag.trim() !== "") {
    v2.tagConfig = {
      mode: "or",
      tags: [v1.tag.trim()],
    };
  }

  return v2;
}
```

### onlyMedia の変換理由

V1 では `PublicTimeline` コンポーネントのコード上で `only_media: true` がハードコードされていました。V2 ではこの設定を `TimelineConfigV2.onlyMedia` として明示的に管理するため、`type === 'public'` の場合に `onlyMedia: true` を設定してユーザーの既存体験を維持します。

```
V1: PublicTimeline コンポーネント内で only_media: true がハードコード
  ↓ マイグレーション
V2: config.onlyMedia = true として設定に反映
  → ユーザーが設定 UI で変更可能に
```

### tag → tagConfig の変換理由

V1 では `tag` プロパティに単一のタグ文字列を格納していました。V2 では複数タグの OR / AND 条件をサポートするため、`tagConfig` 構造に変換します。

```
V1: { tag: 'gochisou_photo' }
  ↓ マイグレーション
V2: { tagConfig: { mode: 'or', tags: ['gochisou_photo'] } }
```

- 単一タグは `tags` 配列の 1 要素として格納
- デフォルトのモードは `'or'`（V1 では複数タグの概念がなかったため）
- `tag` が空文字列または `null` / `undefined` の場合、`tagConfig` は設定しない

### 一括変換関数

```typescript
export function migrateV1toV2(v1: V1TimelineSettings): TimelineSettingsV2 {
  const timelines = v1.timelines
    .filter((t): t is V1TimelineConfig => {
      // 最低限の型チェック
      return (
        typeof t === "object" &&
        t != null &&
        typeof t.id === "string" &&
        typeof t.type === "string" &&
        typeof t.visible === "boolean" &&
        typeof t.order === "number"
      );
    })
    .map(migrateConfigV1toV2);

  return {
    timelines,
    version: 2,
  };
}
```

### 部分的に壊れたデータへの対応

`migrateV1toV2()` は V1 データが部分的に壊れている場合、`.filter()` で不正なエントリを除外します。

**型チェック条件:**

1. `typeof t === 'object'` — オブジェクトであること
2. `t != null` — null でないこと
3. `typeof t.id === 'string'` — id が文字列であること
4. `typeof t.type === 'string'` — type が文字列であること
5. `typeof t.visible === 'boolean'` — visible が真偽値であること
6. `typeof t.order === 'number'` — order が数値であること

これらの条件を満たさないエントリは静かに除外され、有効なエントリのみがマイグレーションされます。

```
V1 データ（部分的に壊れている場合）:
  timelines: [
    { id: 'home', type: 'home', visible: true, order: 0 },    ← ✅ 有効
    { id: null, type: 'local', visible: true, order: 1 },      ← ❌ id が null
    "invalid string entry",                                     ← ❌ オブジェクトではない
    { id: 'public', type: 'public', visible: true, order: 3 }, ← ✅ 有効
  ]
  ↓ マイグレーション後
  timelines: [
    { id: 'home', type: 'home', visible: true, order: 0, ... },
    { id: 'public', type: 'public', visible: true, order: 3, ... },
  ]
```

## TimelineProvider での読み込み

### 読み込みフロー

`TimelineProvider` は以下のフローで localStorage から設定を復元します。

```typescript
useEffect(() => {
  const timelineStr = localStorage.getItem("timelineSettings");
  if (timelineStr != null) {
    try {
      const parsed: unknown = JSON.parse(timelineStr);

      if (isV2Settings(parsed)) {
        // V2 形式: そのまま使用
        setTimelineSettings(parsed);
      } else if (isV1Settings(parsed)) {
        // V1 形式: V2 にマイグレーション
        const migrated = migrateV1toV2(parsed);
        console.info("Migrated timeline settings from V1 to V2:", migrated);
        setTimelineSettings(migrated);
      } else {
        // 不明な形式: デフォルト設定を使用
        console.warn(
          "Unknown timeline settings format, using defaults:",
          parsed,
        );
      }
    } catch (error) {
      console.warn(
        "Failed to parse timeline settings from localStorage:",
        error,
      );
    }
  }

  setStorageLoading(false);
}, []);
```

### エラーハンドリング

| エラーケース            | 対応                                      |
| ----------------------- | ----------------------------------------- |
| localStorage が空       | デフォルト設定を使用                      |
| JSON パースエラー       | `console.warn` + デフォルト設定を使用     |
| V1 でも V2 でもない形式 | `console.warn` + デフォルト設定を使用     |
| V1 形式                 | `migrateV1toV2()` で変換 + `console.info` |
| V2 形式                 | そのまま使用                              |

### マイグレーション後の永続化

マイグレーション後の設定は `setTimelineSettings()` で state に反映されます。`TimelineProvider` の別の `useEffect` が state の変更を検知し、自動的に localStorage に書き戻します。

```typescript
useEffect(() => {
  if (storageLoading) return;

  const toSave: TimelineSettings = {
    timelines: timelineSettings.timelines,
    version: 2,
  };
  localStorage.setItem("timelineSettings", JSON.stringify(toSave));
}, [timelineSettings, storageLoading]);
```

**`storageLoading` ガード:** 初回読み込み完了前に state が変更されると、デフォルト設定で localStorage が上書きされてしまうため、`storageLoading` フラグでガードしています。

```
起動時:
  1. storageLoading = true（初期状態）
  2. useEffect で localStorage 読み込み → setTimelineSettings(復元データ)
  3. setStorageLoading(false)
  4. 永続化 useEffect が発火 → localStorage に書き込み（storageLoading === false なので実行される）

↓ 仮に storageLoading ガードがない場合:
  1. setTimelineSettings(defaultSettings) が初期 render で発火
  2. 永続化 useEffect が発火 → localStorage にデフォルト設定を書き込み ❌
  3. localStorage 読み込み → でも既にデフォルト設定で上書き済み ❌
```

## デフォルト設定

localStorage にデータがない場合や、読み込みに失敗した場合に使用されるデフォルト設定です。

```typescript
const initialTimelineSettings: TimelineSettings = {
  timelines: [
    {
      backendFilter: { mode: "all" },
      id: "home",
      order: 0,
      type: "home",
      visible: true,
    },
    {
      backendFilter: { mode: "all" },
      id: "notification",
      order: 1,
      type: "notification",
      visible: true,
    },
    {
      backendFilter: { mode: "all" },
      id: "tag-gochisou_photo",
      onlyMedia: true,
      order: 2,
      tagConfig: {
        mode: "or",
        tags: ["gochisou_photo"],
      },
      type: "tag",
      visible: true,
    },
    {
      backendFilter: { mode: "all" },
      id: "public",
      onlyMedia: true,
      order: 3,
      type: "public",
      visible: true,
    },
  ],
  version: 2,
};
```

### デフォルト設定の特徴

| タイムライン    | 種別           | メディアフィルタ  | 備考             |
| --------------- | -------------- | ----------------- | ---------------- |
| Home            | `home`         | なし              | 全投稿を表示     |
| Notification    | `notification` | なし              | 全通知を表示     |
| #gochisou_photo | `tag`          | `onlyMedia: true` | メディア付きのみ |
| Public          | `public`       | `onlyMedia: true` | メディア付きのみ |

## BackendFilter の正規化

### 概要

`timelineConfigValidator.ts` の `normalizeBackendFilter()` は、登録済みアカウント（`apps`）の変更に追従して `BackendFilter` を正規化します。

### 正規化ルール

```typescript
export function normalizeBackendFilter(
  filter: BackendFilter | undefined,
  apps: App[],
): BackendFilter;
```

| 入力                                 | 条件                     | 出力                                    |
| ------------------------------------ | ------------------------ | --------------------------------------- |
| `undefined`                          | -                        | `{ mode: 'all' }`                       |
| `{ mode: 'all' }`                    | -                        | `{ mode: 'all' }`（そのまま）           |
| `{ mode: 'single', backendUrl }`     | URL が apps に存在       | そのまま返す                            |
| `{ mode: 'single', backendUrl }`     | URL が apps に存在しない | `{ mode: 'all' }` にフォールバック      |
| `{ mode: 'composite', backendUrls }` | 有効 URL が 0 件         | `{ mode: 'all' }` にフォールバック      |
| `{ mode: 'composite', backendUrls }` | 有効 URL が 1 件         | `{ mode: 'single', backendUrl }` に変換 |
| `{ mode: 'composite', backendUrls }` | 有効 URL が 2 件以上     | ソートして正規化                        |

### フォールバックの意図

アカウント削除後に `BackendFilter` が無効な URL を参照し続けると、空のタイムラインが表示されてしまいます。`normalizeBackendFilter()` が自動的に `{ mode: 'all' }` にフォールバックすることで、ユーザーは設定を手動で修正する必要がありません。

```
例: サーバー A のアカウントを削除
  ↓
TimelineConfigV2: { backendFilter: { mode: 'single', backendUrl: 'https://serverA.example' } }
  ↓ normalizeBackendFilter(filter, apps)
  apps に 'https://serverA.example' が存在しない
  ↓
{ mode: 'all' } にフォールバック
  → 残りの全アカウントのタイムラインが表示される
```

### composite モードのソート

```typescript
case 'composite': {
  const filtered = filter.backendUrls.filter((url) =>
    validUrls.includes(url),
  )
  // ...
  // ソートして正規化（同一の URL 組み合わせが異なる順序で保存されることを防ぐ）
  return { backendUrls: [...filtered].sort(), mode: 'composite' }
}
```

URL 配列をソートすることで、`['https://a.example', 'https://b.example']` と `['https://b.example', 'https://a.example']` が同一の設定として扱われます。

## TagConfig の正規化

```typescript
export function normalizeTagConfig(tagConfig: TagConfig): TagConfig {
  return {
    mode: tagConfig.mode,
    tags: Array.from(new Set(tagConfig.tags)),
  };
}
```

### 正規化ルール

- **重複タグの除去**: `Set` を使用して重複したタグを除去
- **mode の維持**: `or` / `and` モードはそのまま維持

```
例:
  { mode: 'or', tags: ['cat', 'dog', 'cat'] }
  ↓ normalizeTagConfig()
  { mode: 'or', tags: ['cat', 'dog'] }
```

## resolveBackendUrls

### 概要

`BackendFilter` から対象の `backendUrl` 配列を解決するヘルパー関数です。

```typescript
export function resolveBackendUrls(
  filter: BackendFilter,
  apps: App[],
): string[];
```

### 解決ルール

| モード      | 結果                                                     |
| ----------- | -------------------------------------------------------- |
| `all`       | `apps.map(app => app.backendUrl)` — 全登録サーバーの URL |
| `single`    | `[filter.backendUrl]` — 指定されたサーバーの URL（1 件） |
| `composite` | `filter.backendUrls` — 指定されたサーバーの URL 群       |

### 使用箇所

`resolveBackendUrls()` は以下の箇所で使用されます。

| 箇所                       | 用途                                 |
| -------------------------- | ------------------------------------ |
| `useFilteredTimeline`      | クエリの `sb.backendUrl IN (?)` 条件 |
| `useFilteredTagTimeline`   | クエリの `sb.backendUrl IN (?)` 条件 |
| `buildFilterConditions`    | ミュート条件の `targetBackendUrls`   |
| `deriveRequiredStreams`    | ストリーム接続先の算出               |
| `UnifiedTimeline.moreLoad` | 追加読み込み対象バックエンドの算出   |
| `StreamingManagerProvider` | 初期データ取得対象バックエンドの算出 |

## Backward-compatible Aliases

型定義レベルでは、旧名称のエイリアスが定義されています。

```typescript
// src/types/types.ts

/** @deprecated TimelineConfigV2 を使用してください */
export type TimelineConfig = TimelineConfigV2;

/** @deprecated TimelineSettingsV2 を使用してください */
export type TimelineSettings = TimelineSettingsV2;
```

これにより、旧名称（`TimelineConfig` / `TimelineSettings`）を使用しているコードも引き続き動作しますが、新規コードでは `TimelineConfigV2` / `TimelineSettingsV2` の使用が推奨されます。

## 将来のマイグレーション対応

### 新バージョン追加時の手順

V3 形式のタイムライン設定が必要になった場合、以下の手順でマイグレーションを追加します。

1. **型定義の追加**: `types.ts` に `TimelineConfigV3` / `TimelineSettingsV3` を定義
2. **型ガードの追加**: `isV3Settings()` を定義（`version === 3`）
3. **マイグレーション関数の追加**: `migrateV2toV3()` を `migrateTimeline.ts` に実装
4. **TimelineProvider の更新**: 判定フローに V3 チェックを追加
5. **永続化の更新**: `version: 3` で保存するように変更
6. **エイリアスの更新**: `TimelineConfig = TimelineConfigV3` に変更

```typescript
// 将来の判定フロー（例）
if (isV3Settings(parsed)) {
  setTimelineSettings(parsed);
} else if (isV2Settings(parsed)) {
  const migrated = migrateV2toV3(parsed);
  setTimelineSettings(migrated);
} else if (isV1Settings(parsed)) {
  const migratedV2 = migrateV1toV2(parsed);
  const migratedV3 = migrateV2toV3(migratedV2);
  setTimelineSettings(migratedV3);
}
```

### 段階的マイグレーション

V1 → V3 への直接変換関数は作成せず、V1 → V2 → V3 と段階的にマイグレーションを適用します。

**メリット:**

- 各マイグレーション関数が単一の責務を持つ
- テストが容易
- 中間バージョンのデータ整合性が保証される

**デメリット:**

- V1 から最新バージョンへの変換にオーバーヘッドがある（実用上は無視できるレベル）

## SQLite スキーママイグレーションとの違い

タイムライン設定のマイグレーション（本ドキュメント）と SQLite スキーママイグレーション（[03-data-storage.md](./03-data-storage.md)）は独立したシステムです。

| 項目           | タイムライン設定マイグレーション     | SQLite スキーママイグレーション    |
| -------------- | ------------------------------------ | ---------------------------------- |
| 対象           | `TimelineSettingsV2`（localStorage） | SQLite のテーブル構造              |
| バージョン管理 | `version` プロパティ                 | `PRAGMA user_version`              |
| 実行タイミング | `TimelineProvider` の初回 render     | `ensureSchema()` の呼び出し時      |
| ロールバック   | なし（常に最新バージョンに変換）     | なし                               |
| データ量       | 数 KB（設定のみ）                    | 数 MB〜（投稿データ）              |
| 実行時間       | 即座（ミリ秒単位）                   | データ量に依存（バックフィル処理） |
