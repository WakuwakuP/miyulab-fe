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
  getItem(key: string): string | null
  removeItem(key: string): void
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
  const previous = new Map<SettingsBackupStorageKey, string | null>()
  const keys = SETTINGS_BACKUP_STORAGE_KEYS.filter((key) => key in payload)
  try {
    for (const key of keys) previous.set(key, deps.storage.getItem(key))
    for (const key of keys) {
      const value = payload[key]
      deps.storage.setItem(key, JSON.stringify(value))
    }
  } catch {
    for (const key of keys) {
      if (!previous.has(key)) continue
      const prior = previous.get(key) ?? null
      try {
        if (prior == null) deps.storage.removeItem(key)
        else deps.storage.setItem(key, prior)
      } catch {
        // 戻し書きも失敗したキーは、それ以上触らない。
      }
    }
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
