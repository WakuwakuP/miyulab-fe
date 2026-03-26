# テストにおけるモック・外部依存の扱い

## 基本方針

このプロジェクトでは、内部モジュールに対するモック（`vi.mock` / `vi.spyOn`）の使用を**禁止**している。
代わりに、実際のインフラを使った状態ベーステストを基本とする。

## 許可されるモック・代替手段

| 対象               | 手段                                         |
| ------------------ | -------------------------------------------- |
| データベース       | 実際のDB（テスト用DB）を使用。ORM で検証する |
| 外部HTTP通信       | Docker で起動した Prism サーバを利用          |
| 環境変数           | テスト用の `.env.test` で制御               |
| 時刻（Date.now()） | Vitest の `vi.useFakeTimers()` で制御可能   |

## 禁止されるモックパターン

以下のパターンは**絶対に使用しない**:

```typescript
// ❌ 禁止: 内部モジュールのモック
vi.mock("@/lib/db");
vi.mock("@/actions/user");
vi.mock("@zenstackhq/runtime");
vi.spyOn(db.user, "create");

// ❌ 禁止: モック戻り値に基づく検証
vi.mocked(db.user.create).mockResolvedValue(mockUser);
expect(db.user.create).toHaveBeenCalledWith(/* ... */);
```

## 正しいテスト方針

### データベーステスト

実際のデータベースに対して CRUD 操作を行い、その結果を検証する:

```typescript
it("ユーザーを作成した時、DBにレコードが存在すること", async () => {
  // Act
  const result = await createUser({ name: "テスト", email: "test@example.com" });

  // Assert（戻り値）
  expect(result.name).toBe("テスト");

  // Assert（DB状態を直接確認）
  const saved = await db.user.findUnique({ where: { id: result.id } });
  expect(saved).not.toBeNull();
  expect(saved!.email).toBe("test@example.com");
});
```

### 外部通信のテスト

Docker で起動した Prism サーバ（モックAPIサーバ）にリクエストを送り、レスポンスを検証する:

```typescript
const PRISM_BASE_URL = process.env.PRISM_BASE_URL ?? "http://localhost:4010";

it("外部APIからデータを取得した時、正しい形式で返ること", async () => {
  // Act
  const result = await fetchExternalData(PRISM_BASE_URL);

  // Assert
  expect(result).toHaveProperty("data");
  expect(Array.isArray(result.data)).toBe(true);
});
```

## データファクトリー

テストデータの作成は `src/test-utils/` のファクトリー関数を使用する:

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
```

## テストデータのクリーンアップ

`beforeEach` + `onTestFinished` で作成と削除をペアにする:

```typescript
beforeEach(async () => {
  const user = await createTestUser();

  onTestFinished(async () => {
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
  });
});
```

この方式により:

- テストの成否に関わらずクリーンアップが実行される
- セットアップとティアダウンが同じ場所にあり凝集度が高い
- テストの独立性が保証される
