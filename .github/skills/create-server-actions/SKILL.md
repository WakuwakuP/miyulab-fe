# Create Server Actions Skill

## メタデータ

- **title**: CreateServerActions
- **description**: ZenStack v3を活用したNext.js 16環境でのServer Actions作成スキル。透過的キャッシュによる自動キャッシュ管理とデータCRUD操作を実装します。

## スキルの目的

このスキルは、以下のシナリオで使用します：

- データベースのCRUD操作を実装する必要がある場合
- ZenStack v3の透過的キャッシュを活用したい場合
- 認証・認可を伴うデータ操作を実装する場合
- 複雑なトランザクション処理が必要な場合
- バッチ処理や条件付き操作を実装する場合

## 基本原則

### 1. ZenStack v3 クライアントの使い分け

- `db`: キャッシュプラグイン適用済み（一般的な操作）
- `authDb`: キャッシュ + ポリシープラグイン（認証が必要な操作）
- `baseDb`: プラグインなし（特殊なケース）

### 2. 自動キャッシュ管理

**ZenStack v3では手動でのキャッシュ無効化は不要**：キャッシュタグは自動生成、書き込み操作時に `revalidateTag` が自動実行、リレーションも考慮した無効化

### 3. 型安全性とバリデーション

Zodを使用した入力バリデーション、TypeScriptの型定義、エラーハンドリングの徹底

## 実装ワークフロー

### ステップ1: Server Actions ファイルの作成

**ファイル構造**

```
src/
  actions/
    post.ts          # Post関連のServer Actions
    user.ts          # User関連のServer Actions
```

**基本構造**

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
```

### ステップ2: CRUD 操作の実装

**データ作成 (Create)**

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function createPost(data: { 
  title: string
  content: string
  authorId: string 
}) {
  // ZenStack v3: キャッシュは自動で無効化される
  const post = await db.post.create({
    data: {
      title: data.title,
      content: data.content,
      authorId: data.authorId,
    },
  })

  // ✅ revalidateTag 不要！プラグインが自動で処理
  return post
}
```

**データ取得 (Read)**

```typescript
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
```

**データ更新 (Update)**

```typescript
export async function updatePost(
  id: string,
  data: { title?: string; content?: string }
) {
  const post = await db.post.update({
    where: { id },
    data,
  })
  // ✅ revalidateTag 不要！プラグインが自動で処理
  return post
}
```

**データ削除 (Delete)**

```typescript
export async function deletePost(id: string) {
  await db.post.delete({
    where: { id },
  })
  // ✅ revalidateTag 不要！プラグインが自動で処理
  return { success: true }
}
```

### ステップ3: 認証と認可

詳細は`reference/server-actions.md`を参照してください。

**セッション確認**

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

  return session.user
}
```

**ZenStack PolicyPlugin を使った認可**

```typescript
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
  return await authDb.post.findMany({
    where: { authorId: session.user.id },
  })
}
```

**スキーマでのアクセス制御定義**

```zmodel
model Post {
  id        String   @id
  title     String
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])

  @@allow('read', true)                 // 誰でも閲覧可能
  @@allow('create', auth() != null)     // 作成は認証済みユーザーのみ
  @@allow('update', auth() == author)   // 更新は作者のみ
  @@allow('delete', auth() == author)   // 削除は作者のみ
}
```

### ステップ4: エラーハンドリング

**基本的なエラーハンドリング**

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function createPost(data: CreatePostData) {
  try {
    const post = await db.post.create({ data })
    return { success: true, data: post }
  } catch (error) {
    console.error('Post creation failed:', error)
    
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

**型安全なレスポンス**

```typescript
type ActionResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string }

export async function updatePost(
  id: string,
  data: UpdatePostData
): Promise<ActionResult<Post>> {
  try {
    const post = await db.post.update({ where: { id }, data })
    return { success: true, data: post }
  } catch (error) {
    return { success: false, error: '更新に失敗しました' }
  }
}
```

### ステップ5: 複雑な操作パターン

詳細は`reference/server-actions.md`を参照してください。

**トランザクション**

```typescript
'use server'

