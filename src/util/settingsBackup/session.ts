import { createHmac, timingSafeEqual } from 'node:crypto'

import { SETTINGS_BACKUP_TTL_MS } from './constants'
import {
  isSettingsBackupAccountId,
  isSettingsBackupAcct,
  normalizeSettingsBackupOrigin,
} from './origin'

const AUTH_KEY_PURPOSE = 'miyulab-fe:settings-backup:key:v1'
const AUTH_SESSION_PURPOSE = 'miyulab-fe:settings-backup:session:v1'
const SESSION_SIGNATURE_BYTES = 32
const SESSION_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type SettingsBackupSession = {
  accountId: string
  acct: string
  backendUrl: string
}

export function deriveSettingsBackupAuthKey(
  databaseUrl: string | undefined,
): Buffer | null {
  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0)
    return null
  return createHmac('sha256', databaseUrl).update(AUTH_KEY_PURPOSE).digest()
}

function encodePart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodePart(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  if (encodePart(decoded) !== value) return null
  return decoded
}

function sessionMessage(
  session: SettingsBackupSession,
  expiresMs: number,
): string {
  return `${AUTH_SESSION_PURPOSE}\n${session.backendUrl}\n${session.accountId}\n${session.acct}\n${expiresMs}`
}

export function createSettingsBackupSessionValue(
  session: SettingsBackupSession,
  expiresMs: number,
  key: Buffer,
): string {
  const mac = createHmac('sha256', key)
    .update(sessionMessage(session, expiresMs))
    .digest('base64url')
  return `${expiresMs}.${encodePart(session.backendUrl)}.${encodePart(session.accountId)}.${encodePart(session.acct)}.${mac}`
}

export function readSettingsBackupSessionValue(
  value: string | undefined,
  key: Buffer,
  now: number,
): SettingsBackupSession | null {
  if (typeof value !== 'string') return null
  const parts = value.split('.')
  if (parts.length !== 5) return null
  const [expiresText, originPart, accountPart, acctPart, signature] = parts
  if (expiresText == null || originPart == null || accountPart == null)
    return null
  if (acctPart == null || signature == null) return null
  const expiresMs = Number(expiresText)
  if (!Number.isSafeInteger(expiresMs)) return null
  if (expiresMs <= now || expiresMs > now + SETTINGS_BACKUP_TTL_MS) return null
  if (!SESSION_SIGNATURE_PATTERN.test(signature)) return null
  const backendUrl = decodePart(originPart)
  const accountId = decodePart(accountPart)
  const acct = decodePart(acctPart)
  if (backendUrl == null || accountId == null || acct == null) return null
  if (normalizeSettingsBackupOrigin(backendUrl) !== backendUrl) return null
  if (!isSettingsBackupAccountId(accountId) || !isSettingsBackupAcct(acct))
    return null
  const provided = Buffer.from(signature, 'base64url')
  if (provided.length !== SESSION_SIGNATURE_BYTES) return null
  const expected = createHmac('sha256', key)
    .update(sessionMessage({ accountId, acct, backendUrl }, expiresMs))
    .digest()
  if (!timingSafeEqual(provided, expected)) return null
  return { accountId, acct, backendUrl }
}
