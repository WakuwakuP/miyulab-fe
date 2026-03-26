---
name: create-component
description: "Next.js 16 + ZenStack v3環境でのコンポーネント作成スキル。Server Component優先の原則に基づき、shadcn/uiを活用した型安全なUIコンポーネントを作成します。Use when: コンポーネント作成、UI実装、ページ作成、Server/Client Component"
argument-hint: "作成するコンポーネントの要件や配置先を指定"
---

# Create Component Skill

## スキルの目的

このスキルは、以下のシナリオで使用します：

- 新しいページやUIコンポーネントを作成する必要がある場合
- Server ComponentとClient Componentの適切な使い分けが必要な場合
- shadcn/uiコンポーネントを活用したUIを実装する場合
- データ取得を含むコンポーネントを作成する場合
- レスポンシブでアクセシブルなUIを実装する場合

## 基本原則

### 1. Server Component 優先

**デフォルトでServer Componentとして実装します。** Client Componentは以下の場合のみ使用：

- ユーザーインタラクション（クリック、入力など）
- React Hooks（useState、useEffect等）の使用
- ブラウザ固有のAPI（localStorage等）

### 2. shadcn/ui 活用

**既存のshadcn/uiコンポーネントを優先使用します：**

- Button、Input、Card、Dialog等の基本コンポーネント
- Form、Table、Tabs等の複合コンポーネント
- カスタムスタイルが必要な場合も、shadcn/uiのデザインシステムに合わせる

### 3. 型安全性

- TypeScriptの型定義を適切に設定
- Props interfaceの明確な定義
- Zodを使用した入力バリデーション

## 実装ワークフロー

### ステップ1: コンポーネント設計

**1.1 要件の確認**

- コンポーネントの目的と責務を明確化
- Server/Client Componentの判断
- 必要なデータとその取得方法

**1.2 Props設計**

```typescript
// Props interfaceの定義
interface ComponentProps {
  // 必須プロパティ
  id: string;
  title: string;
  // オプショナルプロパティ
  description?: string;
  // コールバック
  onAction?: (id: string) => void;
  // スタイル関連
  className?: string;
}
```

### ステップ2: Server Componentの実装

**2.1 基本構造**

```tsx
// src/app/(site)/example/page.tsx
import { getSession } from '@/lib/auth';
import { getData } from '@/actions/data';
import { ExampleContent } from '@/components/example/example-content';

export default async function ExamplePage() {
  // 認証状態の確認
  const session = await getSession();
  
  if (!session?.user?.id) {
    return <div>認証が必要です</div>;
  }

  // データ取得（エラーハンドリング）
  let data = [];
  try {
    data = await getData();
  } catch (error) {
    console.error('Failed to fetch data:', error);
  }

  return (
    <div className="bg-background min-h-screen">
      <ExampleContent data={data} />
    </div>
  );
}
```

**2.2 データ取得のパターン**

詳細は`reference/data-fetching.md`を参照してください。

```tsx
// Server Actionsを使用したデータ取得
import { db } from '@/lib/db';

export async function getData() {
  // ZenStack v3: キャッシュは自動適用
  return await db.data.findMany({
    orderBy: { createdAt: 'desc' },
  });
}
```

**2.3 Suspenseによるデータ分離**

```tsx
// app/~/data/page.tsx
import { Suspense } from 'react';
import { DataList } from '@/components/data/data-list';
import { DataListSkeleton } from '@/components/data/data-list-skeleton';

export default function DataPage() {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold mb-4">データ一覧</h1>
      <Suspense fallback={<DataListSkeleton />}>
        <DataList />
      </Suspense>
    </div>
  );
}
```

### ステップ3: Client Componentの実装

**3.1 Client Componentが必要な場合**

詳細は`reference/client-component.md`を参照してください。

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface InteractiveFormProps {
  onSubmit: (data: FormData) => void;
}

export function InteractiveForm({ onSubmit }: InteractiveFormProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ value });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="入力してください"
      />
      <Button type="submit">送信</Button>
    </form>
  );
}
```

**3.2 State Management**

```tsx
'use client';

import { useState, useEffect } from 'react';

export function DataSubscriber() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const subscription = subscribeToData((newData) => {
      setData(newData);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isLoading) {
    return <div>読み込み中...</div>;
  }

  return <DataDisplay data={data} />;
}
```

### ステップ4: shadcn/uiコンポーネントの活用

**4.1 基本コンポーネント**

詳細は`reference/ui-components.md`を参照してください。

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function ExampleCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>カードタイトル</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Input placeholder="入力してください" />
          <Button>送信</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

**4.2 フォームコンポーネント**

```tsx
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function ContactForm() {
  return (
    <form className="space-y-4">
      <div>
        <Label htmlFor="name">名前</Label>
        <Input id="name" type="text" />
      </div>
      <div>
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" type="email" />
      </div>
      <Button type="submit">送信</Button>
    </form>
  );
}
```

**4.3 新しいコンポーネントの追加**

```bash
# shadcn/uiから新しいコンポーネントを追加
yarn dlx shadcn@latest add [component-name]

