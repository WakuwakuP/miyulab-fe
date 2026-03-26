# データ取得パターンガイド（ZenStack v3対応）

## 概要

ZenStack v3 では、キャッシュが**自動的に適用**されるため、`unstable_cache` を手動でラップする必要がなくなった。
シンプルなクエリを書くだけで、キャッシュタグの設定と無効化が透過的に行われる。

## 基本的な取得パターン

### 単一データの取得

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

// シンプルなID指定取得
// tags: ['post:{id}']
export async function getPost(id: string) {
  return await db.post.findById(id)
}

// リレーション込み
// tags: ['post:{id}', 'user:list']
export async function getPostWithAuthor(id: string) {
  return await db.post.findById(id, {
    include: {
      author: true,
    },
  })
}

// 条件付き取得
// tags: ['post:list']（findFirst は list タグを使用）
export async function getPostBySlug(slug: string) {
  return await db.post.findFirst({
    where: { slug },
  })
}
```

### リスト取得

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/prisma'

// 基本的なリスト取得
// tags: ['post:list']
export async function getPosts() {
  return await db.post.findMany({
    orderBy: { createdAt: 'desc' },
  })
}

// リレーション込み
// tags: ['post:list', 'user:list', 'comment:list']
export async function getPostsWithDetails() {
  return await db.post.findMany({
    include: {
      author: true,
      comments: {
        take: 3,
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
```

## 条件付き取得

### フィルタリング

```typescript
// ステータスでフィルタ
// tags: ['post:list']
export async function getPostsByStatus(status: 'draft' | 'published') {
  return await db.post.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
  })
}

// 複合条件
// tags: ['post:list']
export async function getFilteredPosts(filters: {
  authorId?: string
  categoryId?: string
  publishedAfter?: Date
}) {
  return await db.post.findMany({
    where: {
      ...(filters.authorId && { authorId: filters.authorId }),
      ...(filters.categoryId && { categoryId: filters.categoryId }),
      ...(filters.publishedAfter && {
        publishedAt: { gte: filters.publishedAfter },
      }),
    },
    orderBy: { createdAt: 'desc' },
  })
}
```

### 検索機能

```typescript
// テキスト検索
// tags: ['post:list']
export async function searchPosts(query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  return await db.post.findMany({
    where: {
      OR: [
        { title: { contains: normalizedQuery, mode: 'insensitive' } },
        { content: { contains: normalizedQuery, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}
```

## ページネーション

### オフセットベース

```typescript
interface PaginatedResult<T> {
  data: T[]
  pagination: {
    page: number
    limit: number
    totalCount: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

// tags: ['post:list']
// ※ページ番号に関係なく同じタグが使われる
export async function getPaginatedPosts(
  page: number = 1,
  limit: number = 20
): Promise<PaginatedResult<Post>> {
  const offset = (page - 1) * limit

  const [posts, totalCount] = await Promise.all([
    db.post.findMany({
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    db.post.count(),
  ])

  const totalPages = Math.ceil(totalCount / limit)

  return {
    data: posts,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  }
}
```

### カーソルベース

```typescript
interface CursorPaginatedResult<T> {
  data: T[]
  nextCursor: string | null
  hasNextPage: boolean
}

// tags: ['post:list']
export async function getPostsAfterCursor(
  cursor?: string,
  limit: number = 20
): Promise<CursorPaginatedResult<Post>> {
  const posts = await db.post.findMany({
    where: cursor ? { id: { lt: cursor } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  })

  const hasNextPage = posts.length > limit
  const dataToReturn = hasNextPage ? posts.slice(0, -1) : posts
  const nextCursor = hasNextPage ? dataToReturn[dataToReturn.length - 1].id : null

  return {
    data: dataToReturn,
    nextCursor,
    hasNextPage,
  }
}
```

## 集計データの取得

### カウント

```typescript
// tags: ['post:list']（count も list タグ）
export async function getPostCount(authorId?: string) {
  return await db.post.count({
    where: authorId ? { authorId } : undefined,
  })
}
```

### サマリー情報

```typescript
// tags: ['post:list', 'comment:list', 'user:list']
export async function getDashboardSummary(userId: string) {
  const [
    totalPosts,
    totalComments,
    recentPosts,
    recentComments,
  ] = await Promise.all([
    db.post.count({ where: { authorId: userId } }),
    db.comment.count({ where: { authorId: userId } }),
    db.post.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    }),
    db.comment.findMany({
      where: { authorId: userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { post: { select: { title: true } } },
    }),
  ])

  return {
    totalPosts,
    totalComments,
    recentPosts,
    recentComments,
  }
}
```

## 推奨パターン: Actions + Suspense

### 基本原則

