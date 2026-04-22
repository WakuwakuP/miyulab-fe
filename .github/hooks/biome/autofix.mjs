#!/usr/bin/env node
// postToolUse フック: エージェントが編集したファイルに `biome check --write` を適用する。
// 1. autofix を実行
// 2. 残っている warning/error を verify (--write なし) で検出
// 3. 残件があれば `.github/hooks/.state/biome-pending.json` に記録
//    clean なら当該ファイルのエントリを削除
// 残件情報は preToolUse (enforce-clean.mjs) が次回の編集時に読み、deny 理由として使う。

import {
  hasExtension,
  isEditTool,
  isSuccess,
  log,
  parseToolArgs,
  readHookPayload,
  readStateFile,
  resolveRepoRelative,
  runCommand,
  writeStateFile,
} from '../lib/hookUtils.mjs'

const STATE_NAME = 'biome-pending'
const BIOME_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.css']

function runBiome(args, target) {
  return runCommand('yarn', ['exec', 'biome', ...args, '--no-errors-on-unmatched', target])
}

const payload = await readHookPayload()
if (!payload) process.exit(0)
if (!isEditTool(payload.toolName)) process.exit(0)
if (!isSuccess(payload)) process.exit(0)

const args = parseToolArgs(payload)
const relative = resolveRepoRelative(args.path)
if (!relative) process.exit(0)
if (!hasExtension(relative, BIOME_EXTENSIONS)) process.exit(0)

const writeResult = runBiome(['check', '--write'], relative)
if (writeResult.error) {
  log(`[biome-autofix] biome の起動に失敗: ${writeResult.error.message}`)
  process.exit(0)
}

const verifyResult = runBiome(['check', '--error-on-warnings'], relative)
const pending = readStateFile(STATE_NAME)

if (verifyResult.status === 0) {
  if (pending[relative]) {
    delete pending[relative]
    writeStateFile(STATE_NAME, pending)
  }
  process.exit(0)
}

const previous = pending[relative]
pending[relative] = {
  attemptCount: (previous?.attemptCount ?? 0) + 1,
  issues: verifyResult.output.trim(),
  lastCheckedAt: Date.now(),
}
writeStateFile(STATE_NAME, pending)

log(`[biome-autofix] ${relative} に未解決の Biome 指摘が残っています (attempt ${pending[relative].attemptCount})`)
log(pending[relative].issues)
process.exit(0)
