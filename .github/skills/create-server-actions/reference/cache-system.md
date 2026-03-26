# キャッシュシステムガイド（ZenStack v3対応）

## 概要

ZenStack v3 と Next.js 16 の `unstable_cache` を使用した透過的なキャッシュシステムを実装している。
ZenStack v3 のランタイムプラグインにより、**手動でキャッシュ処理を書く必要がなくなった**。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                     アプリケーション                         │
│  db.post.findMany({ include: { author: true } })           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              ZenStack v3 Cache Plugin                       │
│  - 読み取り操作: unstable_cache + tags で自動キャッシュ     │
│  - 書き込み操作: updateTag/revalidateTag で自動無効化      │
│  - リレーション考慮: include/select を解析してタグ追加     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL (pg Pool)                      │
└─────────────────────────────────────────────────────────────┘
```

## 基本設計

### ZenStack v3 クライアント設定

```typescript
// src/lib/db.ts
import { type ClientContract, ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from '@zenstackhq/orm/dialects/postgres'
import { PolicyPlugin } from '@zenstackhq/plugin-policy'
import { Pool } from 'pg'
import { createNextjsCachePlugin } from '@/zenstack/plugins/nextjs-cache'
import { type SchemaType, schema } from '@/zenstack/schema'

// ZenStack v3 client with PostgreSQL dialect
const baseDb: ClientContract<SchemaType> =
  new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: process.env.DATABASE_URL,
      }),
    }),
  })

// Next.js Cache プラグインを適用
const db = baseDb.$use(
  createNextjsCachePlugin({
    debug: process.env.NODE_ENV === 'development',
    defaultCacheLife: 'hours',
  }),
)

// アクセスポリシー付きクライアント（認証が必要な操作用）
const authDb = db.$use(new PolicyPlugin())

export { db, authDb, baseDb }
```

## キャッシュの仕組み

### 読み取り操作

`unstable_cache` を使用してキャッシュし、`tags` オプションでタグを設定：

```typescript
// プラグイン内部の処理イメージ
const cachedQuery = unstable_cache(
  async () => await proceed(queryArgs),
  [cacheKey],
  {
    tags: ['post:list', 'user:list'],  // 自動生成されたタグ
    revalidate: 3600,  // キャッシュ有効期間（秒）
  }
)
```

### 書き込み操作（自動無効化）

書き込み操作後、以下の順序でキャッシュを無効化：

1. **`updateTag`** を試みる（Server Actions 限定、即時無効化）
2. 使えない場合は **`revalidateTag`** にフォールバック（stale-while-revalidate）

```typescript
// プラグイン内部の処理
async function invalidateTag(tag: string) {
  try {
    // Server Actions では即時無効化
    const { updateTag } = await import('next/cache')
    updateTag(tag)
  } catch {
    // Route Handlers 等では stale-while-revalidate
    const { revalidateTag } = await import('next/cache')
    revalidateTag(tag, 'max')
  }
}
```

| 呼び出し元 | 使用される API | 動作 |
|-----------|---------------|------|
| **Server Actions** | `updateTag` | 即時無効化（次のリクエストで新データを待つ） |
| **Route Handlers** | `revalidateTag` | stale-while-revalidate（古いデータを返しつつ更新） |

## キャッシュタグの自動生成

### 読み取り操作

| クエリ | 自動生成されるタグ |
|--------|------------------|
| `db.post.findMany()` | `post:list` |
| `db.post.findUnique({ where: { id: '123' } })` | `post:list`, `post:123` |
| `db.post.findMany({ include: { author: true } })` | `post:list`, `user:list` |
| `db.post.findUnique({ where: { id: '123' }, include: { author: true, comments: true } })` | `post:list`, `post:123`, `user:list`, `comment:list` |

### 書き込み操作（自動無効化）

| 操作 | 無効化されるタグ |
|------|------------------|
| `db.post.create(...)` | `post:list`, `post:{新ID}`, + リレーション先の `:list` |
| `db.post.update({ where: { id: '123' }, ... })` | `post:list`, `post:123`, + リレーション先の `:list` |
| `db.post.delete({ where: { id: '123' } })` | `post:list`, `post:123`, + リレーション先の `:list` |

## スキーマ属性によるキャッシュ制御

### @@cache.exclude() - キャッシュ除外

```zmodel
model Session {
  id        String   @id
  token     String
  userId    String
  user      User     @relation(fields: [userId], references: [id])

  // このモデルはキャッシュしない
  @@cache.exclude()
}
```

### @@cache.life() - キャッシュ有効期間

```zmodel
model Post {
  id    String @id
  title String

  // 5分間キャッシュ
  @@cache.life('minutes')
}
```

使用可能な値: `'seconds'`, `'minutes'`, `'hours'`, `'days'`, `'weeks'`, `'max'`

| プロファイル | 秒数 |
|-------------|------|
| `seconds` | 1秒 |
| `minutes` | 60秒 |
| `hours` | 3600秒（1時間） |
| `days` | 86400秒（1日） |
| `weeks` | 604800秒（1週間） |
| `max` | 31536000秒（1年） |

### @@cache.tags() - カスタムタグ

```zmodel
model Post {
  id    String @id
  title String

  // カスタムタグを設定
  @@cache.tags(['content', 'blog'])
}
```

## キャッシュプラグインの設定オプション

```typescript
createNextjsCachePlugin({
  // デフォルトのキャッシュ有効期間
  defaultCacheLife: 'hours',  // 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'max'
  
  // 追加の除外モデル（スキーマ属性に加えて）
  excludeModels: ['TempData'],
  
  // デバッグログ
  debug: true,
  
  // カスタムタグ生成関数
  customTagGenerator: (model, id) => {
    return id ? [`${model}:${id}`, `${model}:list`] : [`${model}:list`]
  },
})
```

## リレーション対応

### 読み取り時

`include` や `select` でリレーションを含めると、自動的にリレーション先のタグも追加される。

```typescript
// tags: ['post:list', 'user:list', 'comment:list']
const posts = await db.post.findMany({
  include: {
    author: true,     // → user:list タグ追加
    comments: true,   // → comment:list タグ追加
  },
})
```

### 書き込み時

モデル更新時、スキーマのリレーション定義を解析して関連モデルのキャッシュも無効化。

```typescript
// Post を更新すると、以下が無効化される:
// - post:list, post:{id}
// - user:list（Post → User リレーション）
// - comment:list（Post → Comment リレーション）
// - category:list（Post → Category リレーション）
await db.post.update({
  where: { id: 'post-123' },
  data: { title: 'Updated' },
})
```

## Date 型の自動変換

キャッシュはJSONシリアライズされるため、Date型は自動的にISO文字列に変換される。

```typescript
// プラグインが自動変換するため、手動変換不要
const posts = await db.post.findMany()
// posts[0].createdAt は ISO文字列として返される
```

## 従来の unstable_cache 直接使用との比較

### Before (unstable_cache を直接使用)

```typescript
// 手動でキャッシュ処理を書く必要があった
export async function getPosts() {
  const cachedGetPosts = unstable_cache(
    async () => {
      const posts = await prisma.post.findMany({
        include: { author: true },
      })
      // Date変換も手動
      return posts.map(post => ({
        ...post,
        createdAt: post.createdAt.toISOString(),
      }))
    },
    ['posts:list'],
    {
      tags: ['posts', 'users'],  // リレーションタグも手動管理
    }
  )
  return await cachedGetPosts()
}

