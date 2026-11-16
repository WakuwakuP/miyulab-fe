import type { TimelineConfigV2, TimelineSettingsV2 } from 'types/types'
import { cleanupNonAdvancedCustomQuery } from 'util/migration/migrateTimeline'

import {
  SETTINGS_BACKUP_ERRORS,
  SETTINGS_BACKUP_FORMAT,
  SETTINGS_BACKUP_MAX_BYTES,
  SETTINGS_BACKUP_STORAGE_KEYS,
  SETTINGS_BACKUP_VERSION,
  type SettingsBackupFailure,
  type SettingsBackupStorageKey,
} from './constants'

const SECRET_KEYS = new Set([
  'access_token',
  'client_secret',
  'refresh_token',
  'tokenData',
])
const FORBIDDEN_PAYLOAD_KEYS = new Set(['apps', 'processingAppData'])
const MAX_DEPTH = 32

type StripResult = { tooDeep: true } | { tooDeep: false; value: unknown }

const TIMELINE_TYPES = new Set([
  'home',
  'local',
  'public',
  'notification',
  'tag',
])
const STATUS_TIMELINE_TYPES = new Set(['home', 'local', 'public'])
const VISIBILITIES = new Set(['public', 'unlisted', 'private', 'direct'])
const NOTIFICATION_TYPES = new Set([
  'follow',
  'follow_request',
  'mention',
  'reblog',
  'favourite',
  'emoji_reaction',
  'poll_expired',
  'status',
])
const PLAYER_SIZES = new Set(['small', 'medium', 'large'])
const BOOLEAN_TIMELINE_FIELDS = [
  'advancedQuery',
  'onlyMedia',
  'excludeReblogs',
  'excludeReplies',
  'excludeSpoiler',
  'excludeSensitive',
  'applyMuteFilter',
  'applyInstanceBlock',
  'followsOnly',
] as const

export type SettingsBackupEnvelope = {
  exportedAt: string
  format: typeof SETTINGS_BACKUP_FORMAT
  formatVersion: typeof SETTINGS_BACKUP_VERSION
  payload: {
    hashtagHistory?: HashtagHistoryBackup[]
    playerSetting?: { volume: number }
    setting?: Record<string, unknown>
    tags?: string[]
    timelineSettings?: TimelineSettingsV2
    users?: UserBackup[]
  }
}

type HashtagHistoryBackup = {
  isPinned: boolean
  lastAccessed: number
  tag: string
}

type UserBackup = Record<string, string>

export type SettingsBackupReadResult =
  | { envelope: SettingsBackupEnvelope; ok: true }
  | (SettingsBackupFailure & { ok: false })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort((left, right) =>
    left.localeCompare(right),
  )
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function stripArray(items: unknown[], depth: number): StripResult {
  const next: unknown[] = []
  for (const item of items) {
    const stripped = stripSecrets(item, depth + 1)
    if (stripped.tooDeep) return stripped
    next.push(stripped.value)
  }
  return { tooDeep: false, value: next }
}

function stripRecord(
  record: Record<string, unknown>,
  depth: number,
): StripResult {
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(record)) {
    if (SECRET_KEYS.has(key)) continue
    const stripped = stripSecrets(child, depth + 1)
    if (stripped.tooDeep) return stripped
    next[key] = stripped.value
  }
  return { tooDeep: false, value: next }
}

function stripSecrets(value: unknown, depth: number): StripResult {
  if (depth > MAX_DEPTH) return { tooDeep: true }
  if (Array.isArray(value)) return stripArray(value, depth)
  if (isRecord(value)) return stripRecord(value, depth)
  return { tooDeep: false, value }
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
}

function isStringList(
  value: unknown,
  maxItems: number,
  maxItem: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isShortString(item, maxItem))
  )
}

function isEnumList(
  value: unknown,
  allowed: Set<string>,
  maxItems: number,
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === 'string' && allowed.has(item))
  )
}

