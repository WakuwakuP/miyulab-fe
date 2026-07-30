import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FetchTimelineRequest,
  SendCommandPayload,
  TableName,
} from '../protocol'

const mocks = vi.hoisted(() => ({
  buildTimelineKey: vi.fn(),
  databaseConstructor: vi.fn(),
  ensureSchema: vi.fn(),
  executeFlatFetch: vi.fn(),
  executeGraphPlan: vi.fn(),
  executeQueryPlan: vi.fn(),
  fetch: vi.fn(),
  handleAddNotification: vi.fn(),
  handleBulkAddNotifications: vi.fn(),
  handleBulkUpsertCustomEmojis: vi.fn(),
  handleBulkUpsertStatuses: vi.fn(),
  handleDeleteEvent: vi.fn(),
  handleEnforceMaxLength: vi.fn(),
  handleEnsureLocalAccount: vi.fn(),
  handleRemoveFromTimeline: vi.fn(),
  handleToggleReaction: vi.fn(),
  handleUpdateNotificationStatusAction: vi.fn(),
  handleUpdateStatus: vi.fn(),
  handleUpdateStatusAction: vi.fn(),
  handleUpsertStatus: vi.fn(),
  initSqlite: vi.fn(),
  loadSqliteWasmInitializer: vi.fn(),
  logSlowQueryExplain: vi.fn(),
  rawExec: vi.fn(),
  resolveLocalAccountId: vi.fn(),
  resolvePostIdInternal: vi.fn(),
  wasmArrayBuffer: vi.fn(),
  worker: {
    cancelStaleRequests: vi.fn(),
    execAsync: vi.fn(),
    execAsyncTimed: vi.fn(),
    execBatch: vi.fn(),
    executeFlatFetch: vi.fn(),
    executeGraphPlan: vi.fn(),
    executeQueryPlan: vi.fn(),
    fetchTimeline: vi.fn(),
    initWorker: vi.fn(),
    sendCommand: vi.fn(),
  },
}))

vi.mock('util/db/sqlite/explainLogger', () => ({
  logSlowQueryExplain: mocks.logSlowQueryExplain,
}))

vi.mock('util/db/sqlite/helpers', () => ({
  buildTimelineKey: mocks.buildTimelineKey,
  resolveLocalAccountId: mocks.resolveLocalAccountId,
}))

vi.mock('util/db/sqlite/sqliteWasmLoader', () => ({
  loadSqliteWasmInitializer: mocks.loadSqliteWasmInitializer,
}))

vi.mock('util/db/sqlite/worker/handlers/statusHelpers', () => ({
  resolvePostIdInternal: mocks.resolvePostIdInternal,
}))

vi.mock('util/db/sqlite/workerClient', () => mocks.worker)

vi.mock('util/db/sqlite/schema', () => ({
  ensureSchema: mocks.ensureSchema,
}))

vi.mock('util/db/sqlite/worker/workerStatusStore', () => ({
  handleBulkUpsertCustomEmojis: mocks.handleBulkUpsertCustomEmojis,
  handleBulkUpsertStatuses: mocks.handleBulkUpsertStatuses,
  handleDeleteEvent: mocks.handleDeleteEvent,
  handleEnsureLocalAccount: mocks.handleEnsureLocalAccount,
  handleRemoveFromTimeline: mocks.handleRemoveFromTimeline,
  handleToggleReaction: mocks.handleToggleReaction,
  handleUpdateStatus: mocks.handleUpdateStatus,
  handleUpdateStatusAction: mocks.handleUpdateStatusAction,
  handleUpsertStatus: mocks.handleUpsertStatus,
}))

vi.mock('util/db/sqlite/worker/workerNotificationStore', () => ({
  handleAddNotification: mocks.handleAddNotification,
  handleBulkAddNotifications: mocks.handleBulkAddNotifications,
  handleUpdateNotificationStatusAction:
    mocks.handleUpdateNotificationStatusAction,
}))

vi.mock('util/db/sqlite/worker/workerCleanup', () => ({
  handleEnforceMaxLength: mocks.handleEnforceMaxLength,
}))

vi.mock('util/db/query-ir/executor/flatFetchExecutor', () => ({
  executeFlatFetch: mocks.executeFlatFetch,
}))

