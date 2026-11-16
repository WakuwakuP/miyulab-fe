import type { SettingsBackupSession } from './session'

export type SettingsBackupSummary = {
  createdAt: string
  formatVersion: number
  id: string
  timelineCount: number
}

export type SettingsBackupInsert = {
  formatVersion: number
  payload: string
  payloadSha256: string
  timelineCount: number
}

export type SettingsBackupStore = {
  delete(owner: SettingsBackupSession, id: string): Promise<boolean>
  findLatest(
    owner: SettingsBackupSession,
  ): Promise<{ id: string; payloadSha256: string } | null>
  getPayload(owner: SettingsBackupSession, id: string): Promise<string | null>
  insert(
    owner: SettingsBackupSession,
    row: SettingsBackupInsert,
  ): Promise<{ id: string }>
  list(owner: SettingsBackupSession): Promise<SettingsBackupSummary[]>
  trim(owner: SettingsBackupSession, keep: number): Promise<void>
}
