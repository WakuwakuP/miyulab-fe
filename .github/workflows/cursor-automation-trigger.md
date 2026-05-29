# Trigger Cursor Automation

マージに必須な GitHub Checks がすべて**実行完了**したときに、Cursor Automations の Webhook を呼び出します。成功・失敗どちらでもトリガーします（実行中のチェックが残っている間は送りません）。

## 実行条件

- 対象ブランチに紐づく **オープンな PR** がある
<<<<<<< HEAD
- PR の作成者ログインが **`app/cursor`**（GitHub App。旧形式の `cursor[bot]` も可）。`author.login` を Actions ログに出力
=======
- PR の作成者ログインが **`cursor[bot]`** と完全一致（`author.login`。Actions ログに実際の login / type を出力）
>>>>>>> origin/main
- PR が **ドラフトではない**
- **マージ必須のチェックがすべて実行完了**（`gh pr checks --required` で pending がないこと。失敗していても可）

## GitHub Actions の設定

リポジトリの Settings → Secrets and variables → Actions で次を設定します。

| 種別 | 名前 | 内容 |
| --- | --- | --- |
| Variable | `CURSOR_AUTOMATION_WEBHOOK_URL` | Automations の Webhook トリガー URL（保存後に表示） |
| Secret | `CURSOR_AUTOMATION_WEBHOOK_API_KEY` | Webhook 用 API キー（`crsr_...`。`Authorization: Bearer` で送信） |

Webhook URL と API キーは [cursor.com/automations](https://cursor.com/automations) で Automation を保存したあと、Webhook トリガーから取得します。

## Webhook ペイロード

```json
{
  "event": "github.required_checks.completed",
  "repository": "owner/repo",
  "pull_request": {
    "number": 123,
    "url": "https://github.com/owner/repo/pull/123"
  },
  "head_sha": "...",
  "head_branch": "cursor/...",
  "required_checks": {
    "completed": true,
    "passed": false
  }
}
```

`required_checks.passed` が `false` のときは必須チェックのいずれかが失敗しています。

Automation 側のプロンプトで `pull_request.url` などを参照できます。

## 動作の補足

- `check_suite` の `completed` ごとに評価します。最後の必須チェックが完了するまで pending が残るため、通常はそのタイミングで 1 回だけ Webhook が送られます。
- 同一コミット向けの実行は `concurrency` で直列化し、レースを抑えます。
- 環境変数が未設定の場合は **失敗せずスキップ** します（他ワークフローと同様）。
