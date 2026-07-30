import type { Entity } from 'megalodon'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSqliteDb } = vi.hoisted(() => ({
  getSqliteDb: vi.fn(),
}))

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb,
}))

import {
  addNotification,
  bulkAddNotifications,
  getNotifications,
  rowToStoredNotification,
  updateNotificationStatusAction,
} from 'util/db/sqlite/notificationStore'

function makeNotification(id: string): Entity.Notification {
  return {
    account: {
      acct: 'actor@example.com',
      avatar: '',
      avatar_static: '',
      bot: false,
      created_at: '',
      display_name: 'Actor',
      emojis: [],
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: '',
      header_static: '',
      id: 'actor',
      limited: null,
      locked: false,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: 'https://example.com/@actor',
      username: 'actor',
    },
    created_at: '2024-01-01T00:00:00.000Z',
    id,
    type: 'follow',
  }
}

function makeRow(id = 1): (string | number | null)[] {
  const row = new Array<string | number | null>(42).fill(null)
  row[0] = id
  row[1] = 'https://example.com'
  row[2] = 1_700_000_000_000
  row[3] = 'follow'
  row[4] = `notification-${id}`
  row[6] = 'actor@example.com'
  row[7] = 'actor'
  return row
}

describe('notification store commands', () => {
  const sendCommand = vi.fn()

  beforeEach(() => {
    getSqliteDb.mockReset()
    sendCommand.mockReset()
    getSqliteDb.mockResolvedValue({ sendCommand })
  })

  it('serializes a notification when adding it', async () => {
    const notification = makeNotification('notification-1')

    await addNotification(notification, 'https://example.com')

    expect(sendCommand).toHaveBeenCalledWith({
      backendUrl: 'https://example.com',
      notificationJson: JSON.stringify(notification),
      type: 'addNotification',
    })
  })

  it('does not initialize SQLite for an empty bulk add', async () => {
    await bulkAddNotifications([], 'https://example.com')

    expect(getSqliteDb).not.toHaveBeenCalled()
  })

  it('serializes every notification in a bulk add', async () => {
    const notifications = [
      makeNotification('notification-1'),
      makeNotification('notification-2'),
    ]

    await bulkAddNotifications(notifications, 'https://example.com')

    expect(sendCommand).toHaveBeenCalledWith({
      backendUrl: 'https://example.com',
      notificationsJson: notifications.map((item) => JSON.stringify(item)),
      type: 'bulkAddNotifications',
    })
  })

  it('delegates notification status action updates', async () => {
    await updateNotificationStatusAction(
      'https://example.com',
      'status-1',
      'bookmarked',
      true,
    )

    expect(sendCommand).toHaveBeenCalledWith({
      action: 'bookmarked',
      backendUrl: 'https://example.com',
      statusId: 'status-1',
      type: 'updateNotificationStatusAction',
      value: true,
    })
  })
})

describe('getNotifications', () => {
  const execAsync = vi.fn()

  beforeEach(() => {
    getSqliteDb.mockReset()
    execAsync.mockReset()
    execAsync.mockResolvedValue([makeRow(1), makeRow(2)])
    getSqliteDb.mockResolvedValue({ execAsync })
  })

  it('uses the maximum limit when filters are omitted', async () => {
    const result = await getNotifications()

    expect(result.map((item) => item.notification_id)).toEqual([1, 2])
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY n.created_at_ms DESC'),
      {
        bind: [2_147_483_647],
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    )
    const sql = execAsync.mock.calls[0][0] as string
    expect(sql).not.toContain('WHERE la.backend_url IN')
    expect(sql).not.toContain('n.local_account_id = ?')
  })

  it('binds backend URLs before the requested limit', async () => {
    await getNotifications(['https://one.example', 'https://two.example'], 25)

    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('WHERE la.backend_url IN (?,?)'),
      {
        bind: ['https://one.example', 'https://two.example', 25],
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    )
  })

  it('uses WHERE for a local account filter without backend URLs', async () => {
    await getNotifications(undefined, 10, 42)

    const sql = execAsync.mock.calls[0][0] as string
    expect(sql).toContain('WHERE n.local_account_id = ?')
    expect(execAsync.mock.calls[0][1].bind).toEqual([42, 10])
  })

  it('combines backend and local account filters with AND', async () => {
    await getNotifications(['https://example.com'], 10, 42)

    const sql = execAsync.mock.calls[0][0] as string
    expect(sql).toContain('WHERE la.backend_url IN (?)')
    expect(sql).toContain('AND n.local_account_id = ?')
    expect(execAsync.mock.calls[0][1].bind).toEqual([
      'https://example.com',
      42,
      10,
    ])
  })
})

describe('rowToStoredNotification edge cases', () => {
  it('falls back to the database id when no local notification id exists', () => {
    const row = makeRow(7)
    row[4] = null

    expect(rowToStoredNotification(row).id).toBe('7')
  })

  it('maps emojis, media, mentions, poll options, and reactions', () => {
    const row = makeRow()
    row[11] = 1
    row[12] = 1
    row[14] = 99
    row[19] = 1_700_000_000_000
    row[20] = 1
    row[21] = null
    row[31] = JSON.stringify([
      null,
      {
        shortcode: 'wave',
        static_url: null,
        url: 'https://example.com/wave.png',
        visible_in_picker: 1,
      },
    ])
    row[32] = '[]'
    row[33] = JSON.stringify({
      expires_at: null,
      id: 12,
      multiple: 1,
      options: JSON.stringify([{ title: 'A', votes_count: null }]),
      votes_count: 3,
    })
    row[34] = JSON.stringify([
      {
        shortcode: 'actor',
        static_url: 'https://example.com/actor-static.png',
        url: 'https://example.com/actor.png',
        visible_in_picker: 0,
      },
    ])
    row[35] = '{invalid'
    row[36] = JSON.stringify([null, { id: 'media-1', type: 'image' }])
    row[37] = JSON.stringify([null, { acct: 'alice@example.net' }])
    row[38] = 1
    row[39] = '{invalid'
    row[40] = 'wave'
    row[41] = 'https://example.com/wave.png'

    const result = rowToStoredNotification(row)

    expect(result.account.locked).toBe(true)
    expect(result.account.bot).toBe(true)
    expect(result.account.emojis[0]).toEqual({
      shortcode: 'actor',
      static_url: 'https://example.com/actor-static.png',
      url: 'https://example.com/actor.png',
      visible_in_picker: false,
    })
    expect(result.status?.visibility).toBe('public')
    expect(result.status?.sensitive).toBe(true)
    expect(result.status?.emojis[0].static_url).toBe(
      'https://example.com/wave.png',
    )
    expect(result.status?.emoji_reactions).toEqual([])
    expect(result.status?.media_attachments).toEqual([
      { id: 'media-1', type: 'image' },
    ])
    expect(result.status?.mentions).toEqual([
      {
        acct: 'alice@example.net',
        id: '',
        url: '',
        username: 'alice',
      },
    ])
    expect(result.status?.poll).toMatchObject({
      id: '12',
      multiple: true,
      options: [{ title: 'A', votes_count: null }],
      voted: true,
      votes_count: 3,
    })
    expect(result.status?.poll).not.toHaveProperty('own_votes')
    expect(result.reaction).toMatchObject({
      name: 'wave',
      static_url: 'https://example.com/wave.png',
      url: 'https://example.com/wave.png',
    })
  })
})
