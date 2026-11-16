import type * as BackupActions from 'app/actions/settingsBackup.server'
import { fn } from 'storybook/test'

export const getSettingsBackupStatus = fn<
  typeof BackupActions.getSettingsBackupStatus
>(async () => ({
  matchesToken: true,
  session: null,
  success: true,
}))
export const listSettingsBackups = fn<typeof BackupActions.listSettingsBackups>(
  async () => ({
    backups: [
      {
        createdAt: '2026-11-16T08:00:00Z',
        formatVersion: 1,
        id: 'storybook-backup-1',
        timelineCount: 3,
      },
      {
        createdAt: '2026-11-15T08:00:00Z',
        formatVersion: 1,
        id: 'storybook-backup-2',
        timelineCount: 2,
      },
    ],
    success: true,
  }),
)
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
