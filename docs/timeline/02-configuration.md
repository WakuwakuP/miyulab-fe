# 02. 設定モデル

## TimelineConfigV2

タイムラインの設定は `TimelineConfigV2` 型で表現される。1 つのタイムラインカラムが 1 つの `TimelineConfigV2` に対応する。

### 基本プロパティ

```typescript
type TimelineConfigV2 = {
  id: string              // 一意な識別子
  type: TimelineType      // 'home' | 'local' | 'public' | 'notification' | 'tag'
  visible: boolean        // 表示/非表示トグル
  order: number           // 表示順（0起点、昇順）
  label?: string          // カスタム表示名（未設定時は自動生成）
  tabGroup?: string       // タブグループID（同じ値のタイムラインがタブ化）
}
```

### バックエンドフィルタ

どのサーバのデータを表示するかを制御する。

```typescript
type BackendFilter =
  | { mode: 'all' }                              // 全バックエンド
  | { mode: 'single', backendUrl: string }        // 単一バックエンド
  | { mode: 'composite', backendUrls: string[] }  // 複数選択
```

**設計判断**: `mode` フィールドによる判別共用体（discriminated union）を採用。`'all'` は URL 配列を持たないため、3 つのケースを明確に分離する。

### コンテンツフィルタ

```typescript
{
  // メディア
  onlyMedia?: boolean          // メディア付き投稿のみ
  minMediaCount?: number       // 最低メディア数

  // 可視性
  visibilityFilter?: VisibilityType[]   // 'public' | 'unlisted' | 'private' | 'direct'

  // 言語
  languageFilter?: string[]    // ISO 639-1 言語コード

  // 除外フィルタ
  excludeReblogs?: boolean     // ブースト除外
  excludeReplies?: boolean     // リプライ除外
  excludeSpoiler?: boolean     // CW付き除外
  excludeSensitive?: boolean   // センシティブ除外

  // アカウントフィルタ
  accountFilter?: AccountFilter  // { mode: 'include' | 'exclude', accts: string[] }

  // ミュート・ブロック
  applyMuteFilter?: boolean    // ミュートアカウント適用（デフォルト: true）
  applyInstanceBlock?: boolean // ブロックインスタンス適用（デフォルト: true）

  // フォロー
  followsOnly?: boolean        // フォロー中のアカウントのみ
}
```

### タグ設定

`type: 'tag'` のタイムラインで使用。

```typescript
type TagConfig = {
  mode: 'or' | 'and'   // OR: いずれかのタグ / AND: すべてのタグ
  tags: string[]        // ハッシュタグ名（#なし）
}
```

- **OR モード**: `WHERE tag IN ('tag1', 'tag2')` + `DISTINCT`
- **AND モード**: `HAVING COUNT(DISTINCT tag) = タグ数`

### 通知フィルタ

`type: 'notification'` のタイムラインで使用。

```typescript
type NotificationType =
  | 'follow' | 'follow_request' | 'mention' | 'reblog'
  | 'favourite' | 'reaction' | 'poll_expired' | 'status'
```

### タイムラインタイプフィルタ

home/local/public を複数指定して 1 つのタイムラインに統合できる。

```typescript
{
  timelineTypes?: StatusTimelineType[]  // ['home', 'local', 'public'] の部分集合
}
```

### Advanced Query

パワーユーザー向け。カスタム SQL WHERE 句を直接記述する。

```typescript
{
  advancedQuery?: boolean   // Advanced Query モード有効化
  customQuery?: string      // SQL WHERE 句
}
```

**安全対策**: `useCustomQueryTimeline` がサニタイズ処理を行い、DML/DDL を禁止、セミコロン除去、LIMIT/OFFSET/コメント削除を行う。

## TimelineSettings

タイムライン設定全体のコンテナ。

```typescript
type TimelineSettings = {
  timelines: TimelineConfigV2[]
  version: 2
}
```

`version: 2` はマイグレーション識別子。`migrateTimeline.ts` の `isV2Settings()` で判定する。

## 永続化

### localStorage への保存

`TimelineProvider` が `TimelineSettings` を `localStorage` の `'timelineSettings'` キーに JSON シリアライズして保存する。

```
localStorage
  ├── 'apps'              ← App[] (OAuth認証情報)
  ├── 'timelineSettings'  ← TimelineSettings (タイムライン設定)
  ├── 'setting'           ← SettingData (アプリ設定)
  └── ...
```

### 読み込み時のクリーンアップ

`TimelineProvider` は読み込み時に以下の処理を行う：

1. **customQuery の除去**: `advancedQuery: false` のタイムラインから `customQuery` を削除。UI モードに切り替えた際のゴミデータを防ぐ。
2. **V2 フォーマット検証**: `isV2Settings()` で version フィールドを確認。

### デフォルトタイムライン

初回起動時（設定未保存時）のデフォルト構成：

| type | label | 特徴 |
|------|-------|------|
| `home` | ホーム | デフォルト設定 |
| `notification` | 通知 | デフォルト設定 |
| `tag` | ごちそうフォト | `tagConfig: { mode: 'or', tags: ['ごちそうフォト'] }` |
| `public` | パブリック(メディア) | `onlyMedia: true` |

## 表示名の自動生成

`timelineDisplayName.ts` がフィルタ設定に応じて表示名を自動生成する。

**基本名**: type に基づく（ホーム / ローカル / パブリック / 通知 / タグ名）

**サフィックス（最大4つ + 省略記号）**:
- 📷 メディアフィルタ
- 🌐🔒🔓✉️ 可視性フィルタ
- 🌍 言語フィルタ
- 🚫 除外フィルタ
- ⭐👤💬🔁📝📊😀 通知タイプフィルタ

例: `パブリック 📷🌐` → メディア付きの public 可視性のみ

## 設定バリデーション

`timelineConfigValidator.ts` が設定の正規化を行う。

| 関数 | 処理 |
|------|------|
| `normalizeBackendFilter` | 存在しない backendUrl を除去 |
| `normalizeTagConfig` | 重複タグを除去 |
| `resolveBackendUrls` | BackendFilter を実際の URL 配列に展開 |

## タブグループ

`tabGroup` プロパティが同じ値のタイムラインは、`TabbedTimeline` により 1 つのカラム内でタブ切り替え可能になる。

```typescript
// 例: 2つのタイムラインを "main" グループに
{ id: 'a', type: 'home', tabGroup: 'main', ... }
{ id: 'b', type: 'local', tabGroup: 'main', ... }
```

**挙動**:
- タブバーでタイムラインを切り替え
- 矢印キーによるキーボードナビゲーション
- 非アクティブなタブのタイムラインも DOM 上に維持（hidden）→ データ取得は継続
