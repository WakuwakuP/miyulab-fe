import { type Backend, backendList } from 'types/types'

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
