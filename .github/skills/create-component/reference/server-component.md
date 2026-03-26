# Server Component 実装リファレンス

このドキュメントは、Server Componentの詳細な実装パターンを提供します。

## 基本方針

Server Component を優先して実装し、必要な場合のみ Client Component を使用する。

## Server Component の実装パターン

### 基本的な Server Component

```tsx
// src/app/(site)/home/page.tsx
import { getSession } from 'lib/auth';
import { HomeEventsList } from 'components/home/HomeEventsList';
import { getEvents } from 'lib/actions/getEvents';

export default async function Home() {
  const currentSession = await getSession();

  // データベースからデータを取得
  let events = [];
  if (currentSession?.user?.id != null) {
    try {
      events = await getEvents();
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <HomeEventsList events={events} />
    </div>
  );
}
```

### データ取得を含む Server Component

Server Component では async/await を使用してサーバー側でデータを取得できる。

```tsx
// src/app/(site)/events/[eventId]/page.tsx
import { getSession } from 'lib/auth';
import { getEvent } from 'lib/actions/getEvent';
import { EventDetail } from 'components/event/EventDetail';

interface Props {
  params: { eventId: string };
}

export default async function EventPage({ params }: Props) {
  const session = await getSession();

  if (!session?.user?.id) {
    return <div>認証が必要です</div>;
  }

  let event = null;
  try {
    event = await getEvent(params.eventId);
  } catch (error) {
    console.error('Failed to fetch event:', error);
  }

  if (!event) {
    return <div>イベントが見つかりません</div>;
  }

  return <EventDetail event={event} />;
}
```

## エラーハンドリングのパターン

### 基本的なエラーハンドリング

```tsx
export default async function DataFetchingPage() {
  let data = [];

  try {
    data = await fetchData();
  } catch (error) {
    console.error('Failed to fetch data:', error);
    // エラーが発生してもページは表示し、空のデータで続行
  }

  return (
    <div>
      {data.length > 0 ? <DataList items={data} /> : <p>データがありません</p>}
    </div>
  );
}
```

### 認証エラーのハンドリング

```tsx
import { getSession } from 'lib/auth';

export default async function ProtectedPage() {
  const session = await getSession();

  if (!session?.user?.id) {
    return (
      <div className="py-8 text-center">
        <p>このページを表示するにはログインが必要です</p>
      </div>
    );
  }

  // 認証済みユーザー向けのコンテンツ
  return <AuthenticatedContent userId={session.user.id} />;
}
```

## Server Component の利点

### 1. パフォーマンス

- サーバー側で HTML が生成されるため、初期表示が高速
- JavaScript バンドルサイズが削減される

### 2. SEO

- サーバー側レンダリングにより SEO に有利
- OGP メタデータの動的生成が可能

### 3. セキュリティ

- データベース接続情報などの機密情報がクライアントに送信されない
- API キーなどをサーバー側で安全に使用可能

## 注意事項

### Server Component で使用できないもの

- React Hooks（useState、useEffect など）
- ブラウザ固有の API
- イベントハンドラー（onClick など）

### Client Component が必要な場合の判断基準

- ユーザーインタラクション（クリック、入力など）
- ブラウザの状態管理
- リアルタイム更新
- サードパーティライブラリの使用（ブラウザ依存）

## 条件付きレンダリング

### 認証状態による条件分岐

```tsx
export function ConditionalComponent({ session }: { session: Session | null }) {
  return (
    <div>
      {session?.user ? <UserContent user={session.user} /> : <SignInPrompt />}
    </div>
  );
}
```

### データ存在チェック

```tsx
export function DataDisplayComponent({ data }: { data: Item[] }) {
  return (
    <div>
      {data.length > 0 ? (
        <ItemList items={data} />
      ) : (
        <div className="text-muted-foreground py-8 text-center">
          データがありません
        </div>
      )}
    </div>
  );
}
```

## Suspense パターン

### データ分離によるローディング

```tsx
import { Suspense } from 'react';
import { DataList } from '@/components/data/data-list';
import { DataListSkeleton } from '@/components/data/data-list-skeleton';

export default function DataPage() {
  return (
    <Suspense fallback={<DataListSkeleton />}>
      <DataList />
    </Suspense>
  );
}
```

### 複数のSuspense境界

```tsx
export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <Suspense fallback={<HeaderSkeleton />}>
        <DashboardHeader />
      </Suspense>
      
      <Suspense fallback={<ChartsSkeleton />}>
        <DashboardCharts />
      </Suspense>
      
      <Suspense fallback={<TableSkeleton />}>
        <DashboardTable />
      </Suspense>
    </div>
  );
}
```

## Metadata の生成

### 静的メタデータ

```tsx
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ページタイトル',
  description: 'ページの説明',
};

export default function Page() {
  return <div>コンテンツ</div>;
}
```

### 動的メタデータ

```tsx
import { Metadata } from 'next';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await getData(params.id);
  
  return {
    title: data.title,
    description: data.description,
  };
}

export default async function Page({ params }: Props) {
  const data = await getData(params.id);
  return <DataDisplay data={data} />;
}
```

## パフォーマンス最適化

### 並列データ取得

```tsx
export default async function ParallelPage() {
  // 複数のデータを並列で取得
  const [user, posts, comments] = await Promise.all([
    getUser(),
    getPosts(),
    getComments(),
  ]);

  return (
    <div>
      <UserInfo user={user} />
      <PostsList posts={posts} />
      <CommentsList comments={comments} />
    </div>
  );
}
```

### キャッシュの活用

```tsx
import { unstable_cache } from 'next/cache';

// キャッシュされたデータ取得
const getCachedData = unstable_cache(
  async () => {
    return await db.data.findMany();
  },
  ['data-list'],
  { revalidate: 3600 } // 1時間
);

export default async function CachedPage() {
  const data = await getCachedData();
  return <DataList items={data} />;
}
```

## ベストプラクティス

1. **Server Component をデフォルトにする**: 特別な理由がない限り Server Component として実装
2. **エラーを適切に処理する**: try-catch で予期しないエラーをキャッチ
3. **認証を確認する**: 保護されたページでは必ずセッションをチェック
4. **Suspense を活用する**: データ取得とUIを分離してユーザー体験を向上
5. **並列処理を活用する**: 独立したデータ取得は Promise.all で並列化
