import type { DatabaseSync } from 'node:sqlite'
import type { Entity } from 'megalodon'
import type { SendCommandPayload } from 'util/db/sqlite/protocol'
import { createStatusWriteStore } from 'util/db/sqlite/stores/statusStore'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  createRealWorkerDb,
  createSendCommandAdapter,
} from './realWorkerCommandAdapter'

const BACKEND = 'https://a.test'

function status(id: string): Entity.Status {
  return {
    account: {
      acct: 'alice@a.test',
      avatar: '',
      avatar_static: '',
      bot: false,
      created_at: '2024-01-01T00:00:00.000Z',
      display_name: 'Alice',
      emojis: [],
      fields: [],
      followers_count: 0,
      following_count: 0,
      group: null,
      header: '',
      header_static: '',
      id: 'account-1',
      limited: null,
      locked: false,
      moved: null,
      noindex: null,
      note: '',
      statuses_count: 0,
      suspended: null,
      url: 'https://a.test/@alice',
      username: 'alice',
    },
    bookmarked: false,
    content: '<p>status content</p>',
    created_at: '2024-06-15T12:30:00.000Z',
    emojis: [],
    favourited: false,
    favourites_count: 0,
    id,
    media_attachments: [],
    mentions: [],
    muted: false,
    pinned: false,
    reblog: null,
    reblogged: false,
    reblogs_count: 0,
    replies_count: 0,
    sensitive: false,
    spoiler_text: '',
    tags: [],
    uri: `https://a.test/users/alice/statuses/${id}`,
    url: `https://a.test/@alice/${id}`,
    visibility: 'public',
  } as Entity.Status
}

function seedLocalAccount(native: DatabaseSync): void {
  native.exec(`INSERT INTO servers (host) VALUES ('a.test');`)
  native.exec(
    `INSERT INTO local_accounts
       (server_id, backend_url, backend_type, acct, remote_account_id, created_at, updated_at)
     VALUES (1, '${BACKEND}', 'mastodon', 'me', 'me-1', 0, 0);`,
  )
}

function upsertCommands(): SendCommandPayload[] {
  return sentCommands.filter((c) => c.type === 'bulkUpsertStatuses')
}

function upsertIds(cmd: SendCommandPayload): string[] {
  if (cmd.type !== 'bulkUpsertStatuses') return []
  return cmd.statusesJson.map((j) => (JSON.parse(j) as { id: string }).id)
}

let adapter: ReturnType<typeof createSendCommandAdapter>
let native: DatabaseSync
let store: ReturnType<typeof createStatusWriteStore>

let sentCommands: SendCommandPayload[]

let gate: Promise<void> | null = null
let failNext: Error | null = null