# 例
yarn dlx shadcn@latest add dialog
yarn dlx shadcn@latest add dropdown-menu
```

### ステップ5: スタイリング

**5.1 Tailwind CSSの使用**

詳細は`reference/styling.md`を参照してください。

```tsx
export function StyledComponent() {
  return (
    <div className="bg-background text-foreground p-4 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-2">タイトル</h2>
      <p className="text-muted-foreground">説明文</p>
    </div>
  );
}
```

**5.2 レスポンシブデザイン**

```tsx
export function ResponsiveLayout() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent>{item.content}</CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**5.3 条件付きスタイリング**

```tsx
import { cn } from '@/lib/utils';

export function ConditionalStyles({ isActive }: { isActive: boolean }) {
  return (
    <div
      className={cn(
        'p-4 rounded-lg',
        isActive ? 'bg-primary text-primary-foreground' : 'bg-muted'
      )}
    >
      コンテンツ
    </div>
  );
}
```

### ステップ6: エラーハンドリング

**6.1 データ取得のエラーハンドリング**

```tsx
export default async function DataPage() {
  let data = [];
  let error = null;

  try {
    data = await getData();
  } catch (e) {
    console.error('Failed to fetch data:', e);
    error = 'データの取得に失敗しました';
  }

  if (error) {
    return (
      <div className="text-destructive py-8 text-center">
        <p>{error}</p>
      </div>
    );
  }

  return <DataDisplay data={data} />;
}
```

**6.2 認証エラーのハンドリング**

```tsx
import { getSession } from '@/lib/auth';

export default async function ProtectedPage() {
  const session = await getSession();

  if (!session?.user?.id) {
    return (
      <div className="py-8 text-center">
        <p>このページを表示するにはログインが必要です</p>
        <Button asChild className="mt-4">
          <a href="/login">ログイン</a>
        </Button>
      </div>
    );
  }

  return <AuthenticatedContent userId={session.user.id} />;
}
```

### ステップ7: パフォーマンス最適化

**7.1 適切なコンポーネント分割**

```tsx
// ❌ 全体をClient Componentにしない
'use client';
export function LargePage() {
  const [state, setState] = useState(false);
  return (
    <div>
      <StaticHeader />
      <StaticContent />
      <InteractiveButton onClick={() => setState(!state)} />
    </div>
  );
}

// ✅ インタラクティブな部分のみをClient Componentに
export function OptimizedPage() {
  return (
    <div>
      <StaticHeader />
      <StaticContent />
      <InteractiveSection />
    </div>
  );
}
```

**7.2 コード分割**

```tsx
import dynamic from 'next/dynamic';

// 重いコンポーネントを動的インポート
const HeavyComponent = dynamic(() => import('@/components/heavy-component'), {
  loading: () => <div>読み込み中...</div>,
});

export function OptimizedPage() {
  return (
    <div>
      <LightComponent />
      <HeavyComponent />
    </div>
  );
}
```

## 検証チェックリスト

実装後に以下の項目を確認してください：

### 機能要件
- [ ] コンポーネントが意図した通りに動作する
- [ ] エラーケースが適切に処理されている
- [ ] 認証/認可が必要な場合、適切に実装されている

### コード品質
- [ ] TypeScriptの型エラーがない
- [ ] `@/` エイリアスを使用した絶対パスインポート
- [ ] Props interfaceが明確に定義されている
- [ ] 適切なコメントが記載されている（必要な場合）

### パフォーマンス
- [ ] Server Componentを優先使用している
- [ ] Client Componentは最小限に抑えられている
- [ ] 不要な再レンダリングが発生していない

### UI/UX
- [ ] shadcn/uiコンポーネントを活用している
- [ ] レスポンシブデザインに対応している
- [ ] アクセシビリティ（a11y）を考慮している
- [ ] ローディング状態が適切に表示される

### スタイリング
- [ ] Tailwind CSSクラスが適切に使用されている
- [ ] デザインシステムに準拠している
- [ ] 条件付きスタイリングが適切に実装されている

### ビルド・テスト
- [ ] `yarn format` でフォーマット済み
- [ ] `yarn format:check` でフォーマット確認済み
- [ ] `yarn build` でビルドが成功する
- [ ] `yarn test` でテストが通る

## トラブルシューティング

### 問題: Server Componentでフックが使えない

**原因**: Server Componentでは React Hooks を使用できません。

**解決策**: 
1. インタラクティブな部分をClient Componentとして分離
2. `'use client'` ディレクティブを追加

### 問題: データが表示されない

**原因**: データ取得のエラーまたはキャッシュの問題

**解決策**:
1. エラーハンドリングを追加してエラー内容を確認
2. コンソールログでデータを確認
3. 必要に応じてキャッシュをクリア

### 問題: TypeScriptの型エラー

**原因**: Props interfaceの定義が不適切

**解決策**:
1. Props interfaceを明確に定義
2. オプショナルプロパティには `?` を使用
3. 適切な型をインポート

## 参考リソース

- `reference/server-component.md` - Server Componentの詳細実装パターン
- `reference/client-component.md` - Client Componentの詳細実装パターン
- `reference/ui-components.md` - shadcn/ui コンポーネントの活用方法
- `reference/styling.md` - スタイリングパターンとベストプラクティス

## 更新履歴

- 2025-12-22: 初版作成
