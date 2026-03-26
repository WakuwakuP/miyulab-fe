# Server Actions 実装ガイド（ZenStack v3対応）

## 基本構造

Server Actions は `'use server'` ディレクティブを使用して定義し、サーバーサイドでのデータ操作を行う。
ZenStack v3 では、**キャッシュ無効化が自動化**されたため、手動での `revalidateTag` 呼び出しは不要。

## ZenStack v3 クライアントの使い分け

```typescript
import { db, authDb, baseDb } from '@/lib/prisma'

// db: キャッシュプラグイン適用済み（一般的な操作）
// authDb: キャッシュ + ポリシープラグイン（認証が必要な操作）
// baseDb: プラグインなし（特殊なケース）
```

## CRUD 操作の実装パターン

### データ作成 (Create)

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

export async function createPost(data: { title: string; content: string; authorId: string }) {
  // ZenStack v3: キャッシュは自動で無効化される
  const post = await db.post.create({
    data: {
      title: data.title,
      content: data.content,
      authorId: data.authorId,
    },
  })

  // ✅ revalidateTag 不要！プラグインが自動で処理
  // 無効化されるタグ: post:list, post:{id}, user:list（リレーション）

  return post
}
```

### データ取得 (Read)

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

export async function getPosts() {
  // ZenStack v3: キャッシュタグが自動で設定される
  // tags: ['post:list']
  return await db.post.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPostById(id: string) {
  // tags: ['post:{id}']
  return await db.post.findById(id)
}

export async function getPostWithAuthor(id: string) {
  // tags: ['post:{id}', 'user:list']（リレーション考慮）
  return await db.post.findById(id, {
    include: { author: true },
  })
}
```

### データ更新 (Update)

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

export async function updatePost(
  id: string,
  data: { title?: string; content?: string }
) {
  const post = await db.post.update({
    where: { id },
    data,
  })

  // ✅ revalidateTag 不要！プラグインが自動で処理
  // 無効化されるタグ: post:list, post:{id}, + リレーション先

  return post
}
```

### データ削除 (Delete)

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

export async function deletePost(id: string) {
  await db.post.delete({
    where: { id },
  })

  // ✅ revalidateTag 不要！プラグインが自動で処理

  return { success: true }
}
```

## 認証と認可

### セッション確認

```typescript
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function protectedAction() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    throw new Error('認証が必要です')
  }

  // 認証済みユーザーの処理
  return session.user
}
```

### ZenStack PolicyPlugin を使った認可

```typescript
// src/actions/post.ts
'use server'

import { authDb } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'

export async function getMyPosts() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    throw new Error('認証が必要です')
  }

  // PolicyPlugin がスキーマの @@allow / @@deny を適用
  // ユーザーがアクセス可能なデータのみ返される
  return await authDb.post.findMany({
    where: { authorId: session.user.id },
  })
}
```

### スキーマでのアクセス制御定義

```zmodel
model Post {
  id        String   @id
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])

  // 誰でも閲覧可能
  @@allow('read', true)
  
  // 作成は認証済みユーザーのみ
  @@allow('create', auth() != null)
  
  // 更新・削除は作者のみ
  @@allow('update', auth() == author)
  @@allow('delete', auth() == author)
}
```

## エラーハンドリング

### 基本的なエラーハンドリング

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function createPost(data: CreatePostData) {
  try {
    const post = await db.post.create({ data })
    return { success: true, data: post }
  } catch (error) {
    console.error('Post creation failed:', error)
    
    // ZenStack のエラーをハンドリング
    if (error instanceof Error) {
      if (error.message.includes('unique constraint')) {
        return { success: false, error: 'すでに存在するデータです' }
      }
      if (error.message.includes('foreign key')) {
        return { success: false, error: '関連するデータが存在しません' }
      }
    }
    
    return { success: false, error: '操作に失敗しました' }
  }
}
```

### 型安全なレスポンス

```typescript
type ActionResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string }

