import { describe, expect, it, vi } from 'vitest'
import {
  createNeonSettingsBackupStore,
  type SettingsBackupNeonClient,
} from './neonStore'
import type { SettingsBackupSession } from './session'

const owner: SettingsBackupSession = {
  accountId: 'account-1',
  acct: 'alice',
  backendUrl: 'https://social.example',
}

describe('createNeonSettingsBackupStore', () => {
  it('一覧・取得・削除は所有者の origin と account id で絞る', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const findMany = vi.fn().mockResolvedValue([])
    const create = vi.fn().mockResolvedValue({ id: 'id-1' })
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const store = createNeonSettingsBackupStore({
      settingsBackup: { create, deleteMany, findFirst, findMany },
    } as unknown as SettingsBackupNeonClient)

    await store.findLatest(owner)
    await store.list(owner)
    await store.getPayload(owner, '11111111-1111-4111-8111-111111111111')
    await store.delete(owner, '11111111-1111-4111-8111-111111111111')
    await store.insert(owner, {
      formatVersion: 1,
      payload: '{}',
      payloadSha256: 'abc',
      timelineCount: 2,
    })

    const where = {
      ownerAccountId: 'account-1',
      ownerBackendUrl: 'https://social.example',
    }
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where }))
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ payload: true }),
        where,
      }),
    )
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { payload: true },
        where: {
          ...where,
          id: '11111111-1111-4111-8111-111111111111',
        },
      }),
    )
    expect(deleteMany).toHaveBeenCalledWith({
      where: { ...where, id: '11111111-1111-4111-8111-111111111111' },
    })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerAccountId: 'account-1',
        ownerBackendUrl: 'https://social.example',
        payload: '{}',
      }),
      select: { id: true },
    })
    expect(JSON.stringify(create.mock.calls)).not.toContain('access_token')
  })

  it('21件目で最古を所有者の範囲から消す', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }))
    const findMany = vi.fn().mockResolvedValue(rows)
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const store = createNeonSettingsBackupStore({
      settingsBackup: {
        create: vi.fn(),
        deleteMany,
        findFirst: vi.fn(),
        findMany,
      },
    } as unknown as SettingsBackupNeonClient)
    await store.trim(owner, 20)
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [rows[20]?.id] },
        ownerAccountId: owner.accountId,
        ownerBackendUrl: owner.backendUrl,
      },
    })
  })
})
