# テスト環境セットアップガイド

## 基本構成

このプロジェクトでは Vitest を使用してテストを実装している。

## Vitest 設定

プロジェクトの `vitest.config.ts` を確認し、以下の設定が含まれていることを確認する:

- `environment: 'jsdom'` — DOM テスト用
- `globals: true` — `describe`, `it`, `expect` 等のグローバル利用
- `setupFiles` — グローバルセットアップファイル
- エイリアス設定（`@/`, `@public`, `@zenstack` 等）

## テスト実行コマンド

```bash
# 特定のテストファイルを実行
yarn test <テストファイルパス>

# 全テストを実行
yarn test:run

# カバレッジ付きで実行
yarn test:run --coverage
```

## テストデータのライフサイクル管理

テストの独立性を保つため、`beforeEach` + `onTestFinished` パターンを使う:

```typescript
import { describe, it, expect, beforeEach, onTestFinished } from "vitest";
import { db } from "@/lib/db";

describe("ユーザー操作", () => {
  let testUser: User;

  beforeEach(async () => {
    // Arrange: テストデータ作成
    testUser = await db.user.create({
      data: { name: "テスト太郎", email: "test@example.com" },
    });

    // Cleanup: テスト完了後にデータ削除（成功・失敗問わず実行される）
    onTestFinished(async () => {
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });

  it("ユーザー名を更新した時、更新後の名前が返ること", async () => {
    // Act
    const result = await updateUser(testUser.id, { name: "更新太郎" });

    // Assert（事後条件: 戻り値）
    expect(result.name).toBe("更新太郎");

    // Assert（事後条件: DB状態）
    const saved = await db.user.findUnique({ where: { id: testUser.id } });
    expect(saved!.name).toBe("更新太郎");
  });
});
```

## テストユーティリティ

`src/test-utils/` ディレクトリにユーティリティ関数を作成・管理する。

### データファクトリー（例）

```typescript
// src/test-utils/factories.ts
import { faker } from "@faker-js/faker";
import { db } from "@/lib/db";

export async function createTestUser(overrides: Partial<UserInput> = {}) {
  return db.user.create({
    data: {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      ...overrides,
    },
  });
}

export async function createTestEvent(
  userId: string,
  overrides: Partial<EventInput> = {},
) {
  return db.event.create({
    data: {
      name: faker.lorem.words(3),
      date: faker.date.future(),
      userId,
      ...overrides,
    },
  });
}
```

### ファクトリーの活用パターン

```typescript
describe("イベント操作", () => {
  let testUser: User;
  let testEvent: Event;

  beforeEach(async () => {
    testUser = await createTestUser();
    testEvent = await createTestEvent(testUser.id);

    onTestFinished(async () => {
      await db.event.delete({ where: { id: testEvent.id } }).catch(() => {});
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });
});
```

## 外部HTTP通信のテスト

内部の HTTP クライアントをモックするのではなく、Docker で起動している Prism サーバを利用する。

```typescript
// Prism サーバへのリクエストを検証
const PRISM_BASE_URL = process.env.PRISM_BASE_URL ?? "http://localhost:4010";

it("外部APIからデータを取得した時、正しい形式で返ること", async () => {
  // Act: 実際のPrismサーバにリクエスト
  const result = await fetchExternalData(PRISM_BASE_URL);

  // Assert
  expect(result).toHaveProperty("data");
  expect(Array.isArray(result.data)).toBe(true);
});
```

## コンポーネントテスト用のレンダリングユーティリティ

```typescript
// src/test-utils/render.tsx
import { ReactElement } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { ThemeProvider } from "next-themes";

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from "@testing-library/react";
export { customRender as render };
```
