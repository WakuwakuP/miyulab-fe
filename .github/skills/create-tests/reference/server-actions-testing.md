# Server Actions テスト実装ガイド

## 基本方針

Server Actions のテストでは、内部モジュールのモック（vi.mock / vi.spyOn）は使用せず、
実際のデータベースを使用した状態ベーステストを実装する。

## テスト構造

### CRUD 操作の基本パターン

```typescript
import { describe, it, expect, beforeEach, onTestFinished } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "@/test-utils/factories";

describe("createPost", () => {
  let testUser: User;

  beforeEach(async () => {
    testUser = await createTestUser();

    onTestFinished(async () => {
      await db.post
        .deleteMany({ where: { authorId: testUser.id } })
        .catch(() => {});
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });

  // --- 正常系 ---
  it("有効なデータで投稿を作成した時、作成された投稿が返ること", async () => {
    // Arrange
    const input = {
      title: "テスト投稿",
      content: "テスト内容",
      authorId: testUser.id,
    };

    // Act
    const result = await createPost(input);

    // Assert（事後条件: 戻り値）
    expect(result.title).toBe("テスト投稿");
    expect(result.authorId).toBe(testUser.id);

    // Assert（事後条件: DB状態）
    const saved = await db.post.findUnique({ where: { id: result.id } });
    expect(saved).not.toBeNull();
    expect(saved!.title).toBe("テスト投稿");
  });

  // --- 異常系 ---
  it("タイトルが空の時、エラーがスローされDBが変更されていないこと", async () => {
    // Arrange
    const countBefore = await db.post.count({
      where: { authorId: testUser.id },
    });

    // Act & Assert
    await expect(
      createPost({ title: "", content: "テスト", authorId: testUser.id }),
    ).rejects.toThrow();

    // Assert（不変条件: DB状態が変わっていないこと）
    const countAfter = await db.post.count({
      where: { authorId: testUser.id },
    });
    expect(countAfter).toBe(countBefore);
  });
});
```

## UPDATE 操作のパターン

```typescript
describe("updatePost", () => {
  let testUser: User;
  let testPost: Post;

  beforeEach(async () => {
    testUser = await createTestUser();
    testPost = await db.post.create({
      data: {
        title: "元のタイトル",
        content: "元の内容",
        authorId: testUser.id,
      },
    });

    onTestFinished(async () => {
      await db.post.delete({ where: { id: testPost.id } }).catch(() => {});
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });

  it("タイトルを更新した時、更新後のタイトルが返りDBにも反映されていること", async () => {
    // Act
    const result = await updatePost(testPost.id, { title: "更新後タイトル" });

    // Assert（事後条件: 戻り値）
    expect(result.title).toBe("更新後タイトル");

    // Assert（事後条件: DB状態）
    const saved = await db.post.findUnique({ where: { id: testPost.id } });
    expect(saved!.title).toBe("更新後タイトル");
    expect(saved!.content).toBe("元の内容"); // 変更していないフィールドは維持
  });
});
```

## DELETE 操作のパターン

```typescript
describe("deletePost", () => {
  let testUser: User;
  let testPost: Post;

  beforeEach(async () => {
    testUser = await createTestUser();
    testPost = await db.post.create({
      data: { title: "削除対象", content: "テスト", authorId: testUser.id },
    });

    onTestFinished(async () => {
      await db.post.delete({ where: { id: testPost.id } }).catch(() => {});
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });

  it("投稿を削除した時、DBから該当レコードが消えていること", async () => {
    // Act
    await deletePost(testPost.id);

    // Assert（事後条件: DB状態）
    const deleted = await db.post.findUnique({ where: { id: testPost.id } });
    expect(deleted).toBeNull();
  });

  it("存在しないIDで削除した時、エラーがスローされ他のデータが影響を受けないこと", async () => {
    // Arrange
    const countBefore = await db.post.count();

    // Act & Assert
    await expect(deletePost("non-existent-id")).rejects.toThrow();

    // Assert（不変条件）
    const countAfter = await db.post.count();
    expect(countAfter).toBe(countBefore);
  });
});
```

## 認証が必要な操作のテスト

認証状態はテストDB上にセッションデータを作成して制御する。

```typescript
describe("認証が必要な操作", () => {
  let authenticatedUser: User;
  let session: Session;

  beforeEach(async () => {
    authenticatedUser = await createTestUser();
    session = await createTestSession(authenticatedUser.id);

    onTestFinished(async () => {
      await db.session
        .delete({ where: { id: session.id } })
        .catch(() => {});
      await db.user
        .delete({ where: { id: authenticatedUser.id } })
        .catch(() => {});
    });
  });

  it("認証済みユーザーがデータを作成した時、正常に作成されること", async () => {
    // Act
    const result = await createPostAsUser(session.token, {
      title: "テスト",
      content: "内容",
    });

    // Assert
    expect(result.authorId).toBe(authenticatedUser.id);
  });

  it("未認証でデータを作成した時、認証エラーがスローされDBが変更されないこと", async () => {
    // Arrange
    const countBefore = await db.post.count();

    // Act & Assert
    await expect(
      createPostAsUser(null, { title: "テスト", content: "内容" }),
    ).rejects.toThrow("認証が必要です");

    // Assert（不変条件）
    const countAfter = await db.post.count();
    expect(countAfter).toBe(countBefore);
  });
});
```

## テスト失敗時の判断基準

テスト実行後に失敗した場合:

1. **テストコードが間違っている** → テストコードを修正する
2. **実装やテスト内容が間違っている** → 該当テストを `it.skip` にしてユーザに確認する
