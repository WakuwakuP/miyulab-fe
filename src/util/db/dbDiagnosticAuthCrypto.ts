import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  DB_DIAGNOSTIC_AUTH_TTL_MS,
  type DbDiagnosticOwnerConfig,
} from './dbDiagnosticAuth'

const AUTH_KEY_PURPOSE = 'miyulab-fe:db-diag-auth:key:v1'
const AUTH_SESSION_PURPOSE = 'miyulab-fe:db-diag-auth:session:v1'
const SESSION_SIGNATURE_BYTES = 32
const SESSION_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function deriveDbDiagnosticAuthKey(
  databaseUrl: string | undefined,
): Buffer | null {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0)
    return null
  return createHmac('sha256', databaseUrl).update(AUTH_KEY_PURPOSE).digest()
}

function sessionMessage(
  config: DbDiagnosticOwnerConfig,
  expiresMs: number,
): string {
  return `${AUTH_SESSION_PURPOSE}\n${config.backendUrl}\n${config.accountId}\n${expiresMs}`
}

export function createDbDiagnosticSessionValue(
  config: DbDiagnosticOwnerConfig,
  expiresMs: number,
  key: Buffer,
): string {
  const mac = createHmac('sha256', key)
    .update(sessionMessage(config, expiresMs))
    .digest('base64url')
  return `${expiresMs}.${mac}`
}

export function verifyDbDiagnosticSessionValue(
  value: string | undefined,
  key: Buffer,
  config: DbDiagnosticOwnerConfig,
  now: number,
): boolean {
  if (typeof value !== 'string') return false
  const separator = value.indexOf('.')
  if (separator <= 0) return false
  const expiresMs = Number(value.slice(0, separator))
  const signature = value.slice(separator + 1)
  if (!Number.isSafeInteger(expiresMs)) return false
  if (expiresMs <= now || expiresMs > now + DB_DIAGNOSTIC_AUTH_TTL_MS)
    return false
  if (!SESSION_SIGNATURE_PATTERN.test(signature)) return false
  const provided = Buffer.from(signature, 'base64url')
  if (provided.length !== SESSION_SIGNATURE_BYTES) return false
  const expected = createHmac('sha256', key)
    .update(sessionMessage(config, expiresMs))
    .digest()
  return timingSafeEqual(provided, expected)
}

export function isDbDiagnosticSessionAuthenticated(
  value: string | undefined,
  databaseUrl: string | undefined,
  config: DbDiagnosticOwnerConfig | null,
  now: number,
): boolean {
  if (config == null) return false
  const key = deriveDbDiagnosticAuthKey(databaseUrl)
  if (key == null) return false
  return verifyDbDiagnosticSessionValue(value, key, config, now)
}
