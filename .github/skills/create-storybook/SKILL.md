# Create Storybook Skill

## メタデータ

- **title**: CreateStorybook
- **description**: Storybookを使用したNext.js 16コンポーネントのドキュメント作成スキル。UIコンポーネントとアプリケーションコンポーネントのStoryを実装します。

## スキルの目的

このスキルは、以下のシナリオで使用します：

- コンポーネントのドキュメントを作成する必要がある場合
- コンポーネントの各状態を可視化したい場合
- デザインシステムを構築する場合
- コンポーネントのインタラクションテストを追加する場合
- アクセシビリティテストを実装する場合

## 基本原則

### 1. 包括的なStory作成

**すべての重要な状態を網羅：** Default（デフォルト）、Variants（バリエーション）、States（Loading、Error、Empty等）、Interactions（インタラクション）

### 2. 適切なコンポーネント分類

**コンポーネントを適切に分類：** UI Components、App Components、Layout Components、Form Components

### 3. アクセシビリティとテスト

a11y アドオン、Interaction テスト、レスポンシブデザイン確認

## 実装ワークフロー

### ステップ1: Storybook 環境の確認

詳細は`reference/storybook-setup.md`を参照してください。設定ファイル（main.ts、preview.ts）が正しく構成されているか確認します。

### ステップ2: UI コンポーネントの Story 作成

詳細は`reference/ui-stories.md`を参照してください。

**基本的な Story 構造**

```typescript
// src/components/ui/button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: 'Button' },
};

export const Destructive: Story = {
  args: { children: '削除', variant: 'destructive' },
};

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
};
```

### ステップ3: アプリケーションコンポーネントの Story 作成

詳細は`reference/app-stories.md`を参照してください。

**データ表示コンポーネント**

```typescript
// src/components/post/post-card.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { PostCard } from './post-card';

const meta = {
  title: 'App/Post/PostCard',
  component: PostCard,
  tags: ['autodocs'],
} satisfies Meta<typeof PostCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockPost = {
  id: '1',
  title: 'サンプル投稿',
  content: 'これはサンプルの投稿内容です。',
  author: { name: 'テストユーザー' },
  createdAt: new Date('2024-01-01'),
};

export const Default: Story = {
  args: { post: mockPost },
};

export const LongContent: Story = {
  args: {
    post: { ...mockPost, content: 'これは非常に長い投稿内容です。'.repeat(10) },
  },
};
```

**データ状態の Story**

```typescript
// 正常データ
export const Default: Story = {
  args: {
    posts: [
      { id: '1', title: '投稿1', content: '内容1' },
      { id: '2', title: '投稿2', content: '内容2' },
    ],
  },
};

// 空データ
export const Empty: Story = {
  args: { posts: [] },
};

// ローディング状態
export const Loading: Story = {
  args: { posts: [], isLoading: true },
};

// エラー状態
export const Error: Story = {
  args: { posts: [], error: 'データの取得に失敗しました' },
};
```

### ステップ4: インタラクションテスト

詳細は`reference/storybook-testing.md`を参照してください。

**基本的なインタラクション**

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { Counter } from './counter';

const meta = {
  title: 'App/Counter',
  component: Counter,
  tags: ['autodocs'],
} satisfies Meta<typeof Counter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interaction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // 初期状態の確認
    expect(canvas.getByText('Count: 0')).toBeInTheDocument();
    
    // ボタンをクリック
    const button = canvas.getByRole('button', { name: 'カウントアップ' });
    await userEvent.click(button);
    
    // 値が更新されたことを確認
    expect(canvas.getByText('Count: 1')).toBeInTheDocument();
  },
};
```

**フォームインタラクション**

```typescript
export const FilledForm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // フォームに入力
    await userEvent.type(canvas.getByLabelText('名前'), 'テストユーザー');
    await userEvent.type(canvas.getByLabelText('メール'), 'test@example.com');
    
    // 送信ボタンをクリック
    await userEvent.click(canvas.getByRole('button', { name: '送信' }));
  },
};

export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    
    // 空のままで送信
    await userEvent.click(canvas.getByRole('button', { name: '送信' }));
    
    // エラーメッセージを確認
    expect(canvas.getByText('名前は必須です')).toBeInTheDocument();
  },
};
```

### ステップ5: アクセシビリティテスト

**a11y アドオンの活用**

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog';
import { Button } from './button';

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'color-contrast', enabled: true }],
      },
    },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>ダイアログを開く</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>ダイアログタイトル</DialogTitle>
        <p>ダイアログの内容がここに表示されます。</p>
      </DialogContent>
    </Dialog>
  ),
};
```

### ステップ6: レスポンシブデザイン

**ビューポートの活用**

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { Header } from './header';

const meta = {
  title: 'Layout/Header',
  component: Header,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'desktop' },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile' } },
};

export const Tablet: Story = {
  parameters: { viewport: { defaultViewport: 'tablet' } },
};
```

## 検証チェックリスト

実装後に以下の項目を確認してください：

### Story カバレッジ
- [ ] すべての主要コンポーネントにStoryがある
- [ ] デフォルト状態が定義されている
- [ ] バリエーションが網羅されている
- [ ] エラー/空データ状態がカバーされている

### ドキュメント品質
- [ ] autodocs タグが設定されている
- [ ] argTypes が適切に定義されている
- [ ] 説明文が明確である

### インタラクション
- [ ] ユーザーインタラクションがテストされている
- [ ] エラーケースがカバーされている
- [ ] アサーションが適切である

### アクセシビリティ
- [ ] a11y違反がない
- [ ] キーボード操作が可能
- [ ] スクリーンリーダー対応

## トラブルシューティング

### 問題: Storyが表示されない

**原因**: ファイル名やパターンが正しくない

**解決策**:
1. ファイル名が `*.stories.tsx` であることを確認
2. main.ts の stories パターンを確認

### 問題: スタイルが適用されない

**原因**: グローバルCSSがインポートされていない

**解決策**:
1. preview.ts で globals.css をインポート
2. デコレーターでクラスを適用

### 問題: インタラクションテストが失敗する

**原因**: 要素が見つからない

**解決策**:
1. canvas.getByRole を使用
2. await userEvent を使用

## 参考リソース

- `reference/storybook-setup.md` - Storybook環境設定の詳細
- `reference/ui-stories.md` - UIコンポーネントStoryのパターン
- `reference/app-stories.md` - アプリケーションコンポーネントStoryのパターン
- `reference/storybook-testing.md` - Storybookテストとアクセシビリティ

## 更新履歴

- 2025-12-22: 初版作成