function isBackendFilter(value: unknown): boolean {
  if (!isRecord(value) || typeof value.mode !== 'string') return false
  if (value.mode === 'all') return true
  if (value.mode === 'single')
    return isShortString(value.backendUrl, 500) && value.backendUrl.length > 0
  if (value.mode === 'composite')
    return (
      isStringList(value.backendUrls, 50, 500) && value.backendUrls.length > 0
    )
  return false
}

function isTagConfig(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.mode !== 'and' && value.mode !== 'or') return false
  return isStringList(value.tags, 50, 200)
}

function isAccountFilter(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.mode !== 'include' && value.mode !== 'exclude') return false
  return isStringList(value.accts, 500, 320)
}

function isQueryPlan(value: unknown): boolean {
  if (!isRecord(value)) return false
  return stableStringify(value).length <= 500_000
}

function optionalShortString(value: unknown, max: number): boolean {
  return value == null || isShortString(value, max)
}

function isTimelineIdentity(value: Record<string, unknown>): boolean {
  return (
    isShortString(value.id, 200) &&
    value.id.length > 0 &&
    typeof value.type === 'string' &&
    TIMELINE_TYPES.has(value.type) &&
    typeof value.order === 'number' &&
    Number.isFinite(value.order) &&
    typeof value.visible === 'boolean'
  )
}

function hasBooleanTimelineFields(value: Record<string, unknown>): boolean {
  for (const field of BOOLEAN_TIMELINE_FIELDS) {
    if (value[field] != null && typeof value[field] !== 'boolean') return false
  }
  return true
}

function isTimelineOptionalFields(value: Record<string, unknown>): boolean {
  if (!optionalShortString(value.label, 500)) return false
  if (!optionalShortString(value.tabGroup, 500)) return false
  if (!optionalShortString(value.customQuery, 100_000)) return false
  if (
    value.minMediaCount != null &&
    !isIntegerInRange(value.minMediaCount, 0, 100)
  )
    return false
  return hasBooleanTimelineFields(value)
}

function isTimelineFilters(value: Record<string, unknown>): boolean {
  if (value.backendFilter != null && !isBackendFilter(value.backendFilter))
    return false
  if (value.tagConfig != null && !isTagConfig(value.tagConfig)) return false
  if (value.accountFilter != null && !isAccountFilter(value.accountFilter))
    return false
  if (value.queryPlan != null && !isQueryPlan(value.queryPlan)) return false
  return true
}

function isTimelineEnumFields(value: Record<string, unknown>): boolean {
  if (
    value.visibilityFilter != null &&
    !isEnumList(value.visibilityFilter, VISIBILITIES, 8)
  )
    return false
  if (
    value.languageFilter != null &&
    !isStringList(value.languageFilter, 100, 35)
  )
    return false
  if (
    value.notificationFilter != null &&
    !isEnumList(value.notificationFilter, NOTIFICATION_TYPES, 20)
  )
    return false
  if (
    value.timelineTypes != null &&
    !isEnumList(value.timelineTypes, STATUS_TIMELINE_TYPES, 8)
  )
    return false
  return true
}

function isTimelineItem(value: unknown): value is TimelineConfigV2 {
  if (!isRecord(value)) return false
  return (
    isTimelineIdentity(value) &&
    isTimelineOptionalFields(value) &&
    isTimelineFilters(value) &&
    isTimelineEnumFields(value)
  )
}

function validateTimelineSettings(value: unknown): TimelineSettingsV2 | null {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    !Array.isArray(value.timelines)
  )
    return null
  if (value.timelines.length > 100) return null
  const ids = new Set<string>()
  for (const timeline of value.timelines) {
    if (!isTimelineItem(timeline)) return null
    if (ids.has(timeline.id)) return null
    ids.add(timeline.id)
  }
  return cleanupNonAdvancedCustomQuery({
    timelines: value.timelines as TimelineConfigV2[],
    version: 2,
  })
}