1. **Server Actions でデータ取得**: `'use server'` 付きの Actions でデータ取得を行う
2. **Suspense で UI とデータを分離**: ページコンポーネントは UI 構造のみ、データ取得は子コンポーネントで
3. **Skeleton/Loading でフォールバック**: 適切なローディング UI を用意

### 基本的なパターン

```typescript
// src/actions/post.ts
'use server'

import { db } from '@/lib/db'

export async function getPosts() {
  return await db.post.findMany({
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPost(id: string) {
  return await db.post.findUnique({
    where: { id },
    include: { author: true },
  })
}
```

```typescript
// app/~/posts/page.tsx
import { Suspense } from 'react'
import { PostList } from '@/components/post/post-list'
import { PostListSkeleton } from '@/components/post/post-list-skeleton'

// ページコンポーネントは UI 構造のみ
export default function PostsPage() {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-6">投稿一覧</h1>
      {/* Suspense でデータ取得部分を分離 */}
      <Suspense fallback={<PostListSkeleton />}>
        <PostList />
      </Suspense>
    </div>
  )
}
```

```typescript
// src/components/post/post-list.tsx
import { getPosts } from '@/actions/post'
import { PostCard } from './post-card'

// データ取得は専用の Server Component で
export async function PostList() {
  const posts = await getPosts()

  if (posts.length === 0) {
    return <EmptyState message="投稿がありません" />
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  )
}
```

```typescript
// src/components/post/post-list-skeleton.tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function PostListSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
```

### 詳細ページのパターン

```typescript
// app/~/posts/[id]/page.tsx
import { Suspense } from 'react'
import { PostDetail } from '@/components/post/post-detail'
import { PostDetailSkeleton } from '@/components/post/post-detail-skeleton'
import { CommentList } from '@/components/comment/comment-list'
import { CommentListSkeleton } from '@/components/comment/comment-list-skeleton'

interface Props {
  params: Promise<{ id: string }>
}

export default async function PostDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="container py-8">
      {/* メインコンテンツ */}
      <Suspense fallback={<PostDetailSkeleton />}>
        <PostDetail id={id} />
      </Suspense>

      {/* コメントセクション（独立してロード） */}
      <section className="mt-8">
        <h2 className="text-xl font-semibold mb-4">コメント</h2>
        <Suspense fallback={<CommentListSkeleton />}>
          <CommentList postId={id} />
        </Suspense>
      </section>
    </div>
  )
}
```

```typescript
// src/components/post/post-detail.tsx
import { getPost } from '@/actions/post'
import { notFound } from 'next/navigation'

interface Props {
  id: string
}

export async function PostDetail({ id }: Props) {
  const post = await getPost(id)

  if (!post) {
    notFound()
  }

  return (
    <article>
      <h1 className="text-3xl font-bold mb-4">{post.title}</h1>
      <div className="flex items-center gap-2 text-muted-foreground mb-6">
        <span>{post.author.name}</span>
        <span>•</span>
        <time>{new Date(post.createdAt).toLocaleDateString('ja-JP')}</time>
      </div>
      <div className="prose max-w-none">{post.content}</div>
    </article>
  )
}
```

### ダッシュボードのパターン（複数セクション）

```typescript
// app/~/dashboard/page.tsx
import { Suspense } from 'react'
import { StatsCards } from '@/components/dashboard/stats-cards'
import { RecentPosts } from '@/components/dashboard/recent-posts'
import { RecentComments } from '@/components/dashboard/recent-comments'
import {
  StatsCardsSkeleton,
  RecentPostsSkeleton,
  RecentCommentsSkeleton,
} from '@/components/dashboard/skeletons'

export default function DashboardPage() {
  return (
    <div className="container py-8 space-y-8">
      <h1 className="text-2xl font-bold">ダッシュボード</h1>

      {/* 統計カード */}
      <Suspense fallback={<StatsCardsSkeleton />}>
        <StatsCards />
      </Suspense>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* 最近の投稿 */}
        <section>
          <h2 className="text-lg font-semibold mb-4">最近の投稿</h2>
          <Suspense fallback={<RecentPostsSkeleton />}>
            <RecentPosts />
          </Suspense>
        </section>

        {/* 最近のコメント */}
        <section>
          <h2 className="text-lg font-semibold mb-4">最近のコメント</h2>
          <Suspense fallback={<RecentCommentsSkeleton />}>
            <RecentComments />
          </Suspense>
        </section>
      </div>
    </div>
  )
}
```

### Skeleton コンポーネントのパターン

```typescript
// src/components/dashboard/skeletons.tsx
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function StatsCardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export function RecentPostsSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function RecentCommentsSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
```

### loading.tsx を使ったページ全体のローディング

