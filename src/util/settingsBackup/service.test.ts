import { describe, expect, it, vi } from 'vitest'

vi.mock('util/attachmentProxy', async () => {
  const actual = await vi.importActual<typeof import('util/attachmentProxy')>(
    'util/attachmentProxy',
  )
  return {
    isPrivateHostWithDns: async (hostname: string) =>
      actual.isPrivateHost(hostname),
  }
})

import {
  SETTINGS_BACKUP_COOKIE,
  SETTINGS_BACKUP_GLOBAL_MAX,
  SETTINGS_BACKUP_KEEP,
  SETTINGS_BACKUP_TTL_MS,
} from './constants'
import { stableStringify } from './envelope'
import { sha256Hex } from './hash'
import {
  authorizeSettingsBackup,
  createSettingsBackup,
  createSettingsBackupLimits,
  deleteSettingsBackup,
  getSettingsBackup,
  getSettingsBackupStatus,
  listSettingsBackups,
  type SettingsBackupCookieJar,
  type SettingsBackupDeps,
} from './service'
import {
  createSettingsBackupSessionValue,
  deriveSettingsBackupAuthKey,
  hashSettingsBackupAccessToken,
  readSettingsBackupSessionValue,
} from './session'
import type {
  SettingsBackupInsert,
  SettingsBackupStore,
  SettingsBackupSummary,
} from './store'
import type { SettingsBackupVerifyFetch } from './verifyAccount'

const DB_URL = 'postgres://user:pass@host/db'
const TOKEN = 'owner-token-123_ABC~+/='
const NOW = 1_700_000_000_000
const ALLOWED_ORIGINS = new Set(['https://social.example'])

type StoredRow = SettingsBackupInsert & {
  createdAt: number
  id: string
  ownerAccountId: string
  ownerBackendUrl: string
}

function memoryStore(
  clock: () => number = () => NOW,
): SettingsBackupStore & { rows: StoredRow[] } {
  const rows: StoredRow[] = []
  let sequence = 0
  const owned = (backendUrl: string, accountId: string) =>
    rows.filter(
      (row) =>
        row.ownerBackendUrl === backendUrl && row.ownerAccountId === accountId,
    )
  return {
    async countAll() {
      return rows.length
    },
    async delete(owner, id) {
      const index = rows.findIndex(
        (row) =>
          row.id === id &&
          row.ownerBackendUrl === owner.backendUrl &&
          row.ownerAccountId === owner.accountId,
      )
      if (index < 0) return false
      rows.splice(index, 1)
      return true
    },
    async findLatest(owner) {
      const mine = owned(owner.backendUrl, owner.accountId)
      const latest = mine.at(-1)
      return latest == null
        ? null
        : {
            createdAt: new Date(latest.createdAt).toISOString(),
            id: latest.id,
            payloadSha256: latest.payloadSha256,
          }
    },
    async getPayload(owner, id) {
      return (
        owned(owner.backendUrl, owner.accountId).find((row) => row.id === id)
          ?.payload ?? null
      )
    },
    async insert(owner, row) {
      sequence += 1
      const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
      rows.push({
        ...row,
        createdAt: clock(),
        id,
        ownerAccountId: owner.accountId,
        ownerBackendUrl: owner.backendUrl,
      })
      return { id }
    },
    async list(owner) {
      return owned(owner.backendUrl, owner.accountId)
        .slice()
        .reverse()
        .slice(0, SETTINGS_BACKUP_KEEP)
        .map(
          (row): SettingsBackupSummary => ({
            createdAt: new Date(row.createdAt).toISOString(),
            formatVersion: row.formatVersion,
            id: row.id,
            timelineCount: row.timelineCount,
          }),
        )
    },
    rows,
    async trim(owner, keep) {
      const mine = owned(owner.backendUrl, owner.accountId)
      const extra = mine.slice(0, Math.max(mine.length - keep, 0))
      for (const row of extra) {
        const index = rows.indexOf(row)
        if (index >= 0) rows.splice(index, 1)
      }
    },
  }
}

