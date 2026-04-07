# Fediverseドメイン概念

miyulab-fe が扱う Fediverse の基本概念と、本プロジェクトにおける実装上のモデルを解説する。

---

## 1. Fediverse と ActivityPub の基本

Fediverse（Federated Universe）は、ActivityPub プロトコルで相互接続された分散型 SNS の総称である。

### ActivityPub の3つの基本概念

| 概念 | 説明 | miyulab-fe での対応 |
|------|------|---------------------|
| **Actor** | ユーザーやボットなど、行為の主体。固有の URI を持つ | `Entity.Account` / DB `profiles` テーブル |
| **Object** | 投稿・画像・投票など、コンテンツの実体 | `Entity.Status` / DB `posts` テーブル |
| **Activity** | 「いいね」「フォロー」「ブースト」などの行為 | `Entity.Notification` / DB `notifications` テーブル |

### object_uri — 投稿の一意識別子

ActivityPub では、すべての Object に グローバルに一意な URI（通常は HTTPS URL）が割り当てられる。miyulab-fe では、これを `object_uri` としてローカル SQLite に保存し、**異なるアカウント・異なるサーバー経由で取得した同一投稿の重複排除（deduplication）** に使用している。

```sql
-- src/util/db/sqlite/schema/tables/posts.ts
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  object_uri   TEXT NOT NULL DEFAULT '',  -- ActivityPub ID（グローバル一意）
  ...
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_object_uri
  ON posts(object_uri) WHERE object_uri != '';
```

> **ソース**: `src/util/db/sqlite/schema/tables/posts.ts`

同様に、プロフィールにも `actor_uri`（Actor の ActivityPub URI）が保存される。

```sql
-- src/util/db/sqlite/schema/tables/profiles.ts
CREATE TABLE IF NOT EXISTS profiles (
  ...
  actor_uri TEXT,  -- Actor の ActivityPub URI
  acct      TEXT NOT NULL,
  ...
);
```

> **ソース**: `src/util/db/sqlite/schema/tables/profiles.ts`

---

## 2. サポート対象バックエンド

miyulab-fe は 7 種類の Fediverse バックエンドをサポートする。

```typescript
// src/types/types.ts
export const backendList = [
  'mastodon',
  'pleroma',
  'friendica',
  'firefish',
  'gotosocial',
  'pixelfed',
  'misskey',
] as const

export type Backend = (typeof backendList)[number]
```

> **ソース**: `src/types/types.ts` L11-21

### 各バックエンドの概要と実装上の差異

| バックエンド | 概要 | API 互換性 | 本実装での特記事項 |
|-------------|------|-----------|-------------------|
| **Mastodon** | Fediverse の代表的実装。Ruby on Rails 製 | 基準（Mastodon API） | megalodon がネイティブサポート。基準となる API |
| **Pleroma** | Elixir 製の軽量実装 | Mastodon API 互換 + 独自拡張 | カスタム絵文字リアクション（`emoji_reaction`）をサポート |
| **Friendica** | PHP 製。Facebook 的な UI を持つ | Mastodon API 互換 | megalodon 経由で接続 |
| **Firefish** | Misskey フォーク。旧 Calckey | Mastodon API 互換 | megalodon 経由で接続 |
| **GoToSocial** | Go 製の軽量実装 | Mastodon API 互換（一部制限あり） | megalodon 経由で接続 |
| **Pixelfed** | 画像特化型 SNS（Instagram 的） | Mastodon API 互換 | megalodon 経由で接続 |
| **Misskey** | Node.js 製。独自 API 体系 | **非互換**（独自 JSON-RPC API） | カスタム `MisskeyAdapter` で対応 |

### クライアント生成の分岐

```typescript
// src/util/GetClient.ts
export const GetClient = (app: App): MegalodonInterface => {
  const { backend, backendUrl, tokenData } = app
  if (backend === 'misskey') {
    return new MisskeyAdapter(backendUrl, tokenData?.access_token)
  }
  return generator(backend, backendUrl, tokenData?.access_token)
}
```

Misskey 以外の 6 バックエンドは megalodon の `generator()` で統一的にクライアントを生成する。Misskey のみ、独自の `MisskeyAdapter` クラスを使用する。

> **ソース**: `src/util/GetClient.ts`

---

## 3. Megalodon ライブラリ