vi.mock('util/db/query-ir/executor/graphExecutor', () => ({
  executeGraphPlan: mocks.executeGraphPlan,
}))

vi.mock('util/db/sqlite/queries/executionEngine', () => ({
  executeQueryPlan: mocks.executeQueryPlan,
}))

const rawDb = {
  exec: mocks.rawExec,
}

const notify = vi.fn<(table: TableName, hint?: object) => void>()

const timelineRequest: Omit<FetchTimelineRequest, 'id' | 'type'> = {
  batchSqls: {
    belongingTags: 'belongingTags {IDS}',
    customEmojis: 'customEmojis {IDS}',
    interactions: 'interactions {IDS}',
    media: 'media {IDS}',
    mentions: 'mentions {IDS}',
    polls: 'polls {IDS}',
    profileEmojis: 'profileEmojis {IDS}',
    timelineTypes: 'timelineTypes {IDS}',
  },
  phase1: {
    bind: ['https://example.test'],
    sql: 'phase1',
  },
  phase2BaseSql: 'phase2 {IDS}',
}

async function createFallbackHandle(origin?: string) {
  vi.stubGlobal('Worker', undefined)
  if (origin !== undefined) {
    vi.stubGlobal('location', { origin })
  }
  vi.stubGlobal('fetch', mocks.fetch)

  const { getDb } = await import('util/db/sqlite/initSqlite')
  return getDb(notify)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()

  mocks.rawExec.mockReturnValue([])
  mocks.wasmArrayBuffer.mockResolvedValue(new ArrayBuffer(8))
  mocks.fetch.mockResolvedValue({
    arrayBuffer: mocks.wasmArrayBuffer,
  })
  mocks.databaseConstructor.mockImplementation(function Database() {
    return rawDb
  })
  mocks.initSqlite.mockResolvedValue({
    oo1: {
      DB: mocks.databaseConstructor,
    },
  })
  mocks.loadSqliteWasmInitializer.mockResolvedValue(mocks.initSqlite)
  mocks.resolveLocalAccountId.mockReturnValue(7)
  mocks.resolvePostIdInternal.mockReturnValue(99)
  mocks.buildTimelineKey.mockReturnValue('home:#vitest')
  mocks.worker.initWorker.mockResolvedValue('opfs')

  const changed = { changedTables: ['posts'] }
  mocks.handleAddNotification.mockReturnValue(changed)
  mocks.handleBulkAddNotifications.mockReturnValue(changed)
  mocks.handleBulkUpsertCustomEmojis.mockReturnValue(changed)
  mocks.handleBulkUpsertStatuses.mockReturnValue(changed)
  mocks.handleDeleteEvent.mockReturnValue(changed)
  mocks.handleEnsureLocalAccount.mockReturnValue(changed)
  mocks.handleRemoveFromTimeline.mockReturnValue(changed)
  mocks.handleToggleReaction.mockReturnValue(changed)
  mocks.handleUpdateNotificationStatusAction.mockReturnValue(changed)
  mocks.handleUpdateStatus.mockReturnValue(changed)
  mocks.handleUpdateStatusAction.mockReturnValue(changed)
  mocks.handleUpsertStatus.mockReturnValue(changed)
  mocks.handleEnforceMaxLength.mockReturnValue({
    changedTables: ['posts'],
    deletedCounts: {
      notifications: 2,
      posts: 3,
      timeline_entries: 1,
    },
    hasMore: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('getDb worker mode', () => {
  it('returns the worker API and reuses the initialized singleton', async () => {
    vi.stubGlobal('Worker', class FakeWorker {})
    const firstNotify = vi.fn()
    const secondNotify = vi.fn()
    const { getDb } = await import('util/db/sqlite/initSqlite')

    const first = await getDb(firstNotify)
    const second = await getDb(secondNotify)

    expect(mocks.worker.initWorker).toHaveBeenCalledOnce()
    expect(mocks.worker.initWorker).toHaveBeenCalledWith(firstNotify)
    expect(second).toBe(first)
    expect(first).toEqual({
      cancelStaleRequests: mocks.worker.cancelStaleRequests,
      execAsync: mocks.worker.execAsync,
      execAsyncTimed: mocks.worker.execAsyncTimed,
      execBatch: mocks.worker.execBatch,
      executeFlatFetch: mocks.worker.executeFlatFetch,
      executeGraphPlan: mocks.worker.executeGraphPlan,
      executeQueryPlan: mocks.worker.executeQueryPlan,
      fetchTimeline: mocks.worker.fetchTimeline,
      persistence: 'opfs',
      sendCommand: mocks.worker.sendCommand,
    })
  })

  it('warns and initializes the memory fallback when worker setup fails', async () => {
    vi.stubGlobal('Worker', class FakeWorker {})
    vi.stubGlobal('location', { origin: 'https://client.test' })
    vi.stubGlobal('fetch', mocks.fetch)
    const workerError = new Error('worker unavailable')
    mocks.worker.initWorker.mockRejectedValue(workerError)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getDb } = await import('util/db/sqlite/initSqlite')

    const handle = await getDb(notify)

    expect(handle.persistence).toBe('memory')
    expect(warn).toHaveBeenCalledWith(
      'SQLite: Worker mode failed, falling back to main thread.',
      workerError,
    )
    expect(mocks.fetch).toHaveBeenCalledWith('https://client.test/sqlite3.wasm')
  })
})

describe('main-thread fallback initialization', () => {
  it('loads WASM, configures SQLite, and exposes all schema exec overloads', async () => {
    mocks.ensureSchema.mockImplementation(({ db }) => {
      db.exec('schema rows', {
        bind: [1],
        returnValue: 'resultRows',
      })
      db.exec('schema bind', { bind: [2] })
      db.exec('schema plain')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const handle = await createFallbackHandle('https://client.test')

    expect(mocks.fetch).toHaveBeenCalledWith('https://client.test/sqlite3.wasm')
    expect(mocks.wasmArrayBuffer).toHaveBeenCalledOnce()
    expect(mocks.loadSqliteWasmInitializer).toHaveBeenCalledWith(
      'https://client.test',
    )
    const moduleArg = mocks.initSqlite.mock.calls[0][0]
    expect(moduleArg.wasmBinary).toBeInstanceOf(ArrayBuffer)
    expect(moduleArg.locateFile('sqlite3-opfs-async-proxy.js')).toBe(
      'https://client.test/sqlite3-opfs-async-proxy.js',
    )
    expect(mocks.databaseConstructor).toHaveBeenCalledWith(':memory:', 'c')
    expect(mocks.rawExec.mock.calls.slice(0, 5)).toEqual([
      ['PRAGMA journal_mode=WAL;'],
      ['PRAGMA synchronous=NORMAL;'],
      ['PRAGMA foreign_keys = ON;'],
      ['PRAGMA cache_size = -8000;'],
      ['PRAGMA temp_store = MEMORY;'],
    ])
    expect(mocks.rawExec).toHaveBeenCalledWith('schema rows', {
      bind: [1],
      returnValue: 'resultRows',
    })
    expect(mocks.rawExec).toHaveBeenCalledWith('schema bind', { bind: [2] })
    expect(mocks.rawExec).toHaveBeenCalledWith('schema plain')
    expect(warn).toHaveBeenCalledWith(
      'SQLite: using in-memory fallback (no Worker). Data will not persist.',
    )
    expect(handle.persistence).toBe('memory')
    expect(handle.cancelStaleRequests('old-session')).toBe(0)
  })

  it('uses relative WASM paths when location is unavailable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await createFallbackHandle()

    expect(mocks.fetch).toHaveBeenCalledWith('/sqlite3.wasm')
    expect(mocks.loadSqliteWasmInitializer).toHaveBeenCalledWith('')
    expect(mocks.initSqlite.mock.calls[0][0].locateFile('sqlite3.wasm')).toBe(
      '/sqlite3.wasm',
    )
  })
})

describe('main-thread SQL API', () => {
  it('executes row and non-row queries and records timings', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    mocks.rawExec.mockReset()
    mocks.logSlowQueryExplain.mockReset()
    const now = vi
      .fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(14)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(27)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(39)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(61)
    vi.stubGlobal('performance', { now })
    mocks.rawExec
      .mockReturnValueOnce([[1, 'row']])
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce([[2, 'timed']])
      .mockReturnValueOnce(undefined)

    await expect(
      handle.execAsync('SELECT rows', {
        bind: [1],
        returnValue: 'resultRows',
      }),
    ).resolves.toEqual([[1, 'row']])
    await expect(handle.execAsync('UPDATE rows')).resolves.toBeUndefined()
    await expect(
      handle.execAsyncTimed('SELECT timed', {
        bind: [2],
        returnValue: 'resultRows',
      }),
    ).resolves.toEqual({
      durationMs: 9,
      result: [[2, 'timed']],
    })
    await expect(
      handle.execAsyncTimed('DELETE rows', { bind: [3] }),
    ).resolves.toEqual({
      durationMs: 11,
      result: undefined,
    })

    expect(mocks.rawExec.mock.calls).toEqual([
      [
        'SELECT rows',
        {
          bind: [1],
          returnValue: 'resultRows',
        },
      ],
      ['UPDATE rows', { bind: undefined }],
      [
        'SELECT timed',
        {
          bind: [2],
          returnValue: 'resultRows',
        },
      ],
      ['DELETE rows', { bind: [3] }],
    ])
    expect(mocks.logSlowQueryExplain.mock.calls).toEqual([
      [rawDb, 'SELECT rows', [1], 4],
      [rawDb, 'UPDATE rows', undefined, 7],
      [rawDb, 'SELECT timed', [2], 9],
      [rawDb, 'DELETE rows', [3], 11],
    ])
  })

  it('commits batches and selects requested or all return values', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    mocks.rawExec.mockReset()
    mocks.rawExec.mockImplementation((sql) => {
      if (sql === 'SELECT first') return [['first']]
      if (sql === 'SELECT second') return [['second']]
      return undefined
    })

    await expect(
      handle.execBatch(
        [
          { returnValue: 'resultRows', sql: 'SELECT first' },
          { bind: [2], returnValue: 'resultRows', sql: 'SELECT second' },
          { bind: [3], sql: 'UPDATE third' },
        ],
        { returnIndices: [1], rollbackOnError: true },
      ),
    ).resolves.toEqual({ 1: [['second']] })

    expect(mocks.rawExec.mock.calls).toEqual([
      ['BEGIN;'],
      ['SELECT first', { bind: undefined, returnValue: 'resultRows' }],
      ['SELECT second', { bind: [2], returnValue: 'resultRows' }],
      ['UPDATE third', { bind: [3] }],
      ['COMMIT;'],
    ])

    mocks.rawExec.mockClear()
    await expect(
      handle.execBatch([
        { returnValue: 'resultRows', sql: 'SELECT first' },
        { sql: 'UPDATE third' },
      ]),
    ).resolves.toEqual({ 0: [['first']], 1: undefined })
    expect(mocks.rawExec).toHaveBeenNthCalledWith(1, 'BEGIN;')
    expect(mocks.rawExec).toHaveBeenLastCalledWith('COMMIT;')

    mocks.rawExec.mockClear()
    await expect(
      handle.execBatch([{ sql: 'UPDATE third' }], {
        returnIndices: [],
        rollbackOnError: false,
      }),
    ).resolves.toEqual({})
    expect(mocks.rawExec).toHaveBeenCalledOnce()
    expect(mocks.rawExec).toHaveBeenCalledWith('UPDATE third', {
      bind: undefined,
    })
  })

  it('rolls back a failed batch and preserves the original error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    const failure = new Error('statement failed')
    mocks.rawExec.mockReset()
    mocks.rawExec.mockImplementation((sql) => {
      if (sql === 'BROKEN') throw failure
      return undefined
    })

    await expect(
      handle.execBatch([{ sql: 'BROKEN' }], { rollbackOnError: true }),
    ).rejects.toBe(failure)
    expect(mocks.rawExec).toHaveBeenLastCalledWith('ROLLBACK;')
  })

  it('ignores a rollback failure and still throws the statement error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    const failure = new Error('statement failed')
    mocks.rawExec.mockReset()
    mocks.rawExec.mockImplementation((sql) => {
      if (sql === 'BROKEN') throw failure
      if (sql === 'ROLLBACK;') throw new Error('rollback failed')
      return undefined
    })

    await expect(
      handle.execBatch([{ sql: 'BROKEN' }], { rollbackOnError: true }),
    ).rejects.toBe(failure)
    expect(mocks.rawExec).toHaveBeenLastCalledWith('ROLLBACK;')
  })

  it('delegates all structured query executors to their fallback engines', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    const flatRequest = { ids: [1], target: 'posts' }
    const graphPlan = { nodes: [] }
    const graphOptions = { limit: 20 }
    const queryPlan = { meta: {}, steps: [] }
    const flatResult = { entities: [] }
    const graphResult = { items: [] }
    const queryResult = { stepResults: [], totalDurationMs: 1 }
    mocks.executeFlatFetch.mockReturnValue(flatResult)
    mocks.executeGraphPlan.mockReturnValue(graphResult)
    mocks.executeQueryPlan.mockReturnValue(queryResult)

    await expect(handle.executeFlatFetch(flatRequest as never)).resolves.toBe(
      flatResult,
    )
    await expect(
      handle.executeGraphPlan(graphPlan as never, graphOptions as never),
    ).resolves.toBe(graphResult)
    await expect(handle.executeQueryPlan(queryPlan as never)).resolves.toBe(
      queryResult,
    )

    expect(mocks.executeFlatFetch).toHaveBeenCalledWith(rawDb, flatRequest)
    expect(mocks.executeQueryPlan).toHaveBeenCalledWith(rawDb, queryPlan)
    expect(mocks.executeGraphPlan).toHaveBeenCalledWith(
      rawDb,
      graphPlan,
      graphOptions,
      expect.any(Function),
    )
    expect(mocks.executeGraphPlan.mock.calls[0][3]()).toEqual({})
  })
})

