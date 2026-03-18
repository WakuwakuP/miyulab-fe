# 09. マイグレーションと進化

## スキーマバージョニング

### バージョン管理方式

SQLite の `PRAGMA user_version` を使用してスキーマバージョンを管理する。

```sql
PRAGMA user_version;  -- 現在のバージョンを取得
PRAGMA user_version = 20;  -- バージョンを更新
```

現在のバージョン: **v20**

### マイグレーションの実行

`schema.ts` がアプリ起動時にバージョンを確認し、必要なマイグレーションを順次適用する。

```typescript
// 新規インストール: v19 スキーマを直接作成 → v20 マイグレーション
// 既存環境: 現在バージョンから v20 まで順次マイグレーション
const currentVersion = db.pragma('user_version')

if (currentVersion === 0) {
  createV19Schema(db)  // 最新に近いスキーマを直接作成
}

// 段階的マイグレーション
if (currentVersion < 20) migrateV19ToV20(db)
```

**設計判断**: 新規インストール時に v1 から全マイグレーションを実行するのは非効率かつ壊れやすい。最新に近い v19 スキーマを直接作成し、最後のマイグレーションのみ適用する。

## スキーマ進化の歴史

### 初期段階（v1〜v7）: Dexie から SQLite への移行

| バージョン | 変更内容 |
|-----------|---------|
| v1 | Dexie（IndexedDB）ベースの初期スキーマ。compositeKey による PK |
| v2 | ミュートアカウント・ブロックインスタンステーブル追加 |
| v3〜v5 | インデックス追加、カラム追加 |
| v6 | マテリアライズドビュー（`timeline_entries`, `tag_entries`）導入 |
| v7 | トリガーによるマテリアライズドビュー自動同期 |

**転換点**: v6〜v7 でマテリアライズドビューを導入。タイムラインクエリの性能を大幅に改善。

### 正規化段階（v8〜v13）: データモデルの正規化

| バージョン | 変更内容 |
|-----------|---------|
| v8 | マスタテーブル群の導入（servers, visibility_types, notification_types, media_types, engagement_types, channel_kinds, timeline_item_kinds）。`post_id INTEGER PRIMARY KEY` に変更 |
| v9 | `profiles` テーブル導入。投稿者情報を正規化。`profile_aliases` でクロスサーバー名寄せ |
| v10 | コンテンツ関連テーブル追加（post_stats, post_media, hashtags, polls, link_cards） |
| v11 | `post_engagements` テーブル追加。ユーザーアクション追跡 |
| v12 | 旧マテリアライズドビュー削除、インデックス最適化 |
| v13 | JSON カラム依存の完全撤廃。全データを正規化カラムで保持 |

**転換点**: v8 で INTEGER PK に変更し、マスタテーブルを導入。v13 で JSON カラムへの依存を完全に排除し、全フィルタを SQL カラムで実行可能に。

### 統合段階（v14〜v20）: タイムライン管理の高度化

| バージョン | 変更内容 |
|-----------|---------|
| v14〜v17 | コンテンツモデルの改善（カスタム絵文字、リンクカード同期、ハッシュタグ同期） |
| v18 | `timelines`, `timeline_items`, `feed_events` テーブル導入。投稿のタイムライン所属を正規化 |
| v19 | チャネルインフラの最適化 |
| v20 | 現在の本番スキーマ |

**転換点**: v18 で `timeline_items` テーブルを導入し、投稿がどのタイムライン（ホーム/ローカル/パブリック）に属するかを正規化。2 フェーズクエリの Phase 1 で `timeline_items` + `timelines` + `channel_kinds` を JOIN する基盤が整った。

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
- 複雑なフィルタ条件（可視性 AND 言語 AND メディア AND ミュート除外）を IndexedDB のクエリで表現できない
- SQL なら WHERE 句でフィルタを宣言的に組み合わせられ、インデックスも効く

**結果**: schema.ts の 3,800 行超のスキーマ定義が示すように、複雑なデータモデルを SQL で管理する方針が確立された。

### JSON カラム → 完全正規化

**背景**: 初期は投稿の JSON 全体を `json` カラムに保持し、必要に応じてパースしていた。

**移行理由**:
- JSON の中身でフィルタするにはパースが必要で、インデックスが効かない
- `has_media`, `is_reblog` 等を非正規化カラムとして持てばインデックスで高速フィルタ可能
- v13 で JSON 依存を完全排除し、すべてのフィルタがカラムベースに

### マテリアライズドビューの導入と改善

**背景**: `posts_timeline_types` テーブルを毎回 JOIN するとクエリが複雑化。

**v6 で導入**: `timeline_entries` テーブルをマテリアライズドビューとして追加。頻出フィールドを非正規化。

**v12 で旧ビュー削除**: `timeline_items` + `timelines` テーブルの導入（v18）により、より柔軟な構造に置き換え。

### timeline_items テーブルの導入

**背景**: `posts_timeline_types` は投稿とタイムラインタイプの関連のみを保持していた。

**v18 で導入**: `timelines` テーブル（サーバ × チャネル種別 × タグ）と `timeline_items` テーブル（タイムライン × アイテム）に分離。

**利点**:
- タイムラインの概念を一級市民として扱える
- `sort_key` を持ち、ソート順をカスタマイズ可能
- 通知も同じ `timeline_items` で管理（`timeline_item_kind_id`）
- 将来的にブックマークや会話など新しいチャネル種別を追加しやすい