[megalodon](https://github.com/h3poteto/megalodon) は、複数の Fediverse バックエンドに対する統一的な TypeScript クライアントライブラリである。

- **バージョン**: `^10.2.4`（`package.json` より）
- **提供する抽象化**: `MegalodonInterface` として API メソッドを統一し、`Entity` 名前空間でレスポンス型を定義

### Megalodon が提供する主要な型

| 型 | 説明 |
|----|------|
| `Entity.Status` | 投稿（トゥート/ノート）。content, visibility, reblog, media 等を含む |
| `Entity.Account` | ユーザーアカウント。acct, display_name, avatar 等を含む |
| `Entity.Notification` | 通知。type, account, status を含む |
| `Entity.Reaction` | 絵文字リアクション。name, count, url を含む |
| `Entity.Attachment` | メディア添付。type, url, preview_url を含む |
| `Entity.Poll` | 投票。options, votes_count, expired を含む |
| `MegalodonInterface` | API クライアントのインターフェース。全バックエンドで共通 |
| `WebSocketInterface` | ストリーミング接続のインターフェース |
| `OAuth.AppData` | アプリ登録データ |
| `OAuth.TokenData` | アクセストークンデータ |

miyulab-fe では、これらの megalodon 型に `appIndex`（どのローカルアカウント由来かを示すインデックス）を付加した拡張型を使用する。

```typescript
// src/types/types.ts
export type StatusAddAppIndex = Entity.Status & { appIndex: number }
export type NotificationAddAppIndex = Entity.Notification & { appIndex: number }
export type AccountAddAppIndex = Entity.Account & { appIndex: number }
```

> **ソース**: `src/types/types.ts` L23-37

---

## 4. MisskeyAdapter

### なぜカスタムアダプターが必要か

Misskey は Mastodon API と**互換性のない独自 API** を持つ。主な違い:

1. **JSON-RPC 形式の API**: RESTful ではなく、すべてのエンドポイントが `POST` メソッドで JSON ボディを送信する
2. **独自認証方式（MiAuth）**: OAuth 2.0 ではなく、セッションベースの独自認証フローを使用
3. **独自ストリーミング API**: 1 本の WebSocket 接続で複数チャンネルを多重化する方式
4. **用語の違い**: Status→Note、Reblog→Renote、Favourite→Reaction、Account→User 等
5. **Visibility の命名差異**: `unlisted`→`home`、`private`→`followers`、`direct`→`specified`

### アーキテクチャ

`MisskeyAdapter` は megalodon の `MegalodonInterface` を実装し、内部で `misskey-js` ライブラリを使用して Misskey API を呼び出す。レスポンスは megalodon の `Entity` 型にマッピングされるため、アプリケーション側は**バックエンドの違いを意識せずに統一的にデータを扱える**。

```
MisskeyAdapter (implements MegalodonInterface)
├── accountOperations.ts   — ユーザー操作（認証、プロフィール取得等）
├── auth.ts                — MiAuth 認証フロー
├── helpers.ts             — 共通ユーティリティ（レスポンスラッパー等）
├── instanceOperations.ts  — インスタンス情報取得
├── mappers.ts             — Misskey→megalodon 型変換（中核）
├── mfmRenderer.ts         — MFM（Misskey Flavored Markdown）→HTML 変換
├── notificationOperations.ts — 通知操作
├── statusOperations.ts    — 投稿 CRUD・リアクション操作
├── streamingOperations.ts — ストリーミング接続
├── timelineOperations.ts  — タイムライン取得
├── MisskeyWebSocketAdapter.ts — WebSocket アダプター
└── MisskeyStreamPool.ts   — WebSocket 接続プール
```

> **ソース**: `src/util/misskey/` ディレクトリ全体

### MiAuth 認証フロー

Misskey は OAuth 2.0 の代わりに MiAuth を使用する。`auth.ts` で実装:

1. セッション ID を `crypto.randomUUID()` で生成
2. `{origin}/miauth/{sessionId}?name=...&callback=...&permission=...` にリダイレクト
3. ユーザーが認可後、`{origin}/api/miauth/{sessionId}/check` でトークンを取得
4. 取得したトークンを `OAuth.TokenData` 互換オブジェクトにラップして返却

> **ソース**: `src/util/misskey/auth.ts`

### Misskey ストリーミングの特殊性

Misskey のストリーミング API は、1 本の WebSocket 接続で複数のチャンネル（`homeTimeline`、`localTimeline`、`globalTimeline`、`hashtag`、`main`）を多重化できる。

`MisskeyWebSocketAdapter` は:
- `MisskeyStreamPool` から共有 Stream を取得（参照カウント管理）
- チャンネルの購読/解除のみを担当
- `misskey-js` のイベント（`note`、`notification`）を megalodon の `WebSocketInterface` イベント（`update`、`notification`）に変換

```typescript
// misskey-js のイベント → megalodon イベントへの変換
// channel.on('note', Note)    → this.emit('update', Entity.Status)
// main.on('notification', ..) → this.emit('notification', Entity.Notification)
```

> **ソース**: `src/util/misskey/MisskeyWebSocketAdapter.ts`

---

## 5. エンティティモデル

### Status（投稿）

Fediverse における投稿の単位。Mastodon では「Toot」、Misskey では「Note」と呼ばれる。

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | `string` | バックエンド固有の投稿 ID |
| `uri` | `string` | ActivityPub URI（object_uri に対応） |
| `content` | `string` | HTML 形式の投稿本文 |
| `visibility` | `StatusVisibility` | 公開範囲（後述） |
| `reblog` | `Status \| null` | リブログ元の投稿 |
| `quote` | `object \| null` | 引用投稿（`quoted_status` + `state`） |
| `media_attachments` | `Attachment[]` | 添付メディア |
| `poll` | `Poll \| null` | 投票 |
| `spoiler_text` | `string` | CW（Content Warning）テキスト |
| `sensitive` | `boolean` | センシティブフラグ |
| `emoji_reactions` | `Reaction[]` | カスタム絵文字リアクション |
| `favourited` | `boolean \| null` | 自分がお気に入りしたか |
| `reblogged` | `boolean \| null` | 自分がリブログしたか |
| `bookmarked` | `boolean` | 自分がブックマークしたか |
| `created_at` | `string` | 投稿日時 |
| `edited_at` | `string \| null` | 編集日時 |

DB スキーマでは `posts` テーブルに格納され、`post_stats`（統計情報）、`post_interactions`（自分のインタラクション状態）、`post_backend_ids`（バックエンド固有 ID）テーブルに分離されている。

> **ソース**: `src/util/misskey/mappers.ts` L295-393、`src/util/db/sqlite/schema/tables/posts.ts`

### Account（アカウント/プロフィール）

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | `string` | バックエンド固有のアカウント ID |
| `acct` | `string` | アカウント識別子（例: `user@mastodon.social`、ローカルは `user`） |
| `username` | `string` | ユーザー名 |
| `display_name` | `string` | 表示名 |
| `avatar` | `string` | アバター画像 URL |
| `note` | `string` | 自己紹介文（bio） |
| `url` | `string` | プロフィールページ URL |
| `locked` | `boolean` | フォロー承認制か |
| `bot` | `boolean \| null` | ボットフラグ |
| `fields` | `Field[]` | カスタムフィールド（名前:値のペア） |
| `followers_count` | `number` | フォロワー数 |
| `following_count` | `number` | フォロー数 |
| `statuses_count` | `number` | 投稿数 |

DB スキーマでは `profiles` テーブルに格納され、`profile_stats`（統計情報）、`profile_fields`（カスタムフィールド）、`profile_custom_emojis`（カスタム絵文字）テーブルに分離されている。

> **ソース**: `src/util/misskey/mappers.ts` L150-215、`src/util/db/sqlite/schema/tables/profiles.ts`

### Notification（通知）

DB の `notification_types` テーブルに定義された通知種別:

| ID | 名前 | 説明 |
|----|------|------|
| 1 | `follow` | フォローされた |
| 2 | `favourite` | お気に入りされた |
| 3 | `reblog` | リブログされた |
| 4 | `mention` | メンションされた |
| 5 | `emoji_reaction` | 絵文字リアクションを受けた |
| 6 | `follow_request` | フォローリクエストを受けた |
| 7 | `status` | フォローしているユーザーが投稿した |
| 8 | `poll_vote` | 投票に投票があった |
| 9 | `poll_expired` | 投票が終了した |
| 10 | `update` | 投稿が編集された |

Misskey の通知タイプは mappers.ts の `mapNotificationType()` で変換される:

```
Misskey           → megalodon
─────────────────────────────
follow            → follow
receiveFollowRequest → follow_request
mention / reply   → mention
renote / quote    → reblog
reaction          → emoji_reaction
pollEnded / pollVoted → poll
note              → status
```

> **ソース**: `src/util/db/sqlite/schema/tables/lookup.ts` L55-76、`src/util/misskey/mappers.ts` L399-427

### Reaction（リアクション）

Mastodon の Favourite が単純なお気に入りボタンであるのに対し、Misskey と Pleroma はカスタム絵文字リアクションをサポートする。

```typescript
// Entity.Reaction の構造
{
  name: string       // 絵文字名（例: ':smile:' またはUnicode絵文字）
  count: number      // リアクション数
  me: boolean        // 自分がリアクションしたか
  url?: string       // カスタム絵文字の画像URL
  static_url?: string
  accounts: Account[] // リアクションしたアカウント一覧
}
```

Misskey のカスタム絵文字リアクションには命名の特殊性がある:
- ローカル絵文字: `:name@.:` 形式（`@.` はローカルを意味する）
- リモート絵文字: `:name@host:` 形式
- Unicode 絵文字: そのまま

`mappers.ts` の `normalizeReaction()` がこれらを正規化し、絵文字 URL を解決する。

> **ソース**: `src/util/misskey/mappers.ts` L227-289、`src/util/db/sqlite/schema/tables/interactions.ts`

---

## 6. Visibility（公開範囲）

### 定義

```typescript
// src/types/types.ts
export type VisibilityType = 'public' | 'unlisted' | 'private' | 'direct'
```

DB の `visibility_types` テーブルには 5 つの公開範囲が定義されている:

```sql
-- src/util/db/sqlite/schema/tables/lookup.ts
INSERT OR IGNORE INTO visibility_types (id, name) VALUES
  (1, 'public'), (2, 'unlisted'), (3, 'private'), (4, 'direct'), (5, 'local');
```

| ID | 名前 | 説明 |
|----|------|------|
| 1 | `public` | 公開 — 連合タイムライン・ローカルタイムラインに表示される |
| 2 | `unlisted` | 未収載 — プロフィールには表示されるが、タイムラインには非表示 |
| 3 | `private` | フォロワー限定 — フォロワーのみが閲覧可能 |
| 4 | `direct` | ダイレクトメッセージ — 指定されたユーザーのみが閲覧可能 |
| 5 | `local` | ローカル限定 — 同一インスタンス内のみ（Misskey 固有） |

> **ソース**: `src/types/types.ts` L51、`src/util/db/sqlite/schema/tables/lookup.ts` L46-48

### Misskey との Visibility マッピング

Misskey は独自の Visibility 命名を使用する。`mappers.ts` で双方向変換を行う:

| Mastodon / megalodon | Misskey |
|---------------------|---------|
| `public` | `public` |
| `unlisted` | `home` |
| `private` | `followers` |
| `direct` | `specified` |

```typescript
// src/util/misskey/mappers.ts
export function mapVisibility(
  v: 'public' | 'home' | 'followers' | 'specified',
): Entity.StatusVisibility { ... }

export function mapVisibilityToMisskey(
  v: string,
): 'public' | 'home' | 'followers' | 'specified' { ... }
```

> **ソース**: `src/util/misskey/mappers.ts` L60-90

### `local` Visibility（Misskey 固有）

DB スキーマの `visibility_types` テーブルに `local`（ID: 5）が存在する。これは Misskey の「ローカル限定」投稿に対応し、同一インスタンス内のユーザーにのみ表示される。`posts` テーブルの `is_local_only` カラムでもこのフラグが管理される。

---

## 7. 用語集

Fediverse では、バックエンドによって同じ概念に異なる名称が使われる。

| 概念 | Mastodon | Misskey | miyulab-fe（内部） | 説明 |
|------|----------|---------|-------------------|------|
| **投稿** | Toot / Status | Note | `Entity.Status` / `posts` テーブル | ユーザーが作成するテキスト・メディアの投稿 |
| **リブログ** | Reblog / Boost | Renote | `reblog` フィールド / `reblog_of_post_id` | 他人の投稿を自分のフォロワーに共有する行為 |
| **お気に入り** | Favourite / Like | Reaction（❤️） | `favourited` フィールド / `is_favourited` | 投稿に対する肯定的リアクション。Misskey では `notes/reactions/create` でデフォルト ❤️ を付与 |
| **リアクション** | ―（Pleroma は対応） | Reaction | `emoji_reactions` / `post_emoji_reactions` テーブル | カスタム絵文字によるリアクション。Misskey と Pleroma が対応 |
| **ブックマーク** | Bookmark | Favorite（お気に入り） | `bookmarked` / `is_bookmarked` | 投稿を非公開で保存。Misskey では `notes/favorites` API に対応 |
| **CW** | Content Warning | CW | `spoiler_text` / `spoiler_text` カラム | 投稿本文を折りたたんで警告テキストを表示する機能 |
| **インスタンス** | Instance / Server | Instance / Server | `servers` テーブル | Fediverse を構成する個々のサーバー |
| **引用** | ―（一部対応） | Quote (Renote with text) | `quote` フィールド / `quote_of_post_id` | 他人の投稿を引用して自分のテキストを添える。`quote_state` で状態管理 |
| **MFM** | ― | Misskey Flavored Markdown | `mfmRenderer.ts` で HTML に変換 | Misskey 独自のテキスト装飾記法 |
| **acct** | 共通 | 共通 | `acct` カラム | `username@domain` 形式のアカウント識別子。ローカルユーザーは `username` のみ |

---

## 次に読むべきドキュメント

- **[02-multi-account.md](./02-multi-account.md)** — マルチアカウント管理の設計と実装