describe('main-thread timeline fetch', () => {
  it('returns immediately when phase 1 has no posts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    mocks.rawExec.mockReset()
    mocks.rawExec.mockReturnValue([])
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(106)
    vi.stubGlobal('performance', { now })

    const result = await handle.fetchTimeline(timelineRequest)

    expect(mocks.rawExec).toHaveBeenCalledOnce()
    expect(mocks.rawExec).toHaveBeenCalledWith('phase1', {
      bind: ['https://example.test'],
      returnValue: 'resultRows',
    })
    expect(result).toEqual({
      batchResults: {
        belongingTags: [],
        customEmojis: [],
        interactions: [],
        media: [],
        mentions: [],
        polls: [],
        profileEmojis: [],
        timelineTypes: [],
      },
      phase1Rows: [],
      phase2Rows: [],
      totalDurationMs: 6,
    })
  })

  it('expands reblogs, deduplicates IDs, and runs every enrichment query', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    mocks.rawExec.mockReset()
    mocks.rawExec.mockImplementation((sql) => {
      if (sql === 'phase1') return [[1], [2]]
      if (sql === 'phase2 ?,?') {
        return [
          ['first', null, 3],
          ['second', null, 2],
          ['third', null, null],
        ]
      }
      return [[sql]]
    })
    const now = vi.fn().mockReturnValueOnce(200).mockReturnValueOnce(215)
    vi.stubGlobal('performance', { now })

    const result = await handle.fetchTimeline({
      ...timelineRequest,
      reblogPostIdColumnIndex: 2,
    })

    expect(result.phase1Rows).toEqual([[1], [2]])
    expect(result.phase2Rows).toHaveLength(3)
    expect(result.totalDurationMs).toBe(15)
    expect(mocks.rawExec).toHaveBeenCalledTimes(10)
    for (const key of Object.keys(timelineRequest.batchSqls)) {
      expect(mocks.rawExec).toHaveBeenCalledWith(`${key} ?,?,?`, {
        bind: [1, 2, 3],
        returnValue: 'resultRows',
      })
      expect(
        result.batchResults[key as keyof typeof result.batchResults],
      ).toEqual([[`${key} ?,?,?`]])
    }
  })

  it('uses the legacy reblog column index when none is supplied', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    mocks.rawExec.mockReset()
    const phase2Row = Array.from({ length: 26 }, () => null)
    phase2Row[25] = 8
    mocks.rawExec.mockImplementation((sql) => {
      if (sql === 'phase1') return [[4]]
      if (sql === 'phase2 ?') return [phase2Row]
      return []
    })

    await handle.fetchTimeline(timelineRequest)

    expect(mocks.rawExec).toHaveBeenCalledWith('interactions ?,?', {
      bind: [4, 8],
      returnValue: 'resultRows',
    })
  })
})

