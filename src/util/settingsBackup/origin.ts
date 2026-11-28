import { type Backend, backendList } from 'types/types'

const DEFAULT_BACKEND_URL = 'https://pl.waku.dev'

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

/** https オリジンだけを残す。ユーザー情報、パス、クエリ、フラグメントは拒否する。 */
export function normalizeSettingsBackupOrigin(raw: string): string | null {
  const trimmed = trimTrailingSlashes(raw)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.search !== '' || url.hash !== '') return null
  if (url.pathname !== '/') return null
  return url.origin
}

function addNormalizedOrigin(origins: Set<string>, raw: string): void {
  const origin = normalizeSettingsBackupOrigin(raw)
  if (origin) origins.add(origin)
}

/** 確認済み Fediverse オリジンだけを認可先にする。 */
export function getAllowedSettingsBackupOrigins(): ReadonlySet<string> {
  const origins = new Set<string>()
  addNormalizedOrigin(
    origins,
    process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL,
  )
  for (const part of (process.env.SETTINGS_BACKUP_ALLOWED_ORIGINS ?? '').split(
    ',',
  )) {
    addNormalizedOrigin(origins, part.trim())
  }
  return origins
}

export function isAllowedSettingsBackupOrigin(
  origin: string,
  allowed: ReadonlySet<string>,
): boolean {
  return allowed.has(origin)
}

export function isSettingsBackupBackend(value: unknown): value is Backend {
  return (
    typeof value === 'string' &&
    (backendList as readonly string[]).includes(value)
  )
}

export function isSettingsBackupAccessToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 8_192 &&
    /^[A-Za-z0-9\-._~+/]+=*$/.test(value)
  )
}

export function isSettingsBackupAccountId(value: string): boolean {
  return /^[^\s\p{Cc}]{1,128}$/u.test(value)
}

export function isSettingsBackupAcct(value: string): boolean {
  return /^[^\s\p{Cc}]{1,320}$/u.test(value)
}
