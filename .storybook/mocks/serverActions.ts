import { fn } from 'storybook/test'

export const getSettingsBackupStatus = fn(async () => ({
  enabled: false,
  session: null,
  success: true,
}))
export const listSettingsBackups = fn(async () => ({
  backups: [],
  success: true,
}))
const unavailable = async () => ({
  error: 'Cloud backup is unavailable in Storybook',
  success: false,
})
export const authorizeSettingsBackup = fn(unavailable)
export const createSettingsBackup = fn(unavailable)
export const getSettingsBackup = fn(unavailable)
export const deleteSettingsBackup = fn(unavailable)
export const getDbDiagnosticLogs = fn(async () => ({
  invalidWindows: 0,
  success: true,
  truncated: false,
  windows: [],
}))
export const createDbDiagnosticLogs = fn(async () => ({ success: true }))
export const createQueryLogs = fn(async () => ({ success: true }))
export const isDbDiagnosticOwnerAuthenticated = fn(async () => false)
export const getDbDiagnosticAuthorizationTarget = fn(async () => null)
export const authorizeDbDiagnostics = fn(async () => false)
