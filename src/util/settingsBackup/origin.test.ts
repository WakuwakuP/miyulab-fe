import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAllowedSettingsBackupOrigins,
  isAllowedSettingsBackupOrigin,
  isSettingsBackupAccessToken,
  normalizeSettingsBackupOrigin,
} from './origin'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeSettingsBackupOrigin', () => {
  it('https のオリジンを正規化する', () => {
    expect(normalizeSettingsBackupOrigin('https://social.example/')).toBe(
      'https://social.example',
    )
    expect(normalizeSettingsBackupOrigin('https://social.example///')).toBe(
      'https://social.example',
    )
  })

  it('http、ユーザー情報、パス、クエリを拒否する', () => {
    expect(normalizeSettingsBackupOrigin('not a url')).toBeNull()
    expect(normalizeSettingsBackupOrigin('http://social.example')).toBeNull()
    expect(
      normalizeSettingsBackupOrigin('https://user:pass@social.example'),
    ).toBeNull()
    expect(
      normalizeSettingsBackupOrigin('https://social.example/path'),
    ).toBeNull()
    expect(
      normalizeSettingsBackupOrigin('https://social.example/?q=1'),
    ).toBeNull()
  })
})

describe('getAllowedSettingsBackupOrigins', () => {
  it('既定のバックエンドと追加の https オリジンだけを残す', () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'https://pl.waku.dev/')
    vi.stubEnv(
      'SETTINGS_BACKUP_ALLOWED_ORIGINS',
      'https://social.example, http://insecure.example, https://user:pass@evil.example',
    )
    const allowed = getAllowedSettingsBackupOrigins()
    expect(allowed).toEqual(
      new Set(['https://pl.waku.dev', 'https://social.example']),
    )
    expect(isAllowedSettingsBackupOrigin('https://pl.waku.dev', allowed)).toBe(
      true,
    )
    expect(
      isAllowedSettingsBackupOrigin('https://unlisted.example', allowed),
    ).toBe(false)
  })
})

describe('isSettingsBackupAccessToken', () => {
  it('空白や制御文字を含むトークンを拒否する', () => {
    expect(isSettingsBackupAccessToken('token')).toBe(true)
    expect(isSettingsBackupAccessToken('tok en')).toBe(false)
    expect(isSettingsBackupAccessToken('tok\nen')).toBe(false)
  })
})
