#!/usr/bin/env node
// preToolUse フック: 直前の編集で Biome の指摘が残っているファイルがある場合、
// 「別ファイルの新しい編集」をブロックし、先に修正するよう deny 理由で指示する。
//
// ルール:
//   - 対象ツールは edit / create / write のみ (view や grep は常に許可)
//   - pending 対象ファイル自身の編集は許可 (修正作業をブロックしないため)
//   - 同じファイルで attemptCount が MAX_ATTEMPTS を超えたら許可に切り替え、
//     無限ループを防ぐ (コード判断不能な警告や誤検知をエージェントに委ねる)
//   - pending が空なら何もせず exit 0

import {
  denyToolUse,
  isEditTool,
  parseToolArgs,
  readHookPayload,
  readStateFile,
  resolveRepoRelative,
} from '../lib/hookUtils.mjs'

const STATE_NAME = 'biome-pending'
const MAX_ATTEMPTS = 3

const payload = await readHookPayload()
if (!payload) process.exit(0)
if (!isEditTool(payload.toolName)) process.exit(0)

const pending = readStateFile(STATE_NAME)
const entries = Object.entries(pending)
if (entries.length === 0) process.exit(0)

const stuck = entries.filter(([, info]) => (info?.attemptCount ?? 0) >= MAX_ATTEMPTS)
const actionable = entries.filter(([, info]) => (info?.attemptCount ?? 0) < MAX_ATTEMPTS)
if (actionable.length === 0) process.exit(0)

const targetRel = resolveRepoRelative(parseToolArgs(payload).path)
if (targetRel && actionable.some(([file]) => file === targetRel)) process.exit(0)

const fileList = actionable
  .map(([file, info]) => `  - ${file} (attempt ${info.attemptCount})`)
  .join('\n')
const sampleIssues = actionable
  .slice(0, 2)
  .map(([file, info]) => `# ${file}\n${info.issues ?? ''}`)
  .join('\n\n')
const stuckNote = stuck.length
  ? `\n\n※ 以下のファイルは ${MAX_ATTEMPTS} 回試行しても解消しなかったため、今回は許可します:\n${stuck.map(([file]) => `  - ${file}`).join('\n')}`
  : ''

denyToolUse(
  [
    '直前の編集で Biome が指摘した未解決の警告/エラーが残っています。',
    '他のファイルを編集する前に、下記ファイルを `yarn exec biome check <path>` で確認し修正してください。',
    '',
    '未解決ファイル:',
    fileList,
    '',
    '指摘内容 (抜粋):',
    sampleIssues,
    stuckNote,
  ].join('\n'),
)