function cookieJar(): SettingsBackupCookieJar & { value?: string } {
  const jar: SettingsBackupCookieJar & { value?: string } = {
    get(name) {
      if (name !== SETTINGS_BACKUP_COOKIE || jar.value == null) return undefined
      return { value: jar.value }
    },
    set(name, value, options) {
      expect(name).toBe(SETTINGS_BACKUP_COOKIE)
      expect(options).toMatchObject({
        httpOnly: true,
        path: '/',
        sameSite: 'strict',
        secure: true,
      })
      expect(options).not.toHaveProperty('domain')
      jar.value = value
    },
  }
  return jar
}

function envelope(id: string, exportedAt = '2026-11-16T05:00:00.000Z') {
  return {
    exportedAt,
    format: 'miyulab-settings-backup',
    formatVersion: 1,
    payload: {
      timelineSettings: {
        timelines: [{ id, order: 0, type: 'home', visible: true }],
        version: 2,
      },
    },
  }
}

function deps(options?: {
  fetchImpl?: SettingsBackupVerifyFetch
  now?: number
}): {
  deps: SettingsBackupDeps
  jar: ReturnType<typeof cookieJar>
  store: ReturnType<typeof memoryStore>
} {
  const jar = cookieJar()
  const store = memoryStore()
  const now = options?.now ?? NOW
  const value: SettingsBackupDeps = {
    allowedOrigins: ALLOWED_ORIGINS,
    callerKey: 'test',
    cookies: jar,
    databaseUrl: DB_URL,
    fetch:
      options?.fetchImpl ??
      vi.fn<SettingsBackupVerifyFetch>(async () => ({
        json: async () => ({ acct: 'alice', id: 'remote-id' }),
        ok: true,
      })),
    limits: createSettingsBackupLimits(),
    now: () => now,
    store,
  }
  return {
    deps: value,
    jar,
    store,
  }
}

