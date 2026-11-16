import { describe, expect, it } from 'vitest'
import { SETTINGS_BACKUP_TTL_MS } from './constants'
import {
  createSettingsBackupSessionValue,
  deriveSettingsBackupAuthKey,
  readSettingsBackupSessionValue,
} from './session'

const DB_URL = 'postgres://user:pass@host/db'
const NOW = 1_700_000_000_000
const session = {
  accountId: 'account-1',
  acct: 'alice@social.example',
  backendUrl: 'https://social.example',
}

describe('settings backup session', () => {
  it('署名したセッションを同じ鍵で読める', () => {
    const key = deriveSettingsBackupAuthKey(DB_URL)
    expect(key).not.toBeNull()
    if (key == null) return
    const value = createSettingsBackupSessionValue(
      session,
      NOW + SETTINGS_BACKUP_TTL_MS,
      key,
    )
    expect(readSettingsBackupSessionValue(value, key, NOW)).toEqual(session)
  })

  it('account id を差し替えると読めない', () => {
    const key = deriveSettingsBackupAuthKey(DB_URL)
    if (key == null) return
    const value = createSettingsBackupSessionValue(
      session,
      NOW + SETTINGS_BACKUP_TTL_MS,
      key,
    )
    const parts = value.split('.')
    parts[2] = Buffer.from('other-account', 'utf8').toString('base64url')
    expect(readSettingsBackupSessionValue(parts.join('.'), key, NOW)).toBeNull()
  })

  it('別の DATABASE_URL から作った鍵では読めない', () => {
    const key = deriveSettingsBackupAuthKey(DB_URL)
    const other = deriveSettingsBackupAuthKey('postgres://other')
    if (key == null || other == null) return
    const value = createSettingsBackupSessionValue(
      session,
      NOW + SETTINGS_BACKUP_TTL_MS,
      key,
    )
    expect(readSettingsBackupSessionValue(value, other, NOW)).toBeNull()
  })

  it('期限切れは読めない', () => {
    const key = deriveSettingsBackupAuthKey(DB_URL)
    if (key == null) return
    const value = createSettingsBackupSessionValue(session, NOW + 1_000, key)
    expect(readSettingsBackupSessionValue(value, key, NOW + 1_000)).toBeNull()
  })

  it('空の DATABASE_URL では鍵を作らない', () => {
    expect(deriveSettingsBackupAuthKey(undefined)).toBeNull()
    expect(deriveSettingsBackupAuthKey('   ')).toBeNull()
  })
})
