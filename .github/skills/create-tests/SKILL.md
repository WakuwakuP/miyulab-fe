---
name: create-tests
description: "Vitestテストコード実装スキル。it.todoアウトラインから実行可能なテストコードを生成する。Use when: テスト実装、テストコード作成、it.todoを実装、テスト駆動開発、TDD"
argument-hint: "テスト対象のファイルパスまたはit.todoアウトラインを含むテストファイルを指定"
---

# Create Tests Skill

it.todo で定義されたテストアウトラインを、実行可能なテストコードに変換する。

## いつ使うか

- `it.todo` が定義済みのテストファイルを実装に変換したいとき
- 既存コードに対するテストコードを新規作成したいとき
- テスト駆動開発（TDD）で Red フェーズのテストを書くとき

## 絶対ルール（違反厳禁）

### 1. モックの排除

- `vi.mock` / `vi.spyOn` で対象コードの内部モジュール（Repository、API Client、ORM等）をモックすることは**絶対に禁止**
- データベース → 実際のデータベースを使用し、ORM で検証する（状態ベーステスト）
- 外部HTTP通信 → Docker で起動している Prism サーバを利用する

### 2. テストデータのライフサイクル管理

- データ作成は、前提条件を共有する `describe` ブロック内の `beforeEach` で行う
- データ削除は、**同じ `beforeEach` 内**で `onTestFinished` フックを利用して実行する
- これにより、テストの成否に関わらず確実に状態がリセットされる完全な独立性（Test Isolation）を保証する

```typescript
beforeEach(async () => {
  // Arrange: テストデータ作成
  const user = await db.user.create({ data: { name: "テスト太郎" } });

  onTestFinished(async () => {
    // Cleanup: テストデータ削除
    await db.user.delete({ where: { id: user.id } });
  });
});
```

### 3. AAA（Arrange-Act-Assert）パターンの徹底

各 `it` ブロック内を空行で視覚的に3フェーズに分け、役割を混同させない。

- **Arrange（準備）**: 各 `it` 固有の追加の前提条件を構築する。共通の前提条件は `beforeEach` に配置する
- **Act（実行）**: テスト対象の振る舞いを **1つだけ** 実行する
- **Assert（検証）**: 事後条件と不変条件を検証する

```typescript
it("ユーザーを作成した時、作成されたユーザー情報が返ること", async () => {
  // Arrange
  const input = { name: "新規ユーザー", email: "new@example.com" };

  // Act
  const result = await createUser(input);

  // Assert（事後条件: 戻り値）
  expect(result.name).toBe("新規ユーザー");

  // Assert（事後条件: DB状態）
  const saved = await db.user.findUnique({ where: { id: result.id } });
  expect(saved).not.toBeNull();
  expect(saved!.email).toBe("new@example.com");
});
```

### 4. 契約による設計（Design by Contract）の具現化

- **事後条件の検証**: 戻り値（出力値）**と** データベースの更新後の状態（SELECT して確認）の**両方**をアサートする
- **不変条件の検証**: 異常系テストでは、エラーのスローに加えて「DB状態が Act 実行前と変わっていないこと」を必ずアサートに含める

```typescript
it("不正な入力の時、エラーがスローされDBが変更されていないこと", async () => {
  // Arrange
  const countBefore = await db.user.count();

  // Act & Assert（エラーがスローされること）
  await expect(createUser({ name: "" })).rejects.toThrow();

  // Assert（不変条件: DB状態が変わっていないこと）
  const countAfter = await db.user.count();
  expect(countAfter).toBe(countBefore);
});
```

### 5. 可読性と保守性

- `beforeEach` にデータ準備をまとめても、各 `it` を読んだだけで「何がテストされているか」「なぜそのアサートか」が推測できるようにする
- `describe` は機能単位でネストし、`// --- 正常系 ---` 等のコメントでセクションを分ける
- テストケース名（`it` の第1引数）は「〜の時、〜であること」形式を維持する

### 6. テストユーティリティの活用

- `src/test-utils/` のユーティリティ関数を積極的に活用する
- 必要なユーティリティがあれば追加・改修する
- テストコードが増えるにつれ、よりよいユーティリティが整備可能ならゼロベースで再構築する

## 実装ワークフロー

### ステップ 1: コンテキストの把握

1. テスト対象のソースコードを読み、関数シグネチャ・型・依存関係を把握する
2. `it.todo` アウトラインが存在する場合、その `describe` 構造とケース名を維持する
3. テスト実行に必要なインフラ（DB、外部サービス等）を確認する
4. `src/test-utils/` の既存ユーティリティを確認し、活用可能なものを把握する

### ステップ 2: テストコードの実装

1. すべての `it.todo` を実行可能な `it` に変換する
2. [絶対ルール](#絶対ルール違反厳禁) に従って実装する
3. 共通のテストデータは `beforeEach` + `onTestFinished` パターンで管理する
4. テスト固有のデータは各 `it` の Arrange で構築する

### ステップ 3: テストの実行と修正

1. `yarn test <テストファイルパス>` でテストを実行する
2. テスト失敗時は以下の基準で判断する:
   - **テストコードが間違っている** → テストコードを修正する
   - **実装やテスト内容が間違っている** → 該当テストを `it.skip` にしてユーザに確認する
3. すべてのテストが PASS または意図的に skip されるまで繰り返す

### ステップ 4: 品質の確認

- [検証チェックリスト](#検証チェックリスト)で最終確認する

## 検証チェックリスト

### テスト独立性

- [ ] 各テストは他のテストに依存せず、単独で実行できる
- [ ] テストデータが `beforeEach` + `onTestFinished` で管理されている
- [ ] テスト実行順序を変えても結果が変わらない

### 契約の検証

- [ ] 正常系で戻り値とDB状態の両方をアサートしている
- [ ] 異常系でエラーに加えてDB不変条件をアサートしている

### コード品質

- [ ] AAA パターンが空行で視覚的に分離されている
- [ ] `vi.mock` / `vi.spyOn` を内部モジュールに使用していない
- [ ] テストケース名が仕様書として読める日本語になっている

## リファレンス

詳細なパターンと例は以下を参照:

- [テスト環境セットアップ](./reference/test-setup.md)
- [コンポーネントテスト](./reference/component-testing.md)
- [Server Actions テスト](./reference/server-actions-testing.md)
- [モック戦略](./reference/mocking-strategies.md)

プロジェクトのナレッジドキュメントも参照:

- `docs/knowledge/08-test-setup.md` - テスト環境設定
- `docs/knowledge/09-component-testing.md` - コンポーネントテスト手法
- `docs/knowledge/10-server-actions-testing.md` - Server Actions テスト
- `docs/knowledge/11-mocking-strategies.md` - モック戦略
