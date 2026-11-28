export const SETTINGS_BACKUP_FORMAT = 'miyulab-settings-backup'
export const SETTINGS_BACKUP_VERSION = 1
export const SETTINGS_BACKUP_CHANNEL = 'miyulab-settings'
export const SETTINGS_BACKUP_KEEP = 10
export const SETTINGS_BACKUP_GLOBAL_MAX = 200
export const SETTINGS_BACKUP_MAX_BYTES = 2 * 1024 * 1024
export const SETTINGS_AUTHORIZE_INTERVAL_MS = 1_000
export const SETTINGS_CREATE_INTERVAL_MS = 10_000
export const SETTINGS_BACKUP_TTL_MS = 28_800_000
export const SETTINGS_BACKUP_COOKIE_MAX_AGE = 28_800
export const SETTINGS_BACKUP_COOKIE = '__Host-miyulab-settings'

export const SETTINGS_BACKUP_STORAGE_KEYS = [
  'timelineSettings',
  'setting',
  'playerSetting',
  'hashtagHistory',
  'users',
  'tags',
] as const

export type SettingsBackupStorageKey =
  (typeof SETTINGS_BACKUP_STORAGE_KEYS)[number]

export const SETTINGS_BACKUP_ERRORS = {
  authorizationFailed: 'Authorization failed',
  invalid: 'Invalid backup',
  quotaExceeded: 'Quota exceeded',
  rateLimited: 'Rate limited',
  unavailable: 'Cloud backup is unavailable',
} as const

export type SettingsBackupError =
  (typeof SETTINGS_BACKUP_ERRORS)[keyof typeof SETTINGS_BACKUP_ERRORS]

export type SettingsBackupFailure = {
  error: SettingsBackupError
  success: false
}
