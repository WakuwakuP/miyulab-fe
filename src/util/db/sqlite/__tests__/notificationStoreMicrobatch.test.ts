import type { DatabaseSync } from 'node:sqlite'
import type { Entity } from 'megalodon'
import { createNotificationWriteStore } from 'util/db/sqlite/notificationStore'
import type { SendCommandPayload } from 'util/db/sqlite/protocol'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  createRealWorkerDb,
  createSendCommandAdapter,
} from './realWorkerCommandAdapter'

function notification(id: string): Entity.Notification {
  return {
    account: {
      acct: 'actor@a.test',
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
      id: `actor-${id}`,
      limited: null,
      locked: false,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: 'https://a.test/@actor',
      username: 'actor',
    },
    created_at: '2024-01-01T00:00:00.000Z',
    id,
    type: 'follow',
  } as Entity.Notification
}

function seedLocalAccount(native: DatabaseSync, backendUrl: string): void {
  const host = new URL(backendUrl).host
  native.prepare(`INSERT INTO servers (host) VALUES (?);`).run(host)
  const server = native
    .prepare(`SELECT id FROM servers WHERE host = ?;`)
    .get(host) as { id: number }
  native
    .prepare(
      `INSERT INTO local_accounts
         (server_id, backend_url, backend_type, acct, remote_account_id, created_at, updated_at)
       VALUES (?, ?, 'mastodon', 'me', 'me-1', 0, 0);`,
    )
    .run(server.id, backendUrl)
}

function addCommands(): SendCommandPayload[] {
  return sentCommands.filter((c) => c.type === 'bulkAddNotifications')
}

function addIds(cmd: SendCommandPayload): string[] {
  if (cmd.type !== 'bulkAddNotifications') return []
  return cmd.notificationsJson.map((j) => (JSON.parse(j) as { id: string }).id)
}

let adapter: ReturnType<typeof createSendCommandAdapter>
let native: DatabaseSync
let store: ReturnType<typeof createNotificationWriteStore>

let sentCommands: SendCommandPayload[]
let gate: Promise<void> | null = null
let failNext: Error | null = null

beforeEach(() => {
  const real = createRealWorkerDb()
  native = real.native
  adapter = createSendCommandAdapter(real.db)
  seedLocalAccount(native, 'https://a.test')
  seedLocalAccount(native, 'https://b.test')
  sentCommands = []
  gate = null
  failNext = null
  store = createNotificationWriteStore(async () => ({
    sendCommand: async (cmd: SendCommandPayload) => {
      sentCommands.push(cmd)
      if (gate) await gate
      if (failNext) {
        const e = failNext
        failNext = null
        throw e
      }
      return adapter.sendCommand(cmd)
    },
  }))
  onTestFinished(() => {
    vi.useRealTimers()
    native.close()
  })
})

describe('notification マイクロバッチ', () => {
  it('同一 notification.id は最新値に合体され呼び出し元が共に解決する', async () => {
    const first = store.addNotification(notification('n1'), 'https://a.test')
    const second = store.addNotification(
      { ...notification('n1'), type: 'mention' } as Entity.Notification,
      'https://a.test',
    )
    for (let i = 0; i < 19; i++) {
      void store.addNotification(notification(`m${i}`), 'https://a.test')
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(addCommands()).toHaveLength(1)
    const ids = addIds(addCommands()[0])
    expect(ids.filter((id) => id === 'n1')).toEqual(['n1'])
    expect(ids).toHaveLength(20)
  })

  it('バックエンドごとにバッファを分け 20 件チャンクで送信する', async () => {
    await store.bulkAddNotifications(
      Array.from({ length: 25 }, (_, i) => notification(`n${i}`)),
      'https://a.test',
    )

    const commands = addCommands()
    const sizes = commands.map((c) =>
      c.type === 'bulkAddNotifications' ? c.notificationsJson.length : 0,
    )
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25)
    for (const cmd of commands) {
      expect(cmd.backendUrl).toBe('https://a.test')
    }
  })

  it('失敗したバッチは呼び出し元を reject し残りを保持する', async () => {
    const failure = new Error('write failed')
    failNext = failure

    const failed = store.addNotification(notification('bad'), 'https://a.test')
    const pads: Promise<void>[] = []
    for (let i = 0; i < 19; i++) {
      pads.push(
        store.addNotification(notification(`pad${i}`), 'https://a.test'),
      )
    }
    const kept = store.addNotification(notification('kept'), 'https://b.test')
    for (let i = 0; i < 19; i++) {
      void store.addNotification(notification(`b${i}`), 'https://b.test')
    }

    await expect(failed).rejects.toBe(failure)
    for (const pad of pads) {
      await expect(pad).rejects.toBe(failure)
    }
    await expect(kept).resolves.toBeUndefined()
    const last = addCommands().at(-1)
    expect(last?.backendUrl).toBe('https://b.test')
  })

  it('100ms で閾値未満のバッファをフラッシュする', async () => {
    vi.useFakeTimers()
    const request = store.addNotification(notification('n1'), 'https://a.test')
    await vi.advanceTimersByTimeAsync(100)
    await request

    expect(addCommands()).toHaveLength(1)
  })

  it('updateNotificationStatusAction は保留中の追加を先に書き込む', async () => {
    let release: (() => void) | undefined
    gate = new Promise((resolve) => {
      release = resolve
    })

    const pending = store.addNotification(notification('pre'), 'https://a.test')
    for (let i = 0; i < 19; i++) {
      void store.addNotification(notification(`pre${i}`), 'https://a.test')
    }
    const action = store.updateNotificationStatusAction(
      'https://a.test',
      'status-1',
      'bookmarked',
      true,
    )

    await vi.waitFor(() => expect(sentCommands).toHaveLength(1))

    const later: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      later.push(
        store.addNotification(notification(`post${i}`), 'https://a.test'),
      )
    }

    release?.()
    gate = null
    await Promise.all([pending, action, ...later])

    const types = sentCommands.map((c) => c.type)
    expect(types).toEqual([
      'bulkAddNotifications',
      'updateNotificationStatusAction',
      'bulkAddNotifications',
    ])
  })
})
