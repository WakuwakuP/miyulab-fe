'use server'

import { cookies } from 'next/headers'
import {
  DB_DIAGNOSTIC_AUTH_COOKIE,
  DB_DIAGNOSTIC_AUTH_COOKIE_MAX_AGE,
  DB_DIAGNOSTIC_AUTH_TTL_MS,
  isDbDiagnosticAccessToken,
  normalizeDbDiagnosticBackendUrl,
  resolveDbDiagnosticOwnerConfig,
  verifyDbDiagnosticOwnerToken,
} from 'util/db/dbDiagnosticAuth'
import {
  createDbDiagnosticSessionValue,
  deriveDbDiagnosticAuthKey,
  isDbDiagnosticSessionAuthenticated,
} from 'util/db/dbDiagnosticAuthCrypto'

let lastAuthorizeAt = 0

function getOwnerConfig() {
  return resolveDbDiagnosticOwnerConfig(
    process.env.DB_DIAGNOSTICS_OWNER_BACKEND_URL,
    process.env.DB_DIAGNOSTICS_OWNER_ACCOUNT_ID,
  )
}

export async function isDbDiagnosticOwnerAuthenticated(): Promise<boolean> {
  if (process.env.DB_DIAGNOSTICS_ENABLED === 'false') return false
  const config = getOwnerConfig()
  const jar = await cookies()
  return isDbDiagnosticSessionAuthenticated(
    jar.get(DB_DIAGNOSTIC_AUTH_COOKIE)?.value,
    process.env.DATABASE_URL,
    config,
    Date.now(),
  )
}

export async function getDbDiagnosticAuthorizationTarget(): Promise<
  | { success: true; authenticated: boolean; backendUrl: string }
  | { success: false; error: string }
> {
  if (process.env.DB_DIAGNOSTICS_ENABLED === 'false')
    return { error: 'Diagnostics are disabled', success: false }
  const config = getOwnerConfig()
  const key = deriveDbDiagnosticAuthKey(process.env.DATABASE_URL)
  if (config == null || key == null)
    return { error: 'Diagnostics are unavailable', success: false }
  return {
    authenticated: await isDbDiagnosticOwnerAuthenticated(),
    backendUrl: config.backendUrl,
    success: true,
  }
}

export async function authorizeDbDiagnostics(
  backendUrl: unknown,
  accessToken: unknown,
): Promise<
  { success: true; authenticated: true } | { success: false; error: string }
> {
  if (process.env.DB_DIAGNOSTICS_ENABLED === 'false')
    return { error: 'Diagnostics are disabled', success: false }
  const config = getOwnerConfig()
  const key = deriveDbDiagnosticAuthKey(process.env.DATABASE_URL)
  if (config == null || key == null)
    return { error: 'Diagnostics are unavailable', success: false }
  const normalized =
    typeof backendUrl === 'string'
      ? normalizeDbDiagnosticBackendUrl(backendUrl)
      : null
  if (normalized == null || normalized !== config.backendUrl)
    return { error: 'Authorization failed', success: false }
  if (!isDbDiagnosticAccessToken(accessToken))
    return { error: 'Authorization failed', success: false }
  const now = Date.now()
  if (now - lastAuthorizeAt < 1_000)
    return { error: 'Rate limited', success: false }
  lastAuthorizeAt = now
  const verified = await verifyDbDiagnosticOwnerToken(
    config,
    accessToken,
    fetch,
  )
  if (!verified) return { error: 'Authorization failed', success: false }
  const expiresMs = Date.now() + DB_DIAGNOSTIC_AUTH_TTL_MS
  const jar = await cookies()
  jar.set(
    DB_DIAGNOSTIC_AUTH_COOKIE,
    createDbDiagnosticSessionValue(config, expiresMs, key),
    {
      httpOnly: true,
      maxAge: DB_DIAGNOSTIC_AUTH_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'strict',
      secure: true,
    },
  )
  return { authenticated: true, success: true }
}
