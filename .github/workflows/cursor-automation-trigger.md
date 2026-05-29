# Trigger Cursor Automation

マージに必須な GitHub Checks がすべて成功し、PR の `mergeStateStatus` が `CLEAN` になったときに、Cursor Automations の Webhook を呼び出します。

## 実行条件

- 対象ブランチに紐づく **オープンな PR** がある
- PR の作成者が **`cursor[bot]`**（Cursor Cloud Agent が作成した PR）
- PR が **ドラフトではない**
- **マージ必須のチェックがすべて完了**（`mergeStateStatus == CLEAN`）

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
  "head_branch": "cursor/..."
}
```

Automation 側のプロンプトで `pull_request.url` などを参照できます。

## 動作の補足

- `check_suite` の `completed` ごとに評価します。最後の必須チェックが通るまで `mergeStateStatus` は `CLEAN` にならないため、通常はそのタイミングで 1 回だけ Webhook が送られます。
- 同一コミット向けの実行は `concurrency` で直列化し、レースを抑えます。
- 環境変数が未設定の場合は **失敗せずスキップ** します（他ワークフローと同様）。
