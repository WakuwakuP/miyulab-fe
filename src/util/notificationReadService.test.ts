import type { App } from 'types/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationApiError } from './notificationReadApi'
import {
  type NotificationReadTask,
  runNotificationReadTask,
  syncNotificationReadState,
} from './notificationReadService'
import {
  compareNotificationIds,
  notificationReadState,
} from './notificationReadState'

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  flush: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('util/GetClient', () => ({
  GetClient: () => ({ verifyAccountCredentials: mocks.verify }),
}))
vi.mock('util/accountResolver', () => ({
  resolveLocalAccountId: mocks.resolve,
}))
vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb: async () => ({ execAsync: mocks.exec }),
}))
vi.mock('util/db/sqlite/notificationStore', () => ({
  flushNotifications: mocks.flush,
  updateNotificationReadState: mocks.save,
}))
vi.mock('./notificationReadApi', async (original) => ({
  ...(await original<typeof import('./notificationReadApi')>()),
  notificationApi: mocks.request,
}))

function app(backend: App['backend'] = 'mastodon'): App {
  return {
    appData: {},
    backend,
    backendUrl: 'https://server.example',
    tokenData: { access_token: 'test-token' },
  } as App
}
function task(backend: App['backend'] = 'mastodon'): NotificationReadTask {
  return { app: app(backend), stage: 'write' }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolve.mockReturnValue(1)
  mocks.verify.mockResolvedValue({ data: { id: 'self' } })
  mocks.exec.mockImplementation(async (sql: string) =>
    sql.includes('remote_account_id') ? [['self']] : [['90'], ['91']],
  )
  mocks.save.mockResolvedValue(undefined)
  mocks.request.mockImplementation(
    async (_app: App, path: string, body?: object) => {
      if (path === '/api/v1/notifications')
        return [{ id: '99', type: 'future_notification_type' }]
      if (path === '/api/v1/markers')
        return { notifications: { last_read_id: body ? '99' : '10' } }
      if (path === '/api/i') return { hasUnreadNotification: false }
      return null
    },
  )
})