export async function updatePost(
  id: string,
  data: UpdatePostData
): Promise<ActionResult<Post>> {
  try {
    const post = await db.post.update({
      where: { id },
      data,
    })
    return { success: true, data: post }
  } catch (error) {
    return { success: false, error: '更新に失敗しました' }
  }
}
```

## 複雑な操作パターン

### トランザクション

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function transferOwnership(
  postId: string,
  newOwnerId: string
) {
  // ZenStack v3 のトランザクション
  return await db.$transaction(async (tx) => {
    // 投稿を更新
    const post = await tx.post.update({
      where: { id: postId },
      data: { authorId: newOwnerId },
    })

    // 履歴を記録
    await tx.transferHistory.create({
      data: {
        postId,
        newOwnerId,
        transferredAt: new Date(),
      },
    })

    return post
  })
}
```

### バッチ処理

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function batchUpdatePosts(
  updates: Array<{ id: string; data: Partial<Post> }>
) {
  // トランザクションで一括更新
  const results = await db.$transaction(
    updates.map(({ id, data }) =>
      db.post.update({
        where: { id },
        data,
      })
    )
  )

  // ✅ キャッシュ無効化は自動

  return results
}
```

### 条件付き操作

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function toggleFavorite(userId: string, postId: string) {
  // 既存のお気に入りを確認
  const existing = await db.favorite.findFirst({
    where: {
      userId,
      postId,
    },
  })

  if (existing) {
    // お気に入りを削除
    await db.favorite.delete({
      where: { id: existing.id },
    })
    return { isFavorite: false }
  } else {
    // お気に入りを追加
    await db.favorite.create({
      data: {
        userId,
        postId,
      },
    })
    return { isFavorite: true }
  }
}
```

## バリデーション

### Zod を使用した入力検証

```typescript
'use server'

import { z } from 'zod'
import { db } from '@/lib/prisma'

const CreatePostSchema = z.object({
  title: z
    .string()
    .min(1, 'タイトルは必須です')
    .max(255, 'タイトルは255文字以内で入力してください'),
  content: z.string().optional(),
  authorId: z.string().uuid('不正なユーザーIDです'),
})

export async function createPostWithValidation(rawData: unknown) {
  // 入力データの検証
  const result = CreatePostSchema.safeParse(rawData)
  
  if (!result.success) {
    return {
      success: false,
      errors: result.error.flatten().fieldErrors,
    }
  }

  const post = await db.post.create({
    data: result.data,
  })

  return { success: true, data: post }
}
```

## パフォーマンス最適化

### 選択的データ取得

```typescript
export async function getPostSummary(id: string) {
  // 必要なフィールドのみ取得
  return await db.post.findById(id, {
    select: {
      id: true,
      title: true,
      createdAt: true,
      _count: {
        select: {
          comments: true,
          favorites: true,
        },
      },
    },
  })
}
```

### 並列データ取得

```typescript
export async function getDashboardData(userId: string) {
  // 複数のデータを並列で取得
  const [posts, comments, stats] = await Promise.all([
    db.post.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.comment.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    db.post.count({
      where: { authorId: userId },
    }),
  ])

  return { posts, comments, totalPosts: stats }
}
```

## 従来との比較

### Before (Prisma + 手動キャッシュ管理)

```typescript
'use server'

import { prisma } from '@/lib/prisma'
import { revalidateTag } from 'next/cache'

export async function updatePost(id: string, data: UpdateData) {
  const post = await prisma.post.update({
    where: { id },
    data,
    include: { author: true },
  })

  // 手動でキャッシュ無効化
  revalidateTag('posts')
  revalidateTag(`post:${id}`)
  revalidateTag(`user:${post.authorId}`)  // リレーション先も忘れずに

  return post
}
```

### After (ZenStack v3)

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function updatePost(id: string, data: UpdateData) {
  // キャッシュ無効化は自動！
  return await db.post.update({
    where: { id },
    data,
    include: { author: true },
  })
}
```

## ベストプラクティス

1. **`db` を使う**: 通常の操作はキャッシュプラグイン適用済みの `db` を使用
2. **`authDb` を使う**: 認証が必要な操作は PolicyPlugin 適用済みの `authDb` を使用
3. **revalidateTag は書かない**: ZenStack v3 プラグインが自動処理
4. **Zod でバリデーション**: 入力は必ず検証
5. **エラーは適切にハンドリング**: ユーザーフレンドリーなメッセージを返す