describe('settings backup service', () => {
  it('確認した account id を Cookie に入れ、トークンは入れない', async () => {
    const { deps: context, jar } = deps()
    const result = await authorizeSettingsBackup(
      'mastodon',
      'https://social.example/',
      TOKEN,
      context,
    )
    expect(result).toEqual({
      accountId: 'remote-id',
      acct: 'alice',
      backendUrl: 'https://social.example',
      success: true,
    })
    expect(jar.value).not.toContain(TOKEN)
    expect(await getSettingsBackupStatus(context, TOKEN)).toMatchObject({
      matchesToken: true,
      success: true,
    })
    expect(await getSettingsBackupStatus(context, 'other-token')).toMatchObject(
      {
        matchesToken: false,
        success: true,
      },
    )
    const key = deriveSettingsBackupAuthKey(DB_URL)
    expect(key).not.toBeNull()
    if (key == null) return
    expect(readSettingsBackupSessionValue(jar.value, key, NOW)).toEqual({
      accountId: 'remote-id',
      acct: 'alice',
      backendUrl: 'https://social.example',
    })
  })

  it('同じ内容は行を増やさず、上限超過で最古が消え、他の所有者は読めない', async () => {
    const jar = cookieJar()
    let now = NOW
    const store = memoryStore(() => now)
    const context: SettingsBackupDeps = {
      allowedOrigins: ALLOWED_ORIGINS,
      callerKey: 'test',
      cookies: jar,
      databaseUrl: DB_URL,
      fetch: vi.fn(),
      limits: createSettingsBackupLimits(),
      now: () => now,
      store,
    }
    const key = deriveSettingsBackupAuthKey(DB_URL)
    if (key == null) throw new Error('missing key')
    jar.set(
      SETTINGS_BACKUP_COOKIE,
      createSettingsBackupSessionValue(
        {
          accountId: 'remote-id',
          acct: 'alice',
          backendUrl: 'https://social.example',
        },
        hashSettingsBackupAccessToken(TOKEN),
        NOW + SETTINGS_BACKUP_TTL_MS,
        key,
      ),
      {
        httpOnly: true,
        maxAge: 28_800,
        path: '/',
        sameSite: 'strict',
        secure: true,
      },
    )

    const first = await createSettingsBackup(envelope('home'), context)
    expect(first).toMatchObject({ deduped: false, success: true })
    now += 11_000
    const again = await createSettingsBackup(
      envelope('home', '2026-11-16T06:00:00.000Z'),
      context,
    )
    expect(again).toMatchObject({ deduped: true, success: true })
    expect(store.rows).toHaveLength(1)
    const content = stableStringify({
      formatVersion: 1,
      payload: envelope('home').payload,
    })
    expect(store.rows[0]?.payloadSha256).toBe(sha256Hex(content))

    for (let index = 0; index < SETTINGS_BACKUP_KEEP; index += 1) {
      now += 11_000
      const created = await createSettingsBackup(
        envelope(`col-${index}`),
        context,
      )
      expect(created.success).toBe(true)
    }
    expect(store.rows).toHaveLength(SETTINGS_BACKUP_KEEP)
    expect(store.rows.some((row) => row.payload.includes('"id":"home"'))).toBe(
      false,
    )

    const listed = await listSettingsBackups(context)
    expect(listed.success).toBe(true)
    if (!listed.success) return
    expect(listed.backups).toHaveLength(SETTINGS_BACKUP_KEEP)

    const otherJar = cookieJar()
    otherJar.set(
      SETTINGS_BACKUP_COOKIE,
      createSettingsBackupSessionValue(
        {
          accountId: 'other-id',
          acct: 'bob',
          backendUrl: 'https://social.example',
        },
        hashSettingsBackupAccessToken('other-token'),
        now + SETTINGS_BACKUP_TTL_MS,
        key,
      ),
      {
        httpOnly: true,
        maxAge: 28_800,
        path: '/',
        sameSite: 'strict',
        secure: true,
      },
    )
    const other: SettingsBackupDeps = { ...context, cookies: otherJar }
    const foreignId = store.rows[0]?.id ?? ''
    expect(await getSettingsBackup(foreignId, other)).toEqual({
      error: 'Invalid backup',
      success: false,
    })
    expect(await deleteSettingsBackup(foreignId, other)).toEqual({
      error: 'Invalid backup',
      success: false,
    })
    expect(store.rows.some((row) => row.id === foreignId)).toBe(true)
    const otherList = await listSettingsBackups(other)
    expect(otherList).toEqual({ backups: [], success: true })
  })

  it('保存間隔は成功した行の時刻で決まり、失敗した保存では止まらない', async () => {
    const jar = cookieJar()
    const now = NOW
    const store = memoryStore(() => now)
    const context: SettingsBackupDeps = {
      allowedOrigins: ALLOWED_ORIGINS,
      callerKey: 'test',
      cookies: jar,
      databaseUrl: DB_URL,
      fetch: vi.fn(),
      limits: createSettingsBackupLimits(),
      now: () => now,
      store,
    }
    const key = deriveSettingsBackupAuthKey(DB_URL)
    if (key == null) throw new Error('missing key')
    jar.set(
      SETTINGS_BACKUP_COOKIE,
      createSettingsBackupSessionValue(
        {
          accountId: 'remote-id',
          acct: 'alice',
          backendUrl: 'https://social.example',
        },
        hashSettingsBackupAccessToken(TOKEN),
        NOW + SETTINGS_BACKUP_TTL_MS,
        key,
      ),
      {
        httpOnly: true,
        maxAge: 28_800,
        path: '/',
        sameSite: 'strict',
        secure: true,
      },
    )

    const insert = store.insert.bind(store)
    store.insert = async () => {
      throw new Error('db')
    }
    await expect(
      createSettingsBackup(envelope('home'), context),
    ).resolves.toEqual({
      error: 'Cloud backup is unavailable',
      success: false,
    })
    store.insert = insert
    const saved = await createSettingsBackup(envelope('home'), context)
    expect(saved).toMatchObject({ deduped: false, success: true })
    const limited = await createSettingsBackup(envelope('other'), context)
    expect(limited).toEqual({ error: 'Rate limited', success: false })
    expect(store.rows).toHaveLength(1)
  })

  it('認可の間隔は呼び出し元ごとに失敗も含めて1秒', async () => {
    const failing = deps({
      fetchImpl: vi.fn<SettingsBackupVerifyFetch>(async () => {
        throw new Error('down')
      }),
    })
    await expect(
      authorizeSettingsBackup(
        'mastodon',
        'https://social.example',
        TOKEN,
        failing.deps,
      ),
    ).resolves.toEqual({ error: 'Authorization failed', success: false })
    failing.deps.fetch = vi.fn<SettingsBackupVerifyFetch>(async () => ({
      json: async () => ({ acct: 'alice', id: 'remote-id' }),
      ok: true,
    }))
    const retried = await authorizeSettingsBackup(
      'mastodon',
      'https://social.example',
      TOKEN,
      failing.deps,
    )
    expect(retried).toEqual({ error: 'Rate limited', success: false })
    const other = await authorizeSettingsBackup(
      'mastodon',
      'https://social.example',
      TOKEN,
      { ...failing.deps, callerKey: 'other' },
    )
    expect(other).toMatchObject({ success: true })
  })

  it('許可していないオリジンへは問い合わせない', async () => {
    const { deps: context } = deps()
    const result = await authorizeSettingsBackup(
      'mastodon',
      'https://unlisted.example',
      TOKEN,
      context,
    )
    expect(result).toEqual({
      error: 'Authorization failed',
      success: false,
    })
    expect(context.fetch).not.toHaveBeenCalled()
  })

  it('全体件数が上限なら新規保存しない', async () => {
    const jar = cookieJar()
    const store = memoryStore()
    const context: SettingsBackupDeps = {
      allowedOrigins: ALLOWED_ORIGINS,
      callerKey: 'test',
      cookies: jar,
      databaseUrl: DB_URL,
      fetch: vi.fn(),
      limits: createSettingsBackupLimits(),
      now: () => NOW,
      store,
    }
    const key = deriveSettingsBackupAuthKey(DB_URL)
    if (key == null) throw new Error('missing key')
    jar.set(
      SETTINGS_BACKUP_COOKIE,
      createSettingsBackupSessionValue(
        {
          accountId: 'remote-id',
          acct: 'alice',
          backendUrl: 'https://social.example',
        },
        hashSettingsBackupAccessToken(TOKEN),
        NOW + SETTINGS_BACKUP_TTL_MS,
        key,
      ),
      {
        httpOnly: true,
        maxAge: 28_800,
        path: '/',
        sameSite: 'strict',
        secure: true,
      },
    )
    for (let index = 0; index < SETTINGS_BACKUP_GLOBAL_MAX; index += 1) {
      store.rows.push({
        createdAt: NOW,
        formatVersion: 1,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        ownerAccountId: 'other-id',
        ownerBackendUrl: 'https://social.example',
        payload: '{}',
        payloadSha256: `hash-${index}`,
        timelineCount: 0,
      })
    }
    await expect(
      createSettingsBackup(envelope('home'), context),
    ).resolves.toEqual({
      error: 'Quota exceeded',
      success: false,
    })
    expect(store.rows).toHaveLength(SETTINGS_BACKUP_GLOBAL_MAX)
  })

  it('DATABASE_URL が無いときは使えない', async () => {
    const { deps: context } = deps()
    const result = await authorizeSettingsBackup(
      'mastodon',
      'https://social.example',
      TOKEN,
      {
        ...context,
        databaseUrl: undefined,
      },
    )
    expect(result).toEqual({
      error: 'Cloud backup is unavailable',
      success: false,
    })
  })
})
