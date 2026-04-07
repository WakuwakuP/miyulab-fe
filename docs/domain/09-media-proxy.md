# メディアプロキシ

miyulab-fe は、Fediverse インスタンスから取得したメディア（画像・動画・音声）をブラウザに表示するために、Next.js API Route によるメディアプロキシを提供している。

---

## 1. メディアプロキシが必要な理由

### CORS 制約

ブラウザからリモート Fediverse インスタンスのメディアを直接取得すると、多くのサーバーが `Access-Control-Allow-Origin` ヘッダーを返さないため CORS エラーが発生する。プロキシを経由することで、すべてのメディアが同一オリジン（`/api/attachment/...`）から配信され、CORS 問題を回避できる。

### プライバシー保護

プロキシがリモートサーバーへリクエストを行う際、User-Agent を `miyulab-fe/1.0` に固定している（`route.ts` 59行目）。これにより、エンドユーザーのブラウザ情報がリモートサーバーに漏洩することを防ぐ。

### キャッシュ最適化

サーバーサイドで `force-cache` によりフェッチ結果をキャッシュし、クライアントには `immutable` な長期キャッシュヘッダーを返すことで、同一メディアへの重複リクエストを大幅に削減する。

---

## 2. API ルート実装

### ファイル構成

```
src/app/api/attachment/[...path]/route.ts
```

Next.js の Catch-all Dynamic Route（`[...path]`）を使用し、任意の深さのパスセグメントを受け取る。

### URL 構築ルール

クライアント側のリクエスト URL がそのままリモートサーバーの URL に変換される:

```
/api/attachment/{domain}/{path}?{query}
  ↓
https://{domain}/{path}?{query}
```

**例:**

| クライアントリクエスト | 転送先 |
|---|---|
| `/api/attachment/pl.waku.dev/media/abc.jpg` | `https://pl.waku.dev/media/abc.jpg` |
| `/api/attachment/files.mastodon.social/media/img.png?name=sm` | `https://files.mastodon.social/media/img.png?name=sm` |

### リクエスト処理フロー

```
ブラウザ
  │
  ├─ GET /api/attachment/{domain}/{path}
  │
  ▼
route.ts (Next.js API Route)
  │
  ├─ 1. Referer / Origin ヘッダー検証
  │     ├─ 両方なし → 直接アクセス（新しいタブ）として許可
  │     └─ あり → 許可ドメインリストと照合
  │
  ├─ 2. path パラメータを結合し https:// URL を構築
  │     クエリパラメータも元のリクエストから引き継ぐ
  │
  ├─ 3. URL 妥当性チェック（new URL() でパース）
  │
  ├─ 4. リモートサーバーへ fetch
  │     ├─ cache: 'force-cache'
  │     └─ User-Agent: 'miyulab-fe/1.0'
  │
  ├─ 5. レスポンスヘッダーを設定して返却
  │     ├─ Cache-Control: public, max-age=31536000, immutable
  │     ├─ Content-Disposition: inline
  │     ├─ Content-Length
  │     └─ Content-Type（元サーバーの値を転送）
  │
  └─ エラー時: 適切な HTTP ステータスコードを返却
```

### Next.js ISR 設定

```typescript
export const revalidate = 14400 // 4時間
```

Next.js のサーバーサイドキャッシュが 4 時間で再検証される。これにより、メディアが更新された場合でも最大 4 時間で反映される。

---

## 3. セキュリティチェック

### Referer / Origin 検証

不正なサイトからのプロキシ悪用を防ぐため、`Referer` または `Origin` ヘッダーを検証する。

**許可ドメインリスト（Vercel 環境変数から自動取得）:**

```typescript
const allowedDomains = [
  process.env.VERCEL_URL,              // デプロイメントURL
  process.env.VERCEL_BRANCH_URL,       // ブランチURL
  process.env.VERCEL_PROJECT_PRODUCTION_URL, // 本番URL
].filter((domain): domain is string => !!domain)
```

### 判定ロジック

| Referer | Origin | 判定 |
|---|---|---|
| なし | なし | **許可** — ブラウザの新しいタブで直接開いた場合 |
| 許可ドメイン含む | — | **許可** |
| — | 許可ドメイン含む | **許可** |
| 不一致 | 不一致 | **403 Forbidden** |

新しいタブでの直接アクセス（`Referer` も `Origin` もないケース）を許可しているのは、ユーザーが画像を新しいタブで開いたときに正常に表示させるため。

### エラーレスポンス

| ステータスコード | 条件 |
|---|---|
| 400 | パスが空、または URL が不正 |
| 403 | 許可されていないドメインからのリクエスト |
| 500 | サーバー内部エラー |
| リモートのステータス | リモートサーバーからのエラー（404 等）をそのまま転送 |

---

## 4. キャッシュ戦略

メディアプロキシのキャッシュは **2 層構成** になっている:

### サーバーサイドキャッシュ（リモートへの fetch）

```typescript
await fetch(imageUrl, {
  cache: 'force-cache',
  headers: { 'User-Agent': 'miyulab-fe/1.0' },
})
```

- `force-cache`: Node.js / Vercel のサーバーサイドキャッシュを最大限利用
- `revalidate = 14400`: ISR により 4 時間ごとに再検証

### クライアントサイドキャッシュ（ブラウザへのレスポンス）

