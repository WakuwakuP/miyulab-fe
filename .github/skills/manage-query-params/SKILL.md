# Manage Query Parameters Skill

## メタデータ

- **title**: ManageQueryParams
- **description**: nuqsライブラリを使用した型安全なクエリパラメータ管理スキル。Next.js App RouterでServer/Client Component間の一貫したクエリパラメータ管理を実現します。

## スキルの目的

このスキルは、以下のシナリオで使用します：

- URLクエリパラメータを型安全に管理する必要がある場合
- 検索・フィルタリング機能を実装する場合
- ページネーション機能を実装する場合
- Server ComponentとClient Componentでクエリパラメータを共有する場合
- URLの状態管理を実装する場合

## 基本原則

### 1. 型安全なパラメータ管理

**nuqsのパーサーを使用して型安全性を確保：**

- parseAsString、parseAsInteger等の型付きパーサー
- parseAsStringEnum で列挙型の定義
- withDefault でデフォルト値の設定

### 2. Server/Client間の一貫性

**createSearchParamsCache と createSerializer で統一：**

- Server Component用のキャッシュ
- URL生成用のシリアライザー
- 両方で同じパーサー定義を共有

### 3. パフォーマンス最適化

- キャッシュを活用した効率的なパラメータ取得
- 不要な再レンダリングの回避
- Suspenseによるデータ取得の分離

## 実装ワークフロー

### ステップ1: 基本設定

**1.1 NuqsAdapter の設定**

```tsx
// src/app/layout.tsx
import { NuqsAdapter } from 'nuqs/adapters/next/app';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
```

**1.2 パーサー定義の作成**

```tsx
// src/lib/search-params.ts
import {
  createSearchParamsCache,
  createSerializer,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  parseAsArrayOf,
} from 'nuqs/server';

// 型定義
export type SortOrder = 'asc' | 'desc';
export type ContentType = 'image' | 'video' | '3d';

// パーサー定義（Server/Client で共有）
export const searchParamsParsers = {
  q: parseAsString,
  page: parseAsInteger.withDefault(1),
  limit: parseAsInteger.withDefault(20),
  sort: parseAsStringEnum<SortOrder>(['asc', 'desc']).withDefault('desc'),
  type: parseAsStringEnum<ContentType>(['image', 'video', '3d']),
  tags: parseAsArrayOf(parseAsString, ',').withDefault([]),
};

// Server Component 用キャッシュ
export const searchParamsCache = createSearchParamsCache(searchParamsParsers);

// URL 生成用シリアライザー
export const serialize = createSerializer(searchParamsParsers);
```

### ステップ2: 利用可能なパーサー

詳細は`reference/query-string-management.md`を参照してください。

```tsx
import {
  parseAsString,          // 文字列（デフォルト）
  parseAsInteger,         // 整数
  parseAsFloat,           // 浮動小数点数
  parseAsBoolean,         // ブール値
  parseAsIsoDateTime,     // ISO 8601 日付時刻
  parseAsArrayOf,         // 配列
  parseAsJson,            // JSON オブジェクト
  parseAsStringEnum,      // 文字列の列挙型
  parseAsStringLiteral,   // 文字列リテラル
} from 'nuqs/server';
```

### ステップ3: Server Component での使用

**3.1 基本的な使用方法**

```tsx
// src/app/contents/page.tsx
import { searchParamsCache } from '@/lib/search-params';
import { getContents } from '@/actions/contents';
import { ContentFilters } from '@/components/content-filters';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ContentsPage({ searchParams }: PageProps) {
  // キャッシュを使ってパラメータを取得（型安全）
  const { q, page, limit, sort, type, tags } = await searchParamsCache.parse(
    searchParams
  );

  // パラメータを使ってデータ取得
  const contents = await getContents({
    query: q,
    page,
    limit,
    sort,
    type,
    tags,
  });

  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-4">コンテンツ一覧</h1>
      
      {/* フィルターコンポーネント */}
      <ContentFilters />
      
      {/* コンテンツ表示 */}
      <ContentList contents={contents} />
    </div>
  );
}
```

**3.2 Suspense による分離**

```tsx
import { Suspense } from 'react';
import { searchParamsCache } from '@/lib/search-params';

export default async function ContentsPage({ searchParams }: PageProps) {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-4">コンテンツ一覧</h1>
      
      <Suspense fallback={<FiltersSkeleton />}>
        <ContentFilters />
      </Suspense>
      
      <Suspense fallback={<ContentListSkeleton />}>
        <ContentList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// ContentList コンポーネント
async function ContentList({ searchParams }: { searchParams: PageProps['searchParams'] }) {
  const params = await searchParamsCache.parse(searchParams);
  const contents = await getContents(params);
  
  return <ContentGrid contents={contents} />;
}
```

### ステップ4: Client Component での使用

**4.1 useQueryStates フック**

```tsx
'use client';

import { useQueryStates } from 'nuqs';
import { searchParamsParsers } from '@/lib/search-params';

export function ContentFilters() {
  const [params, setParams] = useQueryStates(searchParamsParsers);

  const handleSearchChange = (query: string) => {
    setParams({ q: query, page: 1 }); // 検索時はページをリセット
  };

  const handleTypeChange = (type: ContentType) => {
    setParams({ type, page: 1 });
  };

  return (
    <div className="space-y-4">
      <Input
        value={params.q || ''}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder="検索..."
      />
      
      <Select value={params.type} onValueChange={handleTypeChange}>
        <SelectItem value="image">画像</SelectItem>
        <SelectItem value="video">動画</SelectItem>
        <SelectItem value="3d">3D</SelectItem>
      </Select>
    </div>
  );
}
```

