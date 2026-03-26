# Agent Skills

このディレクトリには、GitHub Copilot Agent用の実装スキルが含まれています。

## スキル一覧

### 1. [CreateComponent](./create-component/)

Next.js 16 + ZenStack v3環境でのコンポーネント作成スキル。

**使用時期:**
- 新しいページやUIコンポーネントを作成する必要がある場合
- Server ComponentとClient Componentの適切な使い分けが必要な場合
- shadcn/uiコンポーネントを活用したUIを実装する場合

**含まれるリファレンス:**
- `server-component.md` - Server Componentの実装パターン
- `client-component.md` - Client Componentの実装パターン
- `ui-components.md` - shadcn/uiコンポーネントの活用
- `styling.md` - スタイリングパターン

### 2. [CreateServerActions](./create-server-actions/)

ZenStack v3を活用したServer Actions作成スキル。

**使用時期:**
- データベースのCRUD操作を実装する必要がある場合
- ZenStack v3の透過的キャッシュを活用したい場合
- 認証・認可を伴うデータ操作を実装する場合

**含まれるリファレンス:**
- `server-actions.md` - Server Actionsの実装パターン
- `cache-system.md` - ZenStack v3キャッシュシステム
- `data-fetching.md` - データ取得パターン

### 3. [ManageQueryParams](./manage-query-params/)

nuqsライブラリを使用した型安全なクエリパラメータ管理スキル。

**使用時期:**
- URLクエリパラメータを型安全に管理する必要がある場合
- 検索・フィルタリング機能を実装する場合
- ページネーション機能を実装する場合

**含まれるリファレンス:**
- `query-string-management.md` - nuqsの詳細な使用方法

### 4. [CreateTests](./create-tests/)

Vitestを使用した包括的テスト作成スキル。

**使用時期:**
- コンポーネントの単体テストを作成する必要がある場合
- Server Actionsのテストを実装する場合
- ユーザーインタラクションのテストが必要な場合

**含まれるリファレンス:**
- `test-setup.md` - テスト環境のセットアップ
- `component-testing.md` - コンポーネントテスト
- `server-actions-testing.md` - Server Actionsテスト
- `mocking-strategies.md` - モック戦略

### 5. [CreateStorybook](./create-storybook/)

Storybookを使用したコンポーネントドキュメント作成スキル。

**使用時期:**
- コンポーネントのドキュメントを作成する必要がある場合
- コンポーネントの各状態を可視化したい場合
- デザインシステムを構築する場合

**含まれるリファレンス:**
- `storybook-setup.md` - Storybook環境設定
- `ui-stories.md` - UIコンポーネントStory
- `app-stories.md` - アプリケーションコンポーネントStory
- `storybook-testing.md` - Storybookテスト

## スキルの構成

各スキルは以下の構成で提供されています：

```
<skill-name>/
├── SKILL.md                    # メインスキル定義（500行以内）
│   ├── メタデータ（title, description）
│   ├── スキルの目的
│   ├── 基本原則
│   ├── 実装ワークフロー
│   ├── 検証チェックリスト
│   ├── トラブルシューティング
│   └── 参考リソース
└── reference/                  # ドメイン固有の知識
    ├── <topic1>.md
    ├── <topic2>.md
    └── ...
```

## スキル設計の原則

各スキルは以下の品質基準を満たしています：

### コア品質
- ✅ 説明は具体的で、重要な用語が含まれている
- ✅ 説明には、スキルの機能と使用時期の両方が含まれる
- ✅ SKILL.md本体は500行未満
- ✅ 追加の詳細は別のファイルにある（reference/）
- ✅ 時間的に敏感な情報はない
- ✅ 全体を通して一貫した用語
- ✅ 例は抽象的ではなく具体的である
- ✅ ファイル参照は1レベル深くなる
- ✅ 段階的開示を適切に使用する
- ✅ ワークフローには明確な手順がある

### コードとスクリプト
- ✅ エラー処理は明確で役立つ
- ✅ 重要な操作の検証/検証手順
- ✅ 品質が重要なタスクのためのフィードバックループが含まれている

## 使用方法

GitHub Copilot Agentは、タスクに応じて適切なスキルを自動的に選択します。

手動で特定のスキルを参照する場合：

1. スキルディレクトリを開く
2. `SKILL.md` でメインガイドを確認
3. 必要に応じて `reference/` 内の詳細ドキュメントを参照

## 更新履歴

- 2025-12-22: 初版作成
  - CreateComponent スキル追加
  - CreateServerActions スキル追加
  - ManageQueryParams スキル追加
  - CreateTests スキル追加
  - CreateStorybook スキル追加
