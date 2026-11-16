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

function writePayloadKeys(
  storage: SettingsBackupStorage,
  keys: SettingsBackupStorageKey[],
  payload: SettingsBackupEnvelope['payload'],
): void {
  for (const key of keys) storage.setItem(key, JSON.stringify(payload[key]))
}

function restoreSnapshot(
  storage: SettingsBackupStorage,
  keys: SettingsBackupStorageKey[],
  previous: Map<SettingsBackupStorageKey, string | null>,
): void {
  for (const key of keys) {
    if (!previous.has(key)) continue
    const prior = previous.get(key) ?? null
    try {
      if (prior == null) storage.removeItem(key)
      else storage.setItem(key, prior)
    } catch {
      // 戻し書きも失敗したキーは、それ以上触らない。
    }
  }
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
    writePayloadKeys(deps.storage, keys, payload)
  } catch {
    restoreSnapshot(deps.storage, keys, previous)
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