beforeEach(() => {
  const real = createRealWorkerDb()
  native = real.native
  adapter = createSendCommandAdapter(real.db)
  seedLocalAccount(native)
  sentCommands = []
  gate = null
  failNext = null
  store = createStatusWriteStore(async () => ({
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

async function flushBuffered(): Promise<void> {
  await vi.advanceTimersByTimeAsync(100)
}

describe('upsertStatus マイクロバッチ', () => {
  it('同一 status.id は最新値に合体され、全呼び出し元が同時に解決する', async () => {
    const older = status('s1')
    const newer = { ...status('s1'), content: 'newer' } as Entity.Status
    const first = store.upsertStatus(older, BACKEND, 'home')
    const second = store.upsertStatus(newer, BACKEND, 'home')
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`x${i}`), BACKEND, 'home')
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ])
    expect(upsertCommands()).toHaveLength(1)
    const ids = upsertIds(upsertCommands()[0])
    expect(ids.filter((id) => id === 's1')).toEqual(['s1'])
    expect(ids).toHaveLength(20)
  })

  it('100ms 経過で閾値未満のバッファをフラッシュする', async () => {
    vi.useFakeTimers()
    const request = store.upsertStatus(status('s1'), BACKEND, 'home')
    expect(sentCommands).toHaveLength(0)

    await flushBuffered()
    await request

    expect(upsertCommands()).toHaveLength(1)
    expect(upsertIds(upsertCommands()[0])).toEqual(['s1'])
  })

  it('1 コマンドあたり 20 件を超えないチャンクに分割する', async () => {
    await store.bulkUpsertStatuses(
      Array.from({ length: 45 }, (_, i) => status(`s${i}`)),
      BACKEND,
      'home',
      undefined,
      true,
    )

    const commands = upsertCommands()
    const sizes = commands.map((c) =>
      c.type === 'bulkUpsertStatuses' ? c.statusesJson.length : 0,
    )
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(45)
    for (const cmd of commands) {
      if (cmd.type !== 'bulkUpsertStatuses') continue
      expect(cmd.skipProfileUpdate).toBe(true)
      expect(cmd.backendUrl).toBe(BACKEND)
      expect(cmd.timelineType).toBe('home')
    }
  })

  it('複数バッファキーはラウンドロビンで交互に排出する', async () => {
    const all: Promise<void>[] = []
    for (let i = 0; i < 30; i++) {
      all.push(store.upsertStatus(status(`h${i}`), BACKEND, 'home'))
      all.push(store.upsertStatus(status(`t${i}`), BACKEND, 'tag', 'news'))
    }
    await Promise.all(all)

    const commands = upsertCommands()
    const kinds = commands.map((c) =>
      c.type === 'bulkUpsertStatuses' ? `${c.timelineType}:${c.tag ?? ''}` : '',
    )
    expect(new Set(kinds)).toEqual(new Set(['home:', 'tag:news']))
    const homeCount = commands
      .filter(
        (c) => c.type === 'bulkUpsertStatuses' && c.timelineType === 'home',
      )
      .reduce(
        (sum, c) =>
          sum + (c.type === 'bulkUpsertStatuses' ? c.statusesJson.length : 0),
        0,
      )
    const tagCount = commands
      .filter(
        (c) => c.type === 'bulkUpsertStatuses' && c.timelineType === 'tag',
      )
      .reduce(
        (sum, c) =>
          sum + (c.type === 'bulkUpsertStatuses' ? c.statusesJson.length : 0),
        0,
      )
    expect(homeCount).toBe(30)
    expect(tagCount).toBe(30)
  })

  it('失敗したバッチは呼び出し元を reject し、新しい未送信分は保持する', async () => {
    const failure = new Error('worker write failed')
    failNext = failure

    const failed = store.upsertStatus(status('bad'), BACKEND, 'home')
    const pads: Promise<void>[] = []
    for (let i = 0; i < 19; i++) {
      pads.push(store.upsertStatus(status(`pad${i}`), BACKEND, 'home'))
    }
    const pendingNewer = store.upsertStatus(
      status('newer-arrival'),
      BACKEND,
      'tag',
      'news',
    )
    const pads2: Promise<void>[] = []
    for (let i = 0; i < 19; i++) {
      pads2.push(
        store.upsertStatus(status(`pad2-${i}`), BACKEND, 'tag', 'news'),
      )
    }

    await expect(failed).rejects.toBe(failure)
    await expect(Promise.all(pads)).rejects.toBe(failure)
    await expect(pendingNewer).resolves.toBeUndefined()
    await Promise.all(pads2)

    const commands = upsertCommands()
    expect(commands.length).toBeGreaterThanOrEqual(2)
    const ids = upsertIds(commands[commands.length - 1])
    expect(ids).toContain('newer-arrival')
  })

  it('ドレイン実行中に到着した upsert は後続のフラッシュで書き込む', async () => {
    let release: (() => void) | undefined
    gate = new Promise((resolve) => {
      release = resolve
    })

    const p1 = store.upsertStatus(status('s1'), BACKEND, 'home')
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`q${i}`), BACKEND, 'home')
    }
    const p2 = store.upsertStatus(status('late'), BACKEND, 'tag', 'x')
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`r${i}`), BACKEND, 'tag', 'x')
    }
    await vi.waitFor(() => expect(sentCommands).toHaveLength(1))
    release?.()
    gate = null
    await Promise.all([p1, p2])

    expect(upsertCommands().length).toBeGreaterThanOrEqual(2)
  })

  it('RPC ブロック中の同一 status 反復更新は最新 1 件に合体し、追加分は 1 コマンドで送られる', async () => {
    let release: (() => void) | undefined
    gate = new Promise((resolve) => {
      release = resolve
    })

    const firstBatch: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      firstBatch.push(store.upsertStatus(status(`s${i}`), BACKEND, 'home'))
    }
    await vi.waitFor(() => expect(sentCommands).toHaveLength(1))

    const updates: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      updates.push(
        store.upsertStatus(
          { ...status('hot'), content: `iter-${i}` } as Entity.Status,
          BACKEND,
          'home',
        ),
      )
    }

    release?.()
    gate = null
    await Promise.all([...firstBatch, ...updates])

    const commands = upsertCommands()
    expect(commands).toHaveLength(2)
    expect(upsertIds(commands[0])).toHaveLength(20)
    expect(upsertIds(commands[1])).toEqual(['hot'])
    const last = commands[1]
    if (last.type !== 'bulkUpsertStatuses') {
      throw new Error('expected bulkUpsertStatuses')
    }
    expect(
      (JSON.parse(last.statusesJson[0]) as { content: string }).content,
    ).toBe('iter-99')

    const stored = native
      .prepare(
        "SELECT content_html FROM posts WHERE object_uri = 'https://a.test/users/alice/statuses/hot';",
      )
      .get() as { content_html: string }
    expect(stored.content_html).toBe('iter-99')
  })

  it('skipProfileUpdate の有無で同一 id が別バケツに分離される', async () => {
    const first = store.bulkUpsertStatuses([status('dup')], BACKEND, 'home')
    const second = store.bulkUpsertStatuses(
      [{ ...status('dup'), content: 'skip-version' } as Entity.Status],
      BACKEND,
      'home',
      undefined,
      true,
    )
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`pad${i}`), BACKEND, 'home')
    }
    await Promise.all([first, second])

    const commands = upsertCommands()
    const withSkip = commands.filter(
      (c) => c.type === 'bulkUpsertStatuses' && c.skipProfileUpdate === true,
    )
    const withoutSkip = commands.filter(
      (c) => c.type === 'bulkUpsertStatuses' && c.skipProfileUpdate !== true,
    )
    expect(withSkip.length).toBeGreaterThanOrEqual(1)
    expect(withoutSkip.length).toBeGreaterThanOrEqual(1)
    const skipIds = withSkip.flatMap(upsertIds)
    const fullIds = withoutSkip.flatMap(upsertIds)
    expect(skipIds).toContain('dup')
    expect(fullIds).toContain('dup')
  })
})