```typescript
'Cache-Control': 'public, max-age=31536000, immutable'
```

| ディレクティブ | 意味 |
|---|---|
| `public` | CDN・共有キャッシュでもキャッシュ可能 |
| `max-age=31536000` | 1 年間（365 日）キャッシュ有効 |
| `immutable` | キャッシュ期間内は再検証リクエストを送信しない |

Fediverse のメディア URL は通常コンテンツのハッシュを含むため変更されることがなく、`immutable` フラグによる積極的なキャッシュが安全に機能する。

---

## 5. メディア表示の全体フロー

### データフロー概要

```
Fediverse Server (Mastodon / Pleroma 等)
  │
  │ megalodon API (投稿取得)
  ▼
Entity.Attachment (media_attachments[])
  │  - url, preview_url, remote_url
  │  - type: 'image' | 'video' | 'gifv' | 'audio' | 'unknown'
  │
  │ SQLite へ保存 (post_media テーブル)
  ▼
React コンポーネント
  │
  ├─ MediaAttachments  投稿の全メディアをグリッド表示
  │   └─ Media          個別メディアの描画（type別分岐）
  │
  ├─ ProxyImage        next/image + プロキシURL変換
  │   └─ URL変換: https://remote.server/path → /api/attachment/remote.server/path
  │
  └─ ブラウザ
      └─ GET /api/attachment/{domain}/{path}
          └─ route.ts → リモートサーバーから取得 → レスポンス返却
```

### ProxyImage コンポーネント

**ファイル:** `src/app/_parts/ProxyImage.tsx`

`ProxyImage` は `next/image` をラップし、自動的にプロキシ URL への変換を行うコンポーネント。

```typescript
// URL 変換ロジック
const u = new URL(originalSrc)           // https://remote.server/media/img.jpg
const host = u.host                       // remote.server
const path = u.pathname.replace(/^\//, '') // media/img.jpg
const qs = u.search                       // ?name=sm (あれば)
return `/api/attachment/${host}/${path}${qs}`
// → /api/attachment/remote.server/media/img.jpg
```

**機能:**
- プロキシ URL への自動変換
- 右クリックコンテキストメニュー（新しいタブで開く / リンクをコピー / 画像を保存）
- コンテキストメニューからはオリジナル URL を使用（プロキシ URL ではない）
- `unoptimized` フラグで next/image の画像最適化を無効化（プロキシ経由のため）

### next.config.mjs との連携

```javascript
images: {
  localPatterns: [{
    pathname: '/api/attachment/**',
  }]
}
```

`next/image` が `/api/attachment/**` パスをローカルパターンとして認識できるよう設定されている。

### Media コンポーネント

**ファイル:** `src/app/_parts/Media.tsx`

`Entity.Attachment` の `type` フィールドに基づいてメディアを描画する:

| type | 描画方法 |
|---|---|
| `image` | `<img>` タグ（`preview_url` または `url`） |
| `video` | `<video>` タグ + 再生アイコンオーバーレイ |
| `gifv` | `<video>` タグ + 再生アイコンオーバーレイ |
| `audio` | `<audio>` タグ（`controls` 属性付き） |
| `unknown` | 表示なし |

### MediaAttachments コンポーネント

**ファイル:** `src/app/_parts/MediaAttachments.tsx`

投稿に添付された複数のメディアをグリッドレイアウトで表示する:

| メディア数 | レイアウト |
|---|---|
| 1 | 全幅（`w-full`） |
| 2, 4 | 2列（`w-1/2`） |
| 3, 5, 6 | 3列（`w-1/3`） |
| 7以上 | 最初の5つを表示 + 「+N」ボタン |

**センシティブコンテンツ対応:**
- `sensitive: true` の場合、ブラー付きオーバーレイで非表示
- クリックで表示/非表示をトグル
- 設定（`SettingContext.showSensitive`）でデフォルト動作を変更可能

### SQLite のメディアデータ構造

**ファイル:** `src/util/db/sqlite/schema/tables/postRelated.ts`

```sql
CREATE TABLE IF NOT EXISTS post_media (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id        INTEGER NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  media_type_id  INTEGER NOT NULL,
  url            TEXT    NOT NULL,
  width          INTEGER,
  height         INTEGER,
  remote_url     TEXT,
  preview_url    TEXT,
  description    TEXT,
  blurhash       TEXT,
  media_local_id TEXT,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);
```

---

## 6. 関連ソースファイル一覧

| ファイル | 役割 |
|---|---|
| `src/app/api/attachment/[...path]/route.ts` | メディアプロキシ API ルート |
| `src/app/_parts/ProxyImage.tsx` | プロキシ URL 変換 + next/image ラッパー |
| `src/app/_parts/Media.tsx` | メディアタイプ別描画コンポーネント |
| `src/app/_parts/MediaAttachments.tsx` | メディアグリッドレイアウト |
| `src/app/_parts/MediaFilterControls.tsx` | メディアフィルタ UI（Only Media / Min count） |
| `src/util/db/sqlite/schema/tables/postRelated.ts` | `post_media` テーブル定義 |
| `next.config.mjs` | next/image の localPatterns 設定 |

---

## 次に読むべきドキュメント

→ [`10-development-workflow.md`](./10-development-workflow.md) — 開発ワークフロー
