import type { getNeonClient } from 'util/db/neon/client'

import { SETTINGS_BACKUP_KEEP } from './constants'
import type { SettingsBackupSession } from './session'
import type {
  SettingsBackupInsert,
  SettingsBackupStore,
  SettingsBackupSummary,
} from './store'

export type SettingsBackupNeonClient = NonNullable<
  ReturnType<typeof getNeonClient>
>

function ownerWhere(owner: SettingsBackupSession) {
  return {
    ownerAccountId: owner.accountId,
    ownerBackendUrl: owner.backendUrl,
  }
}

function asIso(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date(0).toISOString()
}

export function createNeonSettingsBackupStore(
  client: SettingsBackupNeonClient,
): SettingsBackupStore {
  return {
    async delete(owner, id) {
      const result = await client.settingsBackup.deleteMany({
        where: { ...ownerWhere(owner), id },
      })
      return result.count > 0
    },
    async findLatest(owner) {
      const row = await client.settingsBackup.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, id: true, payloadSha256: true },
        where: ownerWhere(owner),
      })
      if (row?.payloadSha256 == null) return null
      return {
        createdAt: asIso(row.createdAt),
        id: row.id,
        payloadSha256: row.payloadSha256,
      }
    },
    async getPayload(owner, id) {
      const row = await client.settingsBackup.findFirst({
        select: { payload: true },
        where: { ...ownerWhere(owner), id },
      })
      return row?.payload ?? null
    },
    async insert(owner, row: SettingsBackupInsert) {
      const created = await client.settingsBackup.create({
        data: {
          formatVersion: row.formatVersion,
          ownerAccountId: owner.accountId,
          ownerBackendUrl: owner.backendUrl,
          payload: row.payload,
          payloadSha256: row.payloadSha256,
          timelineCount: row.timelineCount,
        },
        select: { id: true },
      })
      return { id: created.id }
    },
    async list(owner) {
      const rows = await client.settingsBackup.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          formatVersion: true,
          id: true,
          timelineCount: true,
        },
        take: SETTINGS_BACKUP_KEEP,
        where: ownerWhere(owner),
      })
      return rows.map(
        (row): SettingsBackupSummary => ({
          createdAt: asIso(row.createdAt),
          formatVersion: row.formatVersion ?? 0,
          id: row.id,
          timelineCount: row.timelineCount ?? 0,
        }),
      )
    },
    async trim(owner, keep) {
      const rows = await client.settingsBackup.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        where: ownerWhere(owner),
      })
      const extra = rows.slice(keep).map((row) => row.id)
      if (extra.length === 0) return
      await client.settingsBackup.deleteMany({
        where: { ...ownerWhere(owner), id: { in: extra } },
      })
    },
  }
}
