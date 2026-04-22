# biome hooks

Copilot CLI がファイルを編集するたびに Biome の lint/format を強制するフック群。

## ファイル

| ファイル | トリガ | 役割 |
|---|---|---|
| `autofix.mjs` | `postToolUse` | 編集されたファイルに `biome check --write` を適用し、残った警告/エラーを state に記録 |
| `enforce-clean.mjs` | `preToolUse` | state に残件がある状態で **別ファイル** の編集が始まるのを deny し、先に修正するよう LLM へ指示 |

## 共有状態

`.github/hooks/.state/biome-pending.json`（gitignore 済）

```json
{
  "src/foo.ts": {
    "attemptCount": 1,
    "lastCheckedAt": 1704614700000,
    "issues": "biome のテキスト出力"
  }
}
```

- `autofix.mjs`: verify (--error-on-warnings) が失敗したら追記、成功したらエントリ削除
- `enforce-clean.mjs`: エントリが存在する間は他ファイルの edit/create/write を deny

## 許可/拒否のルール

`enforce-clean.mjs` は以下の条件で **許可**（deny しない）:

- ツールが `edit` / `create` / `write` 以外（`view` / `grep` など）
- `biome-pending.json` が空
- 編集対象が pending 中のファイル自身（修正作業をブロックしないため）
- 同じファイルが `MAX_ATTEMPTS` (= 3) 回以上残り続けた場合（無限ループ防止）

それ以外は deny し、`permissionDecisionReason` に未解決ファイルと biome 出力の抜粋を含める。

## 対象拡張子

`.ts .tsx .js .jsx .mjs .cjs .json .jsonc .css`

## 手動デバッグ

```powershell
# autofix を単体実行
'{"toolName":"edit","toolArgs":"{\"path\":\"src/foo.ts\"}","toolResult":{"resultType":"success"}}' `
  | node .github/hooks/biome/autofix.mjs

# state をクリア
Remove-Item .github/hooks/.state -Recurse -Force
```
