# コンポーネントテストガイド

## 基本方針

コンポーネントのテストでは React Testing Library を使用し、
ユーザーの操作に近い形でテストする。

## Client Component のテスト

### 基本的なレンダリングテスト

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserCard } from "./UserCard";

describe("UserCard", () => {
  it("ユーザー名が表示されること", () => {
    // Arrange & Act
    render(<UserCard name="テスト太郎" email="test@example.com" />);

    // Assert
    expect(screen.getByText("テスト太郎")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });
});
```

### ユーザーインタラクションのテスト

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Counter } from "./Counter";

describe("Counter", () => {
  it("ボタンクリックでカウントが増加する時、表示が更新されること", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<Counter />);

    // Act
    await user.click(screen.getByRole("button", { name: "カウントアップ" }));

    // Assert
    expect(screen.getByText("Count: 1")).toBeInTheDocument();
  });
});
```

### フォームのテスト

```typescript
import { describe, it, expect, beforeEach, onTestFinished } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventForm } from "./EventForm";

describe("EventForm", () => {
  it("フォーム送信した時、正しいデータが送信されること", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<EventForm />);

    // Act
    await user.type(screen.getByLabelText("イベント名"), "テストイベント");
    await user.type(screen.getByLabelText("開催日"), "2024-12-25");
    await user.click(screen.getByRole("button", { name: "作成" }));

    // Assert
    await waitFor(() => {
      expect(screen.getByText("イベントが作成されました")).toBeInTheDocument();
    });
  });

  it("必須項目が空の時、バリデーションエラーが表示されること", async () => {
    // Arrange
    const user = userEvent.setup();
    render(<EventForm />);

    // Act（空のまま送信）
    await user.click(screen.getByRole("button", { name: "作成" }));

    // Assert
    expect(screen.getByText("イベント名は必須です")).toBeInTheDocument();
  });
});
```

## Server Component のテスト

Server Component は非同期関数として実装されているため、呼び出してからレンダリングする。

```typescript
import { describe, it, expect, beforeEach, onTestFinished } from "vitest";
import { render, screen } from "@testing-library/react";
import { db } from "@/lib/db";
import { createTestUser } from "@/test-utils/factories";
import HomePage from "./page";

describe("HomePage", () => {
  let testUser: User;

  beforeEach(async () => {
    testUser = await createTestUser();

    onTestFinished(async () => {
      await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
    });
  });

  it("認証済みの時、ユーザー名が表示されること", async () => {
    // Act: Server Component を実行してJSXを取得
    const Component = await HomePage();
    render(Component);

    // Assert
    expect(screen.getByText(testUser.name)).toBeInTheDocument();
  });
});
```

## ダイアログ操作のテスト

```typescript
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";

describe("DeleteConfirmDialog", () => {
  it("確認ボタンをクリックした時、onConfirmが呼ばれること", async () => {
    // Arrange
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    // Act
    await user.click(screen.getByRole("button", { name: "削除" }));

    // Assert
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ESCキーを押した時、ダイアログが閉じること", () => {
    // Arrange
    const onCancel = vi.fn();
    render(
      <DeleteConfirmDialog
        isOpen={true}
        title="削除確認"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );

    // Act
    fireEvent.keyDown(document, { key: "Escape" });

    // Assert
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

## テストの注意点

### コンポーネントのコールバックについて

コンポーネントの props として渡すコールバック関数（`onSubmit`, `onConfirm`, `onClick` 等）は、
コンポーネントの**外部インターフェース**であるため、`vi.fn()` で検証することが許可される。
これは内部モジュールのモックとは異なり、コンポーネントの契約を検証する行為である。

### 非同期処理の待機

```typescript
// waitFor で非同期の状態変化を待つ
await waitFor(() => {
  expect(screen.getByText("完了")).toBeInTheDocument();
});

// findBy* は waitFor のショートカット
const element = await screen.findByText("完了");
```

### アクセシビリティを意識したクエリ

以下の優先順位でクエリを選択する:

1. `getByRole` — アクセシビリティロール（推奨）
2. `getByLabelText` — フォーム要素
3. `getByText` — テキストコンテンツ
4. `getByTestId` — 最終手段
