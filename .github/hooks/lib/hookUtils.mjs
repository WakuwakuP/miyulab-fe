// Copilot CLI フックスクリプトの共通ヘルパー。
// 各フックは stdin から JSON ペイロードを受け取るため、パース処理・ツール判定・
// 子プロセス実行をここに集約して、個別フックを小さく保つ。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const EDIT_TOOL_NAMES = new Set(['edit', 'create', 'write'])

/** stdin を全て読み取り JSON としてパースする。空・不正時は null を返す。 */
export async function readHookPayload() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** `toolArgs` は JSON 文字列として渡ってくるため、安全にパースする。 */
export function parseToolArgs(payload) {
  if (!payload || typeof payload.toolArgs !== 'string') return {}
  try {
    return JSON.parse(payload.toolArgs)
  } catch {
    return {}
  }
}

export function isEditTool(toolName) {
  return EDIT_TOOL_NAMES.has(toolName)
}

export function isSuccess(payload) {
  const type = payload?.toolResult?.resultType
  return type === undefined || type === 'success'
}

/**
 * ツールから渡されたパスをリポジトリ相対パスへ解決する。
 * 対象が存在しない、またはリポジトリ外を指す場合は null を返す。
 */
export function resolveRepoRelative(targetPath, repoRoot = process.cwd()) {
  if (!targetPath) return null
  const abs = path.resolve(repoRoot, targetPath)
  if (!existsSync(abs)) return null
  let real
  try {
    real = realpathSync(abs)
  } catch {
    real = abs
  }
  const root = realpathSync(repoRoot)
  const rel = path.relative(root, real)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

export function hasExtension(filePath, extensions) {
  const ext = path.extname(filePath).toLowerCase()
  return extensions.includes(ext)
}

/**
 * コマンドを同期実行し { status, output } を返す。
 * 失敗時にまとめてログ出力できるよう stdout/stderr は結合している。
 */
export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  return { error: result.error, output, status: result.status ?? -1 }
}

/** stdout の JSON を汚染しないよう stderr にメッセージを書き出す。 */
export function log(message) {
  process.stderr.write(`${message}\n`)
}

/**
 * フック間で共有する状態ファイルのパス。リポジトリにはコミットしない想定。
 * 既定の置き場所は `.github/hooks/.state/<name>.json`。
 */
export function stateFilePath(name, repoRoot = process.cwd()) {
  return path.join(repoRoot, '.github', 'hooks', '.state', `${name}.json`)
}

export function readStateFile(name, repoRoot = process.cwd()) {
  const file = stateFilePath(name, repoRoot)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) ?? {}
  } catch {
    return {}
  }
}

export function writeStateFile(name, data, repoRoot = process.cwd()) {
  const file = stateFilePath(name, repoRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/** `preToolUse` フックからツール実行を拒否する際に呼ぶ。stdout へ 1行 JSON を書く。 */
export function denyToolUse(reason) {
  process.stdout.write(`${JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason })}\n`)
  process.exit(0)
}