// 更新時も手動で無効化
export async function updatePost(id: string, data: UpdateData) {
  const post = await prisma.post.update({ where: { id }, data })
  
  // 手動でタグ無効化
  revalidateTag('posts')
  revalidateTag(`post:${id}`)
  revalidateTag('users')  // リレーション先も忘れずに
  
  return post
}
```

### After (ZenStack v3 プラグイン)

```typescript
// 透過的にキャッシュが適用される
export async function getPosts() {
  // 自動でキャッシュタグ設定、Date変換も自動
  return await db.post.findMany({
    include: { author: true },
  })
}

// 更新時も自動で無効化
export async function updatePost(id: string, data: UpdateData) {
  // 自動でキャッシュ無効化（リレーション先含む）
  return await db.post.update({
    where: { id },
    data,
  })
}
```

## デバッグ

### ログ出力

`debug: true` を設定すると、キャッシュ操作がログ出力される。

```
[NextjsCache] Read operation: Post.findMany {
  queryArgs: { include: { author: true } },
  tags: [ 'post:list', 'user:list' ],
  life: 'hours',
  revalidateSeconds: 3600,
  cacheKey: [ 'post:findMany', '{"include":{"author":true}}' ],
  includedRelations: [ 'User' ]
}

[NextjsCache] Cache MISS: Post.findMany { cacheKey: [...], tags: [...] }

[NextjsCache] After mutation: Post
[NextjsCache] Updated tag (immediate): post:list
[NextjsCache] Updated tag (immediate): post:123
[NextjsCache] Invalidating related model: User
[NextjsCache] Updated tag (immediate): user:list
```

## ベストプラクティス

### 1. 認証関連モデルは除外

```zmodel
model Session {
  // ...
  @@cache.exclude()
}

model Account {
  // ...
  @@cache.exclude()
}

model Verification {
  // ...
  @@cache.exclude()
}
```

### 2. 頻繁に更新されるデータは短いライフタイム

```zmodel
model Notification {
  // ...
  @@cache.life('seconds')
}
```

### 3. 静的コンテンツは長いライフタイム

```zmodel
model StaticPage {
  // ...
  @@cache.life('days')
}
```

### 4. PolicyPlugin との組み合わせ

認証が必要な操作には `authDb` を使用:

```typescript
import { authDb } from '@/lib/db'

export async function getMyPosts(userId: string) {
  // PolicyPlugin によりアクセス制御が適用される
  return await authDb.post.findMany({
    where: { authorId: userId },
  })
}
```

## Next.js キャッシュ API まとめ

| API | 用途 | 使用場所 |
|-----|------|----------|
| `unstable_cache` | 関数の結果をキャッシュ | Server Components, Server Actions |
| `updateTag` | タグ付きキャッシュを即時無効化 | Server Actions のみ |
| `revalidateTag` | タグ付きキャッシュを再検証 | Server Actions, Route Handlers |
| `revalidatePath` | パスに関連するキャッシュを再検証 | Server Actions, Route Handlers |

## 注意事項

1. **Server Components / Server Actions 内でのみ動作**: キャッシュ API は Server 環境でのみ利用可能
2. **`updateTag` は Server Actions 限定**: Route Handlers では `revalidateTag` にフォールバック
3. **ページネーションは一括キャッシュ**: `skip`/`take` に関係なく同じ `:list` タグが使われる
4. **Date型は文字列になる**: クライアントで Date オブジェクトが必要な場合は `new Date(dateString)` で復元
5. **キャッシュキーはクエリ引数から生成**: 同じクエリは同じキャッシュを使用
