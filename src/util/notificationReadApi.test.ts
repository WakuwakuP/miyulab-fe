import type { Entity } from 'megalodon'
import type { App } from 'types/types'
import { afterEach, expect, it, vi } from 'vitest'
import type { MisskeyClientContext } from './misskey/helpers'
import {
  getNotification,
  getNotifications,
} from './misskey/notificationOperations'
import {
  decoratePleromaNotifications,
  notificationApi,
} from './notificationReadApi'

afterEach(() => vi.unstubAllGlobals())

it('preserves notification bodies if Pleroma metadata retrieval fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const data = [{ id: 'one' }] as Entity.Notification[]
  expect(
    await decoratePleromaNotifications(
      { backendUrl: 'https://example.test' } as App,
      data,
    ),
  ).toBe(data)
})
it('joins Pleroma states by remote ID instead of page position', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => [{ id: 'one', pleroma: { is_seen: false } }],
      ok: true,
    }),
  )
  const data = [{ id: 'other' }, { id: 'one' }] as Entity.Notification[]
  expect(
    await decoratePleromaNotifications(
      { backendUrl: 'https://example.test' } as App,
      data,
    ),
  ).toEqual([
    { id: 'other', isRead: null },
    { id: 'one', isRead: false },
  ])
})
it('limits credentials to the requested origin and rejects redirects', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 })
  vi.stubGlobal('fetch', fetch)
  await notificationApi(
    {
      backend: 'misskey',
      backendUrl: 'https://example.test',
      tokenData: { access_token: 'test' },
    } as App,
    '/api/i',
  )
  expect(fetch).toHaveBeenCalledWith(
    new URL('https://example.test/api/i'),
    expect.objectContaining({
      body: JSON.stringify({ i: 'test' }),
      credentials: 'omit',
      method: 'POST',
      redirect: 'error',
    }),
  )
})
it('never implicitly marks Misskey notifications read in list or hydration requests', async () => {
  const request = vi.fn().mockResolvedValue([])
  const context = {
    client: { request },
    origin: 'https://example.test',
  } as unknown as MisskeyClientContext
  await getNotifications(context, { limit: 40, max_id: 'older' })
  await expect(getNotification(context, 'missing')).rejects.toThrow()
  expect(request).toHaveBeenNthCalledWith(1, 'i/notifications', {
    limit: 40,
    markAsRead: false,
    untilId: 'older',
  })
  expect(request).toHaveBeenNthCalledWith(2, 'i/notifications', {
    limit: 100,
    markAsRead: false,
  })
})