```typescript
// app/~/posts/loading.tsx
import { PostListSkeleton } from '@/components/post/post-list-skeleton'

// Suspense boundary が無い場合のフォールバック
export default function Loading() {
  return (
    <div className="container py-8">
      <div className="h-8 w-32 bg-muted rounded animate-pulse mb-6" />
      <PostListSkeleton />
    </div>
  )
}
```

### 並列データ取得（データ取得コンポーネント内）

```typescript
// src/components/dashboard/stats-cards.tsx
import { getPostCount, getCommentCount, getUserCount } from '@/actions/stats'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, MessageSquare, Users } from 'lucide-react'

export async function StatsCards() {
  // データ取得コンポーネント内で並列取得
  const [postCount, commentCount, userCount] = await Promise.all([
    getPostCount(),
    getCommentCount(),
    getUserCount(),
  ])

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard title="投稿数" value={postCount} icon={FileText} />
      <StatCard title="コメント数" value={commentCount} icon={MessageSquare} />
      <StatCard title="ユーザー数" value={userCount} icon={Users} />
    </div>
  )
}
```

## 選択的データ取得

### select を使った最適化

```typescript
// 必要なフィールドのみ取得
// tags: ['post:list']
export async function getPostTitles() {
  return await db.post.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
    },
    orderBy: { title: 'asc' },
  })
}

// ネストした select
// tags: ['post:{id}', 'user:list']
export async function getPostWithAuthorName(id: string) {
  return await db.post.findById(id, {
    select: {
      id: true,
      title: true,
      content: true,
      author: {
        select: {
          id: true,
          name: true,
          image: true,
        },
      },
    },
  })
}
```

### _count を使った集計

```typescript
// tags: ['post:list']
export async function getPostsWithCounts() {
  return await db.post.findMany({
    include: {
      _count: {
        select: {
          comments: true,
          favorites: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}
```

## 従来との比較

### Before (unstable_cache 使用)

```typescript
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

export async function getPosts() {
  const cachedGetPosts = unstable_cache(
    async () => {
      const posts = await prisma.post.findMany({
        include: { author: true },
        orderBy: { createdAt: 'desc' },
      })
      // Date を手動で変換
      return posts.map(post => ({
        ...post,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
      }))
    },
    ['posts:list'],
    {
      tags: ['posts', 'users'],  // リレーションタグも手動
      revalidate: 300,
    }
  )
  
  return await cachedGetPosts()
}
```

### After (ZenStack v3)

```typescript
import { db } from '@/lib/prisma'

export async function getPosts() {
  // これだけ！キャッシュもDate変換も自動
  return await db.post.findMany({
    include: { author: true },
    orderBy: { createdAt: 'desc' },
  })
}
```

## キャッシュの動作まとめ

### 自動設定されるタグ

| クエリメソッド | タグ |
|---------------|------|
| `findMany` | `{model}:list` |
| `findFirst` | `{model}:list` |
| `findById` | `{model}:{id}` |
| `findUnique` | `{model}:{id}` または `{model}:list` |
| `count` | `{model}:list` |

### リレーション考慮

```typescript
// include/select でリレーションを含めると、
// そのリレーション先の :list タグも追加される

db.post.findMany({
  include: {
    author: true,      // → user:list 追加
    comments: true,    // → comment:list 追加
    category: true,    // → category:list 追加
  },
})
// tags: ['post:list', 'user:list', 'comment:list', 'category:list']
```

## ベストプラクティス

### 設計原則

1. **Actions でデータ取得**: `'use server'` 付きの関数でデータ取得を集約
2. **Suspense で分離**: ページコンポーネントは UI 構造のみ、データ取得は子コンポーネントで
3. **適切な Skeleton**: ローディング中の UX を考慮したフォールバック UI を用意
4. **並列取得**: 独立したデータはデータ取得コンポーネント内で `Promise.all` を使用
5. **シンプルに書く**: `unstable_cache` のラップは不要（ZenStack プラグインが自動処理）
6. **必要なデータだけ取得**: `select` を活用してオーバーフェッチを避ける
7. **リレーションは必要な時だけ**: 不要な `include` は避ける

### ファイル構成例

```
src/
├── actions/
│   ├── post.ts          # Server Actions（データ取得・更新）
│   └── comment.ts
├── components/
│   ├── post/
│   │   ├── post-list.tsx        # データ取得 + 表示
│   │   ├── post-list-skeleton.tsx
│   │   ├── post-card.tsx        # 表示のみ（Pure Component）
│   │   ├── post-detail.tsx      # データ取得 + 表示
│   │   └── post-detail-skeleton.tsx
│   └── ui/
│       └── skeleton.tsx         # 共通 Skeleton コンポーネント
└── app/
    └── ~/
        └── posts/
            ├── page.tsx         # UI 構造 + Suspense
            ├── loading.tsx      # ページ全体のフォールバック
            └── [id]/
                └── page.tsx
