import type { App } from 'types/types'

export const DB_DIAGNOSTIC_AUTH_COOKIE = '__Host-miyulab-db-diag'
export const DB_DIAGNOSTIC_AUTH_TTL_MS = 28_800_000
export const DB_DIAGNOSTIC_AUTH_COOKIE_MAX_AGE = 28_800

const DEFAULT_OWNER_BACKEND_URL = 'https://pl.waku.dev'
const DEFAULT_OWNER_ACCOUNT_ID = 'AY71rP68i6pkmSPd1k'

export type DbDiagnosticOwnerConfig = {
  accountId: string
  backendUrl: string
}

export function normalizeDbDiagnosticBackendUrl(raw: string): string | null {
  const trimmed = raw.replace(/\/+$/, '')
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

export function isDbDiagnosticOwnerAccountId(value: string): boolean {
  return /^[^\s\p{Cc}]{1,128}$/u.test(value)
}

export function isDbDiagnosticAccessToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 8_192 &&
    /^[A-Za-z0-9\-._~+/]+=*$/.test(value)
  )
}

export function resolveDbDiagnosticOwnerConfig(
  backendUrlEnv: string | undefined,
  accountIdEnv: string | undefined,
): DbDiagnosticOwnerConfig | null {
  const urlProvided =
    typeof backendUrlEnv === 'string' && backendUrlEnv.length > 0
  const idProvided = typeof accountIdEnv === 'string' && accountIdEnv.length > 0
  if (urlProvided !== idProvided) return null
  const backendUrl = normalizeDbDiagnosticBackendUrl(
    urlProvided ? backendUrlEnv : DEFAULT_OWNER_BACKEND_URL,
  )
  const accountId = idProvided ? accountIdEnv : DEFAULT_OWNER_ACCOUNT_ID
  if (backendUrl == null || !isDbDiagnosticOwnerAccountId(accountId))
    return null
  return { accountId, backendUrl }
}

export type DbDiagnosticVerifyFetch = (
  url: string,
  init: {
    cache: 'no-store'
    headers: { Authorization: string }
    redirect: 'error'
    signal: AbortSignal
  },
) => Promise<{ json: () => Promise<unknown>; ok: boolean }>

export async function verifyDbDiagnosticOwnerToken(
  config: DbDiagnosticOwnerConfig,
  accessToken: string,
  fetchImpl: DbDiagnosticVerifyFetch,
): Promise<boolean> {
  let response: { json: () => Promise<unknown>; ok: boolean }
  try {
    response = await fetchImpl(
      `${config.backendUrl}/api/v1/accounts/verify_credentials`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      },
    )
  } catch {
    return false
  }
  if (!response.ok) return false
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return false
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return false
  return (body as { id?: unknown }).id === config.accountId
}

export function selectDbDiagnosticOwnerToken(
  apps: readonly App[],
  backendUrl: string,
): string | null {
  const target = normalizeDbDiagnosticBackendUrl(backendUrl)
  if (target == null) return null
  for (const app of apps) {
    if (normalizeDbDiagnosticBackendUrl(app.backendUrl) !== target) continue
    const token = app.tokenData?.access_token
    if (typeof token === 'string' && token.length > 0) return token
  }
  return null
}

export type DbDiagnosticAuthorizationTarget =
  | { success: true; authenticated: boolean; backendUrl: string }
  | { success: false; error: string }

export type DbDiagnosticAuthorizeResult =
  | { success: true }
  | { success: false; error: string }

export const DB_DIAGNOSTIC_AUTH_DEADLINE_MS = 30_000

export function createDbDiagnosticAuthorizer(deps: {
  apps: () => readonly App[]
  authorize: (
    backendUrl: string,
    accessToken: string,
  ) => Promise<DbDiagnosticAuthorizeResult>
  getTarget: () => Promise<DbDiagnosticAuthorizationTarget>
}): () => Promise<void> {
  let inflight: Promise<void> | null = null
  const run = async (): Promise<void> => {
    const target = await deps.getTarget()
    if (!target.success)
      throw new Error('Diagnostics authorization unavailable')
    if (target.authenticated) return
    const token = selectDbDiagnosticOwnerToken(deps.apps(), target.backendUrl)
    if (token == null) throw new Error('Owner account is not logged in')
    const result = await deps.authorize(target.backendUrl, token)
    if (!result.success) throw new Error('Diagnostics authorization failed')
  }
  const attempt = (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Diagnostics authorization timed out')),
        DB_DIAGNOSTIC_AUTH_DEADLINE_MS,
      )
    })
    return Promise.race([run(), deadline]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }
  return () => {
    if (inflight == null) {
      const current = attempt()
      inflight = current
      current.then(
        () => {
          if (inflight === current) inflight = null
        },
        () => {
          if (inflight === current) inflight = null
        },
      )
    }
    return inflight
  }
}