describe('削除系操作のバリア', () => {
  it('handleDeleteEvent は保留中の upsert を先に書き込んでから削除する', async () => {
    let release: (() => void) | undefined
    gate = new Promise((resolve) => {
      release = resolve
    })

    const pending = store.upsertStatus(status('doomed'), BACKEND, 'home')
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`f${i}`), BACKEND, 'home')
    }
    const deleted = store.handleDeleteEvent(BACKEND, 'doomed', 'home')

    await vi.waitFor(() => expect(sentCommands).toHaveLength(1))
    release?.()
    gate = null
    await Promise.all([pending, deleted])

    const types = sentCommands.map((c) => c.type)
    expect(types).toEqual(['bulkUpsertStatuses', 'handleDeleteEvent'])

    const rows = native.prepare('SELECT COUNT(*) AS c FROM posts;').get() as {
      c: number
    }
    expect(rows.c).toBe(19)
    const victim = native
      .prepare(
        "SELECT COUNT(*) AS c FROM post_backend_ids WHERE local_id = 'doomed';",
      )
      .get() as { c: number }
    expect(victim.c).toBe(0)
  })

  it('バリア成立後に到着した upsert は削除の後に実行される', async () => {
    let release: (() => void) | undefined
    gate = new Promise((resolve) => {
      release = resolve
    })

    const pending = store.upsertStatus(status('victim'), BACKEND, 'home')
    for (let i = 0; i < 19; i++) {
      void store.upsertStatus(status(`pre${i}`), BACKEND, 'home')
    }
    const deleted = store.handleDeleteEvent(BACKEND, 'victim', 'home')

    await vi.waitFor(() => expect(sentCommands).toHaveLength(1))

    const later: Promise<void>[] = []
    for (let i = 0; i < 20; i++) {
      later.push(store.upsertStatus(status(`post${i}`), BACKEND, 'home'))
    }

    release?.()
    gate = null
    await Promise.all([pending, deleted, ...later])

    const types = sentCommands.map((c) => c.type)
    expect(types).toEqual([
      'bulkUpsertStatuses',
      'handleDeleteEvent',
      'bulkUpsertStatuses',
    ])
  })
})