**4.2 個別パラメータの管理**

```tsx
'use client';

import { useQueryState } from 'nuqs';
import { parseAsInteger } from 'nuqs';

export function Pagination({ totalPages }: { totalPages: number }) {
  const [page, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1)
  );

  return (
    <div className="flex gap-2">
      <Button
        onClick={() => setPage(page - 1)}
        disabled={page <= 1}
      >
        前へ
      </Button>
      <span>ページ {page} / {totalPages}</span>
      <Button
        onClick={() => setPage(page + 1)}
        disabled={page >= totalPages}
      >
        次へ
      </Button>
    </div>
  );
}
```

### ステップ5: URL生成

**5.1 serialize による URL 生成**

```tsx
import { serialize } from '@/lib/search-params';
import Link from 'next/link';

export function ContentLink({ contentId }: { contentId: string }) {
  // パラメータを保持したURLを生成
  const url = serialize('/contents', {
    q: 'search term',
    page: 2,
    type: 'image',
  });

  return (
    <Link href={url}>
      コンテンツを見る
    </Link>
  );
}
```

**5.2 パラメータのマージ**

```tsx
'use client';

import { useQueryStates } from 'nuqs';
import { searchParamsParsers } from '@/lib/search-params';

export function FilterButton({ type }: { type: ContentType }) {
  const [params, setParams] = useQueryStates(searchParamsParsers);

  const handleClick = () => {
    // 既存のパラメータを保持しつつtypeだけ変更
    setParams({ type, page: 1 });
  };

  return (
    <Button onClick={handleClick} variant={params.type === type ? 'default' : 'outline'}>
      {type}
    </Button>
  );
}
```

### ステップ6: 実践パターン

**6.1 検索機能**

```tsx
'use client';

import { useQueryState, parseAsString } from 'nuqs';
import { Input } from '@/components/ui/input';
import { useTransition } from 'react';

export function SearchBar() {
  const [query, setQuery] = useQueryState('q', parseAsString.withDefault(''));
  const [isPending, startTransition] = useTransition();

  const handleSearch = (value: string) => {
    startTransition(() => {
      setQuery(value || null); // 空文字の場合はパラメータを削除
    });
  };

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="検索..."
        disabled={isPending}
      />
      {isPending && <Spinner />}
    </div>
  );
}
```

**6.2 フィルタリング**

```tsx
'use client';

import { useQueryStates } from 'nuqs';
import { searchParamsParsers } from '@/lib/search-params';

export function FilterPanel() {
  const [params, setParams] = useQueryStates(searchParamsParsers);

  const clearFilters = () => {
    setParams({
      q: null,
      type: null,
      tags: null,
      page: 1,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3>フィルター</h3>
        <Button variant="ghost" onClick={clearFilters}>
          クリア
        </Button>
      </div>
      
      {/* フィルターコントロール */}
    </div>
  );
}
```

**6.3 タグフィルタ**

```tsx
'use client';

import { useQueryState, parseAsArrayOf, parseAsString } from 'nuqs';
import { Badge } from '@/components/ui/badge';

export function TagFilter() {
  const [tags, setTags] = useQueryState(
    'tags',
    parseAsArrayOf(parseAsString, ',').withDefault([])
  );

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {availableTags.map(tag => (
        <Badge
          key={tag}
          variant={tags.includes(tag) ? 'default' : 'outline'}
          onClick={() => toggleTag(tag)}
          className="cursor-pointer"
        >
          {tag}
        </Badge>
      ))}
    </div>
  );
}
```

## 検証チェックリスト

実装後に以下の項目を確認してください：

### 機能要件
- [ ] クエリパラメータが正しくURLに反映される
- [ ] パラメータの変更がデータ取得をトリガーする
- [ ] デフォルト値が正しく適用される

### 型安全性
- [ ] パーサーが適切に定義されている
- [ ] TypeScriptの型エラーがない
- [ ] 列挙型が正しく型付けされている

### パフォーマンス
- [ ] 不要な再レンダリングが発生していない
- [ ] Suspenseが適切に使用されている
- [ ] キャッシュが正しく機能している

### UX
- [ ] URLが人間に読みやすい
- [ ] ブラウザの戻る/進むが正しく動作する
- [ ] パラメータの変更が即座に反映される

## トラブルシューティング

### 問題: パラメータが更新されない

**原因**: NuqsAdapterが設定されていない

**解決策**:
1. layout.tsx に NuqsAdapter を追加
2. 子コンポーネントを NuqsAdapter でラップ

### 問題: 型エラーが発生する

**原因**: パーサーの定義が不適切

**解決策**:
1. parseAsStringEnum で列挙型を明示的に定義
2. withDefault でデフォルト値を設定

### 問題: デフォルト値が反映されない

**原因**: withDefault の使用方法が間違っている

**解決策**:
1. パーサーに .withDefault(value) を追加
2. null の場合の処理を確認

## 参考リソース

- `reference/query-string-management.md` - nuqs の詳細な使用方法とパターン

## 更新履歴

- 2025-12-22: 初版作成