describe('notification read API coordination', () => {
  it('Misskey does not repeat an uncertain write after a lost response or failed confirmation', async () => {
    const job = task('misskey')
    mocks.request.mockImplementation(async () => {
      throw new Error('offline')
    })
    await expect(runNotificationReadTask(job, () => true)).rejects.toThrow(
      'offline',
    )
    expect(job.stage).toBe('confirm')
    await expect(runNotificationReadTask(job, () => true)).rejects.toThrow(
      '受付済み',
    )
    mocks.request.mockResolvedValue({ hasUnreadNotification: false })
    await runNotificationReadTask(job, () => true)
    expect(
      mocks.request.mock.calls.filter((call) => call[1].includes('mark-all')),
    ).toHaveLength(1)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
  it('uses an unfiltered remote notification ID and persists only after success', async () => {
    await runNotificationReadTask(task(), () => true)
    expect(mocks.request).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/notifications',
      undefined,
      new URLSearchParams({ limit: '1' }),
    )
    expect(mocks.request).toHaveBeenCalledWith(
      expect.anything(),
      '/api/v1/markers',
      { notifications: { last_read_id: '99' } },
    )
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        boundary: '99',
        localAccountId: 1,
        remoteAccountId: 'self',
      }),
      expect.any(Function),
    )
  })
  it('does not regress an existing marker', async () => {
    mocks.request.mockImplementation(async (_app, path) =>
      path.includes('markers')
        ? { notifications: { last_read_id: '100' } }
        : [{ id: '99' }],
    )
    await runNotificationReadTask(task(), () => true)
    expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(0)
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ boundary: '100' }),
      expect.any(Function),
    )
  })
  it('rechecks a conflicting marker and retries once', async () => {
    let writes = 0
    mocks.request.mockImplementation(async (_app, path, body) => {
      if (path.includes('notifications')) return [{ id: '99' }]
      if (body && writes++ === 0) throw new NotificationApiError(409)
      return { notifications: { last_read_id: body ? '99' : '10' } }
    })
    await runNotificationReadTask(task(), () => true)
    expect(writes).toBe(2)
  })
  it('does not report empty marker responses as success', async () => {
    mocks.request.mockImplementation(async (_app, path) =>
      path.includes('markers') ? {} : [{ id: '99' }],
    )
    await expect(runNotificationReadTask(task(), () => true)).rejects.toThrow(
      '保存を確認',
    )
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not write when there are no notifications', async () => {
    mocks.request.mockResolvedValue([])
    await runNotificationReadTask(task(), () => true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('rejects another account on the same backend before calling read APIs', async () => {
    mocks.exec.mockResolvedValue([['another-user']])
    await expect(runNotificationReadTask(task(), () => true)).rejects.toThrow(
      '一致しません',
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('discards a response after logout or reauthentication', async () => {
    let current = true
    mocks.request.mockImplementation(async () => {
      current = false
      return [{ id: '99' }]
    })
    await expect(
      runNotificationReadTask(task(), () => current),
    ).rejects.toThrow('ログイン状態')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('retries the DB only after the server succeeded', async () => {
    const job = task()
    mocks.save.mockRejectedValueOnce(new Error('disk failed'))
    await expect(runNotificationReadTask(job, () => true)).rejects.toThrow(
      'サーバー反映済み',
    )
    const writes = mocks.request.mock.calls.filter((call) => call[2]).length
    await runNotificationReadTask(job, () => true)
    expect(mocks.request.mock.calls.filter((call) => call[2])).toHaveLength(
      writes,
    )
  })
  it('Pleroma keeps its cutoff for notifications beyond the 80-item response', async () => {
    mocks.request.mockImplementation(async (_app, _path, body) =>
      body ? [{ id: '90', pleroma: { is_seen: true } }] : [{ id: '99' }],
    )
    await runNotificationReadTask(task('pleroma'), () => true)
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        boundary: '99',
        updates: [{ id: '90', isRead: true }],
      }),
      expect.any(Function),
    )
  })
  it('Misskey only marks the frozen cache snapshot, never subsequent arrivals', async () => {
    const job = task('misskey')
    await runNotificationReadTask(job, () => true)
    mocks.exec.mockImplementation(async (sql: string) =>
      sql.includes('remote_account_id')
        ? [['self']]
        : [['90'], ['91'], ['new']],
    )
    await runNotificationReadTask(job, () => true)
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        updates: [
          { id: '90', isRead: true },
          { id: '91', isRead: true },
        ],
      }),
      expect.any(Function),
    )
    expect(
      mocks.request.mock.calls.filter((call) => call[1].includes('mark-all')),
    ).toHaveLength(1)
  })
  it('Misskey leaves the display unchanged when completion cannot be confirmed and retries confirmation only', async () => {
    vi.useFakeTimers()
    try {
      mocks.request.mockImplementation(async (_app, path) =>
        path === '/api/i' ? { hasUnreadNotification: true } : null,
      )
      const job = task('misskey')
      const result = expect(
        runNotificationReadTask(job, () => true),
      ).rejects.toThrow('状態を確認')
      await vi.advanceTimersByTimeAsync(5001)
      await result
      expect(mocks.save).not.toHaveBeenCalled()
      mocks.request.mockResolvedValue({ hasUnreadNotification: false })
      await runNotificationReadTask(job, () => true)
      expect(
        mocks.request.mock.calls.filter((call) => call[1].includes('mark-all')),
      ).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it('Misskey unknown historical rows stay unknown while the account has unread notifications', async () => {
    mocks.request.mockResolvedValue({ hasUnreadNotification: true })
    await syncNotificationReadState(app('misskey'), () => true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('isolates failures between accounts', async () => {
    mocks.request.mockImplementation(async (app, path) => {
      if (app.backend === 'pleroma') throw new NotificationApiError(403)
      return path === '/api/i' ? { hasUnreadNotification: false } : null
    })
    const results = await Promise.allSettled(
      [task('misskey'), task('pleroma')].map((job) =>
        runNotificationReadTask(job, () => true),
      ),
    )
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ])
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
})

describe('remote IDs', () => {
  it('compares beyond Number precision without interpreting internal DB IDs', () => {
    expect(compareNotificationIds('9007199254740993', '9007199254740992')).toBe(
      1,
    )
    expect(notificationReadState('9007199254740993', '9007199254740992')).toBe(
      false,
    )
    expect(notificationReadState('opaque', 'other-opaque')).toBeNull()
    expect(notificationReadState('same', 'same')).toBe(true)
  })
})
