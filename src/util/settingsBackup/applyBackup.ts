import { notifySettingsBackupRestored } from './channel'
import {
  SETTINGS_BACKUP_ERRORS,
  SETTINGS_BACKUP_STORAGE_KEYS,
  type SettingsBackupFailure,
  type SettingsBackupStorageKey,
} from './constants'
import {
  type SettingsBackupEnvelope,
  validateSettingsEnvelope,
} from './envelope'

export type SettingsBackupStorage = {
  setItem(key: string, value: string): void
}

export type ApplySettingsBackupDeps = {
  notifyOtherTabs?: () => void
  reload: () => void
  storage: SettingsBackupStorage
}

export function applySettingsBackup(
  input: unknown,
  deps: ApplySettingsBackupDeps,
): { ok: true } | (SettingsBackupFailure & { ok: false }) {
  const validated = validateSettingsEnvelope(input)
  if (!validated.ok) return validated
  const payload = validated.envelope.payload
  try {
    for (const key of SETTINGS_BACKUP_STORAGE_KEYS) {
      if (!(key in payload)) continue
      const value = payload[key as SettingsBackupStorageKey]
      deps.storage.setItem(key, JSON.stringify(value))
    }
  } catch {
    return {
      error: SETTINGS_BACKUP_ERRORS.invalid,
      ok: false,
      success: false,
    }
  }
  try {
    ;(deps.notifyOtherTabs ?? notifySettingsBackupRestored)()
  } catch {
    // 他タブへの通知に失敗しても、このタブの復元は進める。
  }
  deps.reload()
  return { ok: true }
}

export function timelineCountOf(envelope: SettingsBackupEnvelope): number {
  return envelope.payload.timelineSettings?.timelines.length ?? 0
}