describe('main-thread command API', () => {
  it('dispatches direct status and notification commands with change hints', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    const cases: {
      command: SendCommandPayload
      expectedArgs: unknown[]
      handler: ReturnType<typeof vi.fn>
      hint: object | undefined
    }[] = [
      {
        command: {
          backendUrl: 'https://example.test',
          statusJson: '{"id":"1"}',
          tag: 'news',
          timelineType: 'tag',
          type: 'upsertStatus',
        },
        expectedArgs: [
          rawDb,
          '{"id":"1"}',
          'https://example.test',
          'tag',
          'news',
        ],
        handler: mocks.handleUpsertStatus,
        hint: {
          backendUrl: 'https://example.test',
          tag: 'news',
          timelineType: 'tag',
        },
      },
      {
        command: {
          backendUrl: 'https://example.test',
          statusesJson: ['{"id":"1"}'],
          timelineType: 'home',
          type: 'bulkUpsertStatuses',
        },
        expectedArgs: [
          rawDb,
          ['{"id":"1"}'],
          'https://example.test',
          'home',
          undefined,
        ],
        handler: mocks.handleBulkUpsertStatuses,
        hint: {
          backendUrl: 'https://example.test',
          tag: undefined,
          timelineType: 'home',
        },
      },
      {
        command: {
          backendUrl: 'https://example.test',
          statusJson: '{"id":"2"}',
          type: 'updateStatus',
        },
        expectedArgs: [rawDb, '{"id":"2"}', 'https://example.test'],
        handler: mocks.handleUpdateStatus,
        hint: { backendUrl: 'https://example.test' },
      },
      {
        command: {
          backendUrl: 'https://example.test',
          notificationJson: '{"id":"n1"}',
          type: 'addNotification',
        },
        expectedArgs: [rawDb, '{"id":"n1"}', 'https://example.test'],
        handler: mocks.handleAddNotification,
        hint: { backendUrl: 'https://example.test' },
      },
      {
        command: {
          backendUrl: 'https://example.test',
          notificationsJson: ['{"id":"n2"}'],
          type: 'bulkAddNotifications',
        },
        expectedArgs: [rawDb, ['{"id":"n2"}'], 'https://example.test'],
        handler: mocks.handleBulkAddNotifications,
        hint: { backendUrl: 'https://example.test' },
      },
      {
        command: {
          action: 'favourited',
          backendUrl: 'https://example.test',
          statusId: '2',
          type: 'updateNotificationStatusAction',
          value: true,
        },
        expectedArgs: [rawDb, 'https://example.test', '2', 'favourited', true],
        handler: mocks.handleUpdateNotificationStatusAction,
        hint: { backendUrl: 'https://example.test' },
      },
      {
        command: {
          accountJson: '{"id":"me"}',
          backendUrl: 'https://example.test',
          type: 'ensureLocalAccount',
        },
        expectedArgs: [rawDb, 'https://example.test', '{"id":"me"}'],
        handler: mocks.handleEnsureLocalAccount,
        hint: undefined,
      },
      {
        command: {
          backendUrl: 'https://example.test',
          emojisJson: '[]',
          type: 'bulkUpsertCustomEmojis',
        },
        expectedArgs: [rawDb, 'https://example.test', '[]'],
        handler: mocks.handleBulkUpsertCustomEmojis,
        hint: undefined,
      },
    ]

    for (const { command, expectedArgs, handler, hint } of cases) {
      notify.mockClear()
      await expect(handle.sendCommand(command)).resolves.toEqual({
        changedTables: ['posts'],
      })
      expect(handler).toHaveBeenLastCalledWith(...expectedArgs)
      expect(notify).toHaveBeenCalledWith('posts', hint)
    }
  })

  it('dispatches account-scoped interaction and deletion commands', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()

    await handle.sendCommand({
      action: 'bookmarked',
      backendUrl: 'https://example.test',
      statusId: '10',
      type: 'updateStatusAction',
      value: false,
    })
    expect(mocks.handleUpdateStatusAction).toHaveBeenCalledWith(
      rawDb,
      7,
      '10',
      'bookmarked',
      false,
    )

    await handle.sendCommand({
      backendUrl: 'https://example.test',
      sourceTimelineType: 'local',
      statusId: '11',
      tag: 'town',
      type: 'handleDeleteEvent',
    })
    expect(mocks.handleDeleteEvent).toHaveBeenCalledWith(rawDb, 7, '11')
    expect(notify).toHaveBeenLastCalledWith('posts', {
      backendUrl: 'https://example.test',
      tag: 'town',
      timelineType: 'local',
    })

    await handle.sendCommand({
      backendUrl: 'https://example.test',
      emoji: ':party:',
      statusId: '12',
      type: 'toggleReaction',
      value: true,
    })
    expect(mocks.handleToggleReaction).toHaveBeenCalledWith(
      rawDb,
      7,
      '12',
      true,
      ':party:',
    )
    expect(notify).toHaveBeenLastCalledWith('posts', {
      backendUrl: 'https://example.test',
    })
  })

  it('returns no changes when an account-scoped command has no local account', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.resolveLocalAccountId.mockReturnValue(null)
    const handle = await createFallbackHandle()
    notify.mockClear()

    await expect(
      handle.sendCommand({
        action: 'reblogged',
        backendUrl: 'https://unknown.test',
        statusId: '10',
        type: 'updateStatusAction',
        value: true,
      }),
    ).resolves.toEqual({ changedTables: [] })

    expect(mocks.handleUpdateStatusAction).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('removes a resolved status from the requested timeline', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()

    await handle.sendCommand({
      backendUrl: 'https://example.test',
      statusId: '20',
      tag: 'typescript',
      timelineType: 'tag',
      type: 'removeFromTimeline',
    })

    expect(mocks.buildTimelineKey).toHaveBeenCalledWith('tag', {
      tag: 'typescript',
    })
    expect(mocks.resolvePostIdInternal).toHaveBeenCalledWith(rawDb, 7, '20')
    expect(mocks.handleRemoveFromTimeline).toHaveBeenCalledWith(
      rawDb,
      7,
      'home:#vitest',
      99,
    )
    expect(notify).toHaveBeenCalledWith('posts', {
      backendUrl: 'https://example.test',
      tag: 'typescript',
      timelineType: 'tag',
    })
  })

  it('returns no changes when removal cannot resolve the backend status', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.resolvePostIdInternal.mockReturnValue(null)
    const handle = await createFallbackHandle()
    notify.mockClear()

    await expect(
      handle.sendCommand({
        backendUrl: 'https://example.test',
        statusId: 'missing',
        timelineType: 'home',
        type: 'removeFromTimeline',
      }),
    ).resolves.toEqual({ changedTables: [] })

    expect(mocks.handleRemoveFromTimeline).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('maps cleanup options and preserves its extended result', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()

    await expect(
      handle.sendCommand({
        batchLimit: 50,
        mode: 'emergency',
        targetRatio: 0.25,
        type: 'enforceMaxLength',
      }),
    ).resolves.toEqual({
      changedTables: ['posts'],
      deletedCounts: {
        notifications: 2,
        posts: 3,
        timeline_entries: 1,
      },
      hasMore: true,
    })
    expect(mocks.handleEnforceMaxLength).toHaveBeenCalledWith(
      rawDb,
      100000,
      100000,
      100000,
      {
        batchLimit: 50,
        mode: 'emergency',
        targetRatio: 0.25,
      },
    )
    expect(notify).toHaveBeenCalledWith('posts', undefined)
  })

  it('acknowledges memory exports without dispatch or notification', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()
    notify.mockClear()

    await expect(
      handle.sendCommand({ type: 'exportDatabase' }),
    ).resolves.toEqual({ ok: true })
    expect(notify).not.toHaveBeenCalled()
  })

  it('rejects unknown fallback commands', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = await createFallbackHandle()

    await expect(
      handle.sendCommand({ type: 'not-supported' } as never),
    ).rejects.toThrow('Unknown command type: not-supported')
  })
})