function validateSetting(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (
    value.backgroundPublicStreaming != null &&
    typeof value.backgroundPublicStreaming !== 'boolean'
  )
    return null
  if (value.showSensitive != null && typeof value.showSensitive !== 'boolean')
    return null
  if (
    value.playerSize != null &&
    (typeof value.playerSize !== 'string' ||
      !PLAYER_SIZES.has(value.playerSize))
  )
    return null
  if (
    value.defaultStatusVisibility != null &&
    (typeof value.defaultStatusVisibility !== 'string' ||
      !VISIBILITIES.has(value.defaultStatusVisibility))
  )
    return null
  if (
    value.recentHashtagsCount != null &&
    !isIntegerInRange(value.recentHashtagsCount, 0, 50)
  )
    return null
  if (
    value.reactionEmojis != null &&
    !isStringList(value.reactionEmojis, 200, 200)
  )
    return null
  if (value.captureRawData != null && typeof value.captureRawData !== 'boolean')
    return null
  return { ...value, captureRawData: false }
}

function validatePlayerSetting(value: unknown): { volume: number } | null {
  if (!isRecord(value)) return null
  if (
    typeof value.volume !== 'number' ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1
  )
    return null
  return { ...value, volume: value.volume }
}

function validateHashtags(value: unknown): HashtagHistoryBackup[] | null {
  if (!Array.isArray(value) || value.length > 500) return null
  const next: HashtagHistoryBackup[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    if (!isShortString(item.tag, 200)) return null
    if (typeof item.isPinned !== 'boolean') return null
    if (
      typeof item.lastAccessed !== 'number' ||
      !Number.isFinite(item.lastAccessed)
    )
      return null
    next.push({
      ...item,
      isPinned: item.isPinned,
      lastAccessed: item.lastAccessed,
      tag: item.tag,
    })
  }
  return next
}

function validateUsers(value: unknown): UserBackup[] | null {
  if (!Array.isArray(value) || value.length > 2_000) return null
  const next: UserBackup[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    for (const field of Object.values(item)) {
      if (!isShortString(field, 4_000)) return null
    }
    for (const key of ['id', 'acct', 'avatar', 'display_name'] as const) {
      if (!isShortString(item[key], 4_000)) return null
    }
    next.push({ ...item } as UserBackup)
  }
  return next
}

function validateTags(value: unknown): string[] | null {
  if (!isStringList(value, 2_000, 200)) return null
  return value
}

const CACHE_STORAGE_KEYS = new Set<SettingsBackupStorageKey>([
  'hashtagHistory',
  'users',
  'tags',
])

function boundedHashtags(value: unknown): HashtagHistoryBackup[] | null {
  if (!Array.isArray(value)) return null
  const next: HashtagHistoryBackup[] = []
  for (const item of value) {
    if (next.length >= 500) break
    if (!isRecord(item)) continue
    if (!isShortString(item.tag, 200) || typeof item.isPinned !== 'boolean')
      continue
    if (
      typeof item.lastAccessed !== 'number' ||
      !Number.isFinite(item.lastAccessed)
    )
      continue
    next.push({
      ...item,
      isPinned: item.isPinned,
      lastAccessed: item.lastAccessed,
      tag: item.tag,
    })
  }
  if (next.length === 0 && value.length > 0) return null
  return next
}

function boundedUser(item: unknown): UserBackup | null {
  if (!isRecord(item)) return null
  const row: UserBackup = {}
  for (const [key, field] of Object.entries(item)) {
    if (!isShortString(field, 4_000)) return null
    row[key] = field
  }
  for (const key of ['id', 'acct', 'avatar', 'display_name'] as const) {
    if (!isShortString(row[key], 4_000)) return null
  }
  return row
}

function boundedUsers(value: unknown): UserBackup[] | null {
  if (!Array.isArray(value)) return null
  const next: UserBackup[] = []
  for (const item of value) {
    if (next.length >= 2_000) break
    const row = boundedUser(item)
    if (row != null) next.push(row)
  }
  if (next.length === 0 && value.length > 0) return null
  return next
}

function boundedTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const next = value
    .filter((item): item is string => isShortString(item, 200))
    .slice(0, 2_000)
  if (next.length === 0 && value.length > 0) return null
  return next
}

function boundCacheValue(
  key: SettingsBackupStorageKey,
  value: unknown,
): HashtagHistoryBackup[] | UserBackup[] | string[] | null {
  if (key === 'hashtagHistory') return boundedHashtags(value)
  if (key === 'users') return boundedUsers(value)
  if (key === 'tags') return boundedTags(value)
  return null
}

