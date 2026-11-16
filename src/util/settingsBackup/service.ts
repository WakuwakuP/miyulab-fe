import { timelineCountOf } from './applyBackup'
import {
  SETTINGS_AUTHORIZE_INTERVAL_MS,
  SETTINGS_BACKUP_COOKIE,
  SETTINGS_BACKUP_COOKIE_MAX_AGE,
  SETTINGS_BACKUP_ERRORS,
  SETTINGS_BACKUP_KEEP,
  SETTINGS_BACKUP_TTL_MS,
  SETTINGS_CREATE_INTERVAL_MS,
  type SettingsBackupFailure,
} from './constants'
import {
  type SettingsBackupEnvelope,
  stableStringify,
  validateSettingsEnvelope,
} from './envelope'
import { sha256Hex } from './hash'
import {
  isSettingsBackupAccessToken,
  isSettingsBackupBackend,
  normalizeSettingsBackupOrigin,
} from './origin'
import {
  createSettingsBackupSessionValue,
  deriveSettingsBackupAuthKey,
  readSettingsBackupSessionValue,
  type SettingsBackupSession,
} from './session'
import type { SettingsBackupStore, SettingsBackupSummary } from './store'
import {
  type SettingsBackupVerifyFetch,
  verifySettingsBackupAccount,
} from './verifyAccount'

export type SettingsBackupLimits = {
  lastAuthorizeAt: number
  lastCreateAt: Map<string, number>
}

export type SettingsBackupCookieJar = {
  get(name: string): { value: string } | undefined
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean
      maxAge: number
      path: string
      sameSite: 'strict'
      secure: boolean
    },
  ): void
}

export type SettingsBackupDeps = {
  cookies: SettingsBackupCookieJar
  databaseUrl: string | undefined
  fetch: SettingsBackupVerifyFetch
  limits: SettingsBackupLimits
  now: () => number
  store: SettingsBackupStore | null
}

export function createSettingsBackupLimits(): SettingsBackupLimits {
  return { lastAuthorizeAt: 0, lastCreateAt: new Map() }
}

function failure(error: SettingsBackupFailure['error']): SettingsBackupFailure {
  return { error, success: false }
}

function unavailable(): SettingsBackupFailure {
  return failure(SETTINGS_BACKUP_ERRORS.unavailable)
}

function authorizationFailed(): SettingsBackupFailure {
  return failure(SETTINGS_BACKUP_ERRORS.authorizationFailed)
}

function invalid(): SettingsBackupFailure {
  return failure(SETTINGS_BACKUP_ERRORS.invalid)
}

function readSession(deps: SettingsBackupDeps): SettingsBackupSession | null {
  const key = deriveSettingsBackupAuthKey(deps.databaseUrl)
  if (key == null) return null
  return readSettingsBackupSessionValue(
    deps.cookies.get(SETTINGS_BACKUP_COOKIE)?.value,
    key,
    deps.now(),
  )
}

function ownerKey(session: SettingsBackupSession): string {
  return `${session.backendUrl}\n${session.accountId}`
}

export async function authorizeSettingsBackup(
  backend: unknown,
  backendUrl: unknown,
  accessToken: unknown,
  deps: SettingsBackupDeps,
): Promise<
  | SettingsBackupFailure
  | { accountId: string; acct: string; backendUrl: string; success: true }
> {
  if (deriveSettingsBackupAuthKey(deps.databaseUrl) == null)
    return unavailable()
  const origin =
    typeof backendUrl === 'string'
      ? normalizeSettingsBackupOrigin(backendUrl)
      : null
  if (
    origin == null ||
    !isSettingsBackupBackend(backend) ||
    !isSettingsBackupAccessToken(accessToken)
  )
    return authorizationFailed()
  const now = deps.now()
  if (now - deps.limits.lastAuthorizeAt < SETTINGS_AUTHORIZE_INTERVAL_MS)
    return failure(SETTINGS_BACKUP_ERRORS.rateLimited)
  deps.limits.lastAuthorizeAt = now
  const verified = await verifySettingsBackupAccount(
    backend,
    origin,
    accessToken,
    deps.fetch,
  )
  if (verified == null) return authorizationFailed()
  const key = deriveSettingsBackupAuthKey(deps.databaseUrl)
  if (key == null) return unavailable()
  const session: SettingsBackupSession = {
    accountId: verified.accountId,
    acct: verified.acct,
    backendUrl: origin,
  }
  deps.cookies.set(
    SETTINGS_BACKUP_COOKIE,
    createSettingsBackupSessionValue(
      session,
      now + SETTINGS_BACKUP_TTL_MS,
      key,
    ),
    {
      httpOnly: true,
      maxAge: SETTINGS_BACKUP_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'strict',
      secure: true,
    },
  )
  return { ...session, success: true }
}

