import { describe, expect, it } from 'vitest'
import {
  isSettingsBackupAccessToken,
  normalizeSettingsBackupOrigin,
} from './origin'

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

describe('isSettingsBackupAccessToken', () => {
  it('空白や制御文字を含むトークンを拒否する', () => {
    expect(isSettingsBackupAccessToken('token')).toBe(true)
    expect(isSettingsBackupAccessToken('tok en')).toBe(false)
    expect(isSettingsBackupAccessToken('tok\nen')).toBe(false)
  })
})