import { db } from '@/lib/prisma'

export async function transferOwnership(postId: string, newOwnerId: string) {
  return await db.$transaction(async (tx) => {
    const post = await tx.post.update({
      where: { id: postId },
      data: { authorId: newOwnerId },
    })

    await tx.transferHistory.create({
      data: { postId, newOwnerId, transferredAt: new Date() },
    })

    return post
  })
}
```

**バッチ処理**

```typescript
export async function batchUpdatePosts(
  updates: Array<{ id: string; data: Partial<Post> }>
) {
  const results = await db.$transaction(
    updates.map(({ id, data }) =>
      db.post.update({ where: { id }, data })
    )
  )
  return results
}
```

**条件付き操作**

```typescript
export async function toggleFavorite(userId: string, postId: string) {
  const existing = await db.favorite.findFirst({
    where: { userId, postId },
  })

  if (existing) {
    await db.favorite.delete({ where: { id: existing.id } })
    return { isFavorite: false }
  } else {
    await db.favorite.create({ data: { userId, postId } })
    return { isFavorite: true }
  }
}
```

### ステップ6: バリデーション

**Zod を使用した入力検証**

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
  const result = CreatePostSchema.safeParse(rawData)
  
  if (!result.success) {
    return {
      success: false,
      errors: result.error.flatten().fieldErrors,
    }
  }

  const post = await db.post.create({ data: result.data })
  return { success: true, data: post }
}
```

### ステップ7: パフォーマンス最適化

詳細は`reference/data-fetching.md`を参照してください。

**選択的データ取得**

```typescript
export async function getPostSummary(id: string) {
  return await db.post.findById(id, {
    select: {
      id: true,
      title: true,
      createdAt: true,
      _count: { select: { comments: true, favorites: true } },
    },
  })
}
```

**並列データ取得**

```typescript
export async function getDashboardData(userId: string) {
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
    db.post.count({ where: { authorId: userId } }),
  ])

  return { posts, comments, totalPosts: stats }
}
```

## 検証チェックリスト

### 機能要件
- [ ] CRUD操作が正しく動作する
- [ ] エラーケースが適切に処理されている
- [ ] 認証/認可が正しく実装されている

### ZenStack v3
- [ ] 適切なクライアント（db/authDb/baseDb）を使用している
- [ ] 手動での revalidateTag 呼び出しがない
- [ ] ポリシー定義が適切に設定されている

### コード品質
- [ ] TypeScriptの型エラーがない
- [ ] Zodによるバリデーションが実装されている
- [ ] エラーレスポンスが型安全である

### パフォーマンス
- [ ] 不要なデータ取得がない
- [ ] 並列処理が活用されている
- [ ] トランザクションが適切に使用されている

### セキュリティ
- [ ] 認証チェックが実装されている
- [ ] 入力バリデーションが実装されている
- [ ] SQLインジェクション対策ができている

### テスト
- [ ] 単体テストが作成されている
- [ ] エラーケースのテストがある
- [ ] トランザクションのテストがある

## トラブルシューティング

### 問題: キャッシュが更新されない

**原因**: ZenStack v3のプラグイン設定が正しくない

**解決策**: lib/prisma.ts で enhance の設定を確認、キャッシュプラグインが正しく適用されているか確認

### 問題: 認証エラーが発生する

**原因**: セッションの取得方法が間違っている

**解決策**: `await headers()` を使用してヘッダーを取得、auth.api.getSession にヘッダーを渡す

### 問題: バリデーションエラーが正しく表示されない

**原因**: Zodのエラー処理が不適切

**解決策**: safeParse を使用してエラーをキャッチ、error.flatten().fieldErrors でフィールドごとのエラーを取得

## 参考リソース

- `reference/server-actions.md` - Server Actionsの詳細実装パターン
- `reference/cache-system.md` - ZenStack v3キャッシュシステムの詳細
- `reference/data-fetching.md` - データ取得パターンとベストプラクティス

## 更新履歴

- 2025-12-22: 初版作成