export function getSettingsBackupStatus(deps: SettingsBackupDeps):
  | SettingsBackupFailure
  | {
      session: SettingsBackupSession | null
      success: true
    } {
  if (deriveSettingsBackupAuthKey(deps.databaseUrl) == null)
    return unavailable()
  return { session: readSession(deps), success: true }
}

export async function listSettingsBackups(
  deps: SettingsBackupDeps,
): Promise<
  SettingsBackupFailure | { backups: SettingsBackupSummary[]; success: true }
> {
  if (
    deps.store == null ||
    deriveSettingsBackupAuthKey(deps.databaseUrl) == null
  )
    return unavailable()
  const session = readSession(deps)
  if (session == null) return authorizationFailed()
  try {
    const backups = await deps.store.list(session)
    return { backups, success: true }
  } catch (error) {
    console.error(
      '[SettingsBackup] list failed',
      error instanceof Error ? error.name : 'unknown',
    )
    return unavailable()
  }
}

export async function createSettingsBackup(
  envelope: unknown,
  deps: SettingsBackupDeps,
): Promise<
  SettingsBackupFailure | { deduped: boolean; id: string; success: true }
> {
  if (
    deps.store == null ||
    deriveSettingsBackupAuthKey(deps.databaseUrl) == null
  )
    return unavailable()
  const session = readSession(deps)
  if (session == null) return authorizationFailed()
  const validated = validateSettingsEnvelope(envelope)
  if (!validated.ok) return invalid()
  const contentHash = sha256Hex(
    stableStringify({
      formatVersion: validated.envelope.formatVersion,
      payload: validated.envelope.payload,
    }),
  )
  try {
    const latest = await deps.store.findLatest(session)
    if (latest?.payloadSha256 === contentHash)
      return { deduped: true, id: latest.id, success: true }
    const now = deps.now()
    const key = ownerKey(session)
    const previous = deps.limits.lastCreateAt.get(key) ?? 0
    if (now - previous < SETTINGS_CREATE_INTERVAL_MS)
      return failure(SETTINGS_BACKUP_ERRORS.rateLimited)
    deps.limits.lastCreateAt.set(key, now)
    const stored = stableStringify(validated.envelope)
    const created = await deps.store.insert(session, {
      formatVersion: validated.envelope.formatVersion,
      payload: stored,
      payloadSha256: contentHash,
      timelineCount: timelineCountOf(validated.envelope),
    })
    try {
      await deps.store.trim(session, SETTINGS_BACKUP_KEEP)
    } catch (error) {
      console.error(
        '[SettingsBackup] trim failed',
        error instanceof Error ? error.name : 'unknown',
      )
    }
    return { deduped: false, id: created.id, success: true }
  } catch (error) {
    console.error(
      '[SettingsBackup] save failed',
      error instanceof Error ? error.name : 'unknown',
    )
    return unavailable()
  }
}

export async function getSettingsBackup(
  id: unknown,
  deps: SettingsBackupDeps,
): Promise<
  SettingsBackupFailure | { envelope: SettingsBackupEnvelope; success: true }
> {
  if (
    deps.store == null ||
    deriveSettingsBackupAuthKey(deps.databaseUrl) == null
  )
    return unavailable()
  const session = readSession(deps)
  if (session == null) return authorizationFailed()
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return invalid()
  try {
    const payload = await deps.store.getPayload(session, id)
    if (payload == null) return invalid()
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return invalid()
    }
    const validated = validateSettingsEnvelope(parsed)
    if (!validated.ok) return invalid()
    return { envelope: validated.envelope, success: true }
  } catch (error) {
    console.error(
      '[SettingsBackup] read failed',
      error instanceof Error ? error.name : 'unknown',
    )
    return unavailable()
  }
}

export async function deleteSettingsBackup(
  id: unknown,
  deps: SettingsBackupDeps,
): Promise<SettingsBackupFailure | { success: true }> {
  if (
    deps.store == null ||
    deriveSettingsBackupAuthKey(deps.databaseUrl) == null
  )
    return unavailable()
  const session = readSession(deps)
  if (session == null) return authorizationFailed()
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return invalid()
  try {
    const deleted = await deps.store.delete(session, id)
    if (!deleted) return invalid()
    return { success: true }
  } catch (error) {
    console.error(
      '[SettingsBackup] delete failed',
      error instanceof Error ? error.name : 'unknown',
    )
    return unavailable()
  }
}
