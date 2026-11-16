import type { Backend } from 'types/types'

import { isSettingsBackupAccountId, isSettingsBackupAcct } from './origin'

const MASTODON_BACKENDS = new Set<Backend>([
  'mastodon',
  'pleroma',
  'friendica',
  'firefish',
  'gotosocial',
  'pixelfed',
])

export type SettingsBackupVerifyFetch = (
  url: string,
  init: {
    body?: string
    cache: 'no-store'
    headers: Record<string, string>
    method?: 'GET' | 'POST'
    redirect: 'error'
    signal: AbortSignal
  },
) => Promise<{ json: () => Promise<unknown>; ok: boolean }>

export type VerifiedSettingsAccount = {
  accountId: string
  acct: string
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value == null || Array.isArray(value))
    return null
  return value as Record<string, unknown>
}

function readMastodonAccount(value: unknown): VerifiedSettingsAccount | null {
  const body = readRecord(value)
  if (body == null) return null
  if (typeof body.id !== 'string' || typeof body.acct !== 'string') return null
  if (!isSettingsBackupAccountId(body.id) || !isSettingsBackupAcct(body.acct))
    return null
  return { accountId: body.id, acct: body.acct }
}

function readMisskeyAccount(value: unknown): VerifiedSettingsAccount | null {
  const body = readRecord(value)
  if (body == null) return null
  if (typeof body.id !== 'string' || typeof body.username !== 'string')
    return null
  const host = body.host
  const acct =
    typeof host === 'string' && host.length > 0
      ? `${body.username}@${host}`
      : body.username
  if (!isSettingsBackupAccountId(body.id) || !isSettingsBackupAcct(acct))
    return null
  return { accountId: body.id, acct }
}

export async function verifySettingsBackupAccount(
  backend: Backend,
  origin: string,
  accessToken: string,
  fetchImpl: SettingsBackupVerifyFetch,
): Promise<VerifiedSettingsAccount | null> {
  try {
    if (backend === 'misskey') {
      const response = await fetchImpl(`${origin}/api/i`, {
        body: JSON.stringify({ i: accessToken }),
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return null
      return readMisskeyAccount(await response.json())
    }
    if (!MASTODON_BACKENDS.has(backend)) return null
    const response = await fetchImpl(
      `${origin}/api/v1/accounts/verify_credentials`,
      {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` },
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      },
    )
    if (!response.ok) return null
    return readMastodonAccount(await response.json())
  } catch {
    return null
  }
}