function invalid(): SettingsBackupFailure & { ok: false } {
  return { error: SETTINGS_BACKUP_ERRORS.invalid, ok: false, success: false }
}

function isExportedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  )
}

function copyOptional<T>(
  raw: Record<string, unknown>,
  key: string,
  validate: (value: unknown) => T | null,
  assign: (value: T) => void,
): boolean {
  if (!(key in raw)) return true
  const parsed = validate(raw[key])
  if (parsed == null) return false
  assign(parsed)
  return true
}

function readEnvelopePayload(
  raw: Record<string, unknown>,
): SettingsBackupEnvelope['payload'] | null {
  for (const key of FORBIDDEN_PAYLOAD_KEYS) delete raw[key]
  const payload: SettingsBackupEnvelope['payload'] = {}
  const copied =
    copyOptional(raw, 'timelineSettings', validateTimelineSettings, (value) => {
      payload.timelineSettings = value
    }) &&
    copyOptional(raw, 'setting', validateSetting, (value) => {
      payload.setting = value
    }) &&
    copyOptional(raw, 'playerSetting', validatePlayerSetting, (value) => {
      payload.playerSetting = value
    }) &&
    copyOptional(raw, 'hashtagHistory', validateHashtags, (value) => {
      payload.hashtagHistory = value
    }) &&
    copyOptional(raw, 'users', validateUsers, (value) => {
      payload.users = value
    }) &&
    copyOptional(raw, 'tags', validateTags, (value) => {
      payload.tags = value
    })
  return copied ? payload : null
}

export function validateSettingsEnvelope(
  input: unknown,
): SettingsBackupReadResult {
  let cloned: unknown
  try {
    cloned = structuredClone(input)
  } catch {
    return invalid()
  }
  const stripped = stripSecrets(cloned, 0)
  if (stripped.tooDeep) return invalid()
  if (!isRecord(stripped.value)) return invalid()
  const record = stripped.value
  if (record.format !== SETTINGS_BACKUP_FORMAT) return invalid()
  if (record.formatVersion !== SETTINGS_BACKUP_VERSION) return invalid()
  if (!isExportedAt(record.exportedAt)) return invalid()
  if (!isRecord(record.payload)) return invalid()
  const payload = readEnvelopePayload(record.payload)
  if (payload == null) return invalid()
  const envelope: SettingsBackupEnvelope = {
    exportedAt: record.exportedAt,
    format: SETTINGS_BACKUP_FORMAT,
    formatVersion: SETTINGS_BACKUP_VERSION,
    payload,
  }
  if (utf8ByteLength(stableStringify(envelope)) > SETTINGS_BACKUP_MAX_BYTES)
    return invalid()
  return { envelope, ok: true }
}

function readStoredJson(
  getItem: (key: string) => string | null,
  key: SettingsBackupStorageKey,
): { missing: true } | { missing: false; value: unknown } | null {
  const raw = getItem(key)
  if (raw == null) return { missing: true }
  try {
    return { missing: false, value: JSON.parse(raw) as unknown }
  } catch {
    return null
  }
}

export function buildSettingsEnvelope(
  getItem: (key: string) => string | null,
  exportedAt: string,
): SettingsBackupReadResult {
  const payload: Record<string, unknown> = {}
  for (const key of SETTINGS_BACKUP_STORAGE_KEYS) {
    const stored = readStoredJson(getItem, key)
    if (stored == null) {
      if (CACHE_STORAGE_KEYS.has(key)) continue
      return invalid()
    }
    if (stored.missing) continue
    if (CACHE_STORAGE_KEYS.has(key)) {
      const bounded = boundCacheValue(key, stored.value)
      if (bounded != null) payload[key] = bounded
      continue
    }
    payload[key] = stored.value
  }
  return validateSettingsEnvelope({
    exportedAt,
    format: SETTINGS_BACKUP_FORMAT,
    formatVersion: SETTINGS_BACKUP_VERSION,
    payload,
  })
}
