import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildTimelineKey: vi.fn(),
  bumpTableVersions: vi.fn(),
  captureTableVersions: vi.fn(),
  getDb: vi.fn(),
  getSqlite3Module: vi.fn(),
  getTableVersionsMap: vi.fn(),
  handleAddNotification: vi.fn(),
  handleBulkAddNotifications: vi.fn(),
  handleBulkUpsertCustomEmojis: vi.fn(),
  handleBulkUpsertStatuses: vi.fn(),
  handleDeleteEvent: vi.fn(),
  handleEnforceMaxLength: vi.fn(),
  handleEnsureLocalAccount: vi.fn(),
  handleExec: vi.fn(),
  handleExecBatch: vi.fn(),
  handleExportDatabase: vi.fn(),
  handleFetchTimeline: vi.fn(),
  handleRemoveFromTimeline: vi.fn(),
  handleToggleReaction: vi.fn(),
  handleUpdateNotificationStatusAction: vi.fn(),
  handleUpdateStatus: vi.fn(),
  handleUpdateStatusAction: vi.fn(),
  handleUpsertStatus: vi.fn(),
  init: vi.fn(),
  isDatabaseHealthy: vi.fn(),
  isSqliteCorruptError: vi.fn(),
  recoverFromCorruption: vi.fn(),
  resolveLocalAccountId: vi.fn(),
  resolvePostIdInternal: vi.fn(),
  runFlatFetch: vi.fn(),
  runGraphPlan: vi.fn(),
  runQueryPlan: vi.fn(),
  sendError: vi.fn(),
  sendResponse: vi.fn(),
  syncGraphCacheVersions: vi.fn(),
}))

vi.mock('util/db/query-ir/executor/flatFetchExecutor', () => ({
  executeFlatFetch: mocks.runFlatFetch,
}))

vi.mock('util/db/query-ir/executor/graphExecutor', () => ({
  executeGraphPlan: mocks.runGraphPlan,
  syncGraphCacheVersions: mocks.syncGraphCacheVersions,
}))

vi.mock('util/db/sqlite/helpers', () => ({
  buildTimelineKey: mocks.buildTimelineKey,
  resolveLocalAccountId: mocks.resolveLocalAccountId,
}))

vi.mock('util/db/sqlite/queries/executionEngine', () => ({
  executeQueryPlan: mocks.runQueryPlan,
}))

vi.mock('util/db/sqlite/worker/handlers/statusHelpers', () => ({
  resolvePostIdInternal: mocks.resolvePostIdInternal,
}))

vi.mock('util/db/sqlite/worker/workerCleanup', () => ({
  DEFAULT_MAX_NOTIFICATIONS: 200,
  DEFAULT_MAX_POSTS: 300,
  DEFAULT_MAX_TIMELINE_ENTRIES: 100,
  handleEnforceMaxLength: mocks.handleEnforceMaxLength,
}))

vi.mock('util/db/sqlite/worker/workerExecHandlers', () => ({
  handleExec: mocks.handleExec,
  handleExecBatch: mocks.handleExecBatch,
}))

vi.mock('util/db/sqlite/worker/workerExportHandler', () => ({
  handleExportDatabase: mocks.handleExportDatabase,
}))

vi.mock('util/db/sqlite/worker/workerFetchTimelineHandler', () => ({
  handleFetchTimeline: mocks.handleFetchTimeline,
}))

vi.mock('util/db/sqlite/worker/workerInit', () => ({
  init: mocks.init,
}))

vi.mock('util/db/sqlite/worker/workerMessageHelpers', () => ({
  sendError: mocks.sendError,
  sendResponse: mocks.sendResponse,
}))

vi.mock('util/db/sqlite/worker/workerNotificationStore', () => ({
  handleAddNotification: mocks.handleAddNotification,
  handleBulkAddNotifications: mocks.handleBulkAddNotifications,
  handleUpdateNotificationStatusAction:
    mocks.handleUpdateNotificationStatusAction,
}))

vi.mock('util/db/sqlite/worker/workerRecovery', () => ({
  isDatabaseHealthy: mocks.isDatabaseHealthy,
  isSqliteCorruptError: mocks.isSqliteCorruptError,
  recoverFromCorruption: mocks.recoverFromCorruption,
}))

vi.mock('util/db/sqlite/worker/workerState', () => ({
  bumpTableVersions: mocks.bumpTableVersions,
  captureTableVersions: mocks.captureTableVersions,
  getDb: mocks.getDb,
  getSqlite3Module: mocks.getSqlite3Module,
  getTableVersionsMap: mocks.getTableVersionsMap,
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

await import('util/db/sqlite/worker/sqlite.worker')

const db = { exec: vi.fn() }
const sqlite3 = { capi: {} }
const postMessage = vi.fn()

function dispatch(data: Record<string, unknown>): void {
  const listener = globalThis.onmessage
  if (listener == null) {
    throw new Error('SQLite worker did not register an onmessage listener')
  }
  ;(listener as (event: MessageEvent) => void)({ data } as MessageEvent)
}

function expectOkResponse(
  id: number,
  changedTables?: string[],
  changeHint?: {
    backendUrl?: string
    tag?: string
    timelineType?: string
  },
): void {
  expect(mocks.sendResponse).toHaveBeenLastCalledWith(
    id,
    { ok: true },
    changedTables,
    undefined,
    changeHint,
  )
}

describe('SQLite worker entrypoint', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('self', { postMessage })

    mocks.getDb.mockReturnValue(db)
    mocks.getSqlite3Module.mockReturnValue(sqlite3)
    mocks.getTableVersionsMap.mockReturnValue(new Map([['posts', 4]]))
    mocks.captureTableVersions.mockReturnValue({
      posts: 4,
      timeline_entries: 2,
    })
    mocks.resolveLocalAccountId.mockReturnValue(11)
    mocks.resolvePostIdInternal.mockReturnValue(22)
    mocks.buildTimelineKey.mockReturnValue('tag:vitest')
    mocks.isSqliteCorruptError.mockReturnValue(false)
    mocks.isDatabaseHealthy.mockReturnValue(true)
    mocks.recoverFromCorruption.mockResolvedValue('restored')

    mocks.init.mockResolvedValue({ persistence: 'opfs' })
    mocks.handleExportDatabase.mockResolvedValue(undefined)
    mocks.handleExec.mockReturnValue({
      durationMs: 2.5,
      result: [['row']],
    })
    mocks.handleExecBatch.mockReturnValue({ 1: [['batch']] })

    for (const handler of [
      mocks.handleAddNotification,
      mocks.handleBulkAddNotifications,
      mocks.handleBulkUpsertCustomEmojis,
      mocks.handleBulkUpsertStatuses,
      mocks.handleDeleteEvent,
      mocks.handleEnsureLocalAccount,
      mocks.handleRemoveFromTimeline,
      mocks.handleToggleReaction,
      mocks.handleUpdateNotificationStatusAction,
      mocks.handleUpdateStatus,
      mocks.handleUpdateStatusAction,
      mocks.handleUpsertStatus,
    ]) {
      handler.mockReturnValue({ changedTables: ['posts'] })
    }

    mocks.handleEnforceMaxLength.mockReturnValue({
      changedTables: ['timeline_entries', 'posts'],
      deletedCounts: {
        notifications: 2,
        posts: 3,
        timeline_entries: 1,
      },
      hasMore: true,
      phaseTimings: {
        notifications: 2,
        phase1Total: 3,
        phase2Total: 4,
        postsCount: 1,
        postsDelete: 3,
        timeline: 1,
        total: 7,
      },
    })
    mocks.runQueryPlan.mockReturnValue({
      stepResults: [],
      totalDurationMs: 8,
    })
    mocks.runGraphPlan.mockReturnValue({
      meta: { totalDurationMs: 9 },
      rows: [],
    })
    mocks.runFlatFetch.mockReturnValue({
      meta: { totalDurationMs: 10 },
      rows: [],
    })
    mocks.handleFetchTimeline.mockReturnValue({ phase1Rows: [] })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await vi.waitFor(() => {
      expect(
        mocks.recoverFromCorruption.mock.settledResults,
      ).not.toContainEqual(expect.objectContaining({ state: 'pending' }))
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('initialization and export messages', () => {
    it('initializes from the supplied origin and publishes persistence details', async () => {
      mocks.init.mockResolvedValue({
        persistence: 'opfs',
        recovered: 'reset',
      })

      dispatch({ origin: 'https://app.example', type: '__init' })

      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith({
          persistence: 'opfs',
          recovered: 'reset',
          type: 'init',
        })
      })
      expect(mocks.init).toHaveBeenCalledWith('https://app.example')
      expect(mocks.getDb).not.toHaveBeenCalled()
    })

    it.each([
      [new Error('WASM unavailable'), 'WASM unavailable'],
      ['initialization rejected', 'initialization rejected'],
    ])('reports initialization failures', async (error, message) => {
      mocks.init.mockRejectedValue(error)

      dispatch({ origin: 'https://app.example', type: '__init' })

      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith({
          error: message,
          id: -1,
          type: 'error',
        })
      })
      expect(console.error).toHaveBeenCalledWith(
        'SQLite Worker: initialization failed:',
        error,
      )
    })

    it('exports the database and acknowledges completion', async () => {
      dispatch({ id: 31, type: 'exportDatabase' })

      await vi.waitFor(() => {
        expect(mocks.sendResponse).toHaveBeenCalledWith(31, { ok: true })
      })
      expect(mocks.handleExportDatabase).toHaveBeenCalledOnce()
      expect(mocks.getDb).not.toHaveBeenCalled()
    })

    it('reports export errors through the common error channel', async () => {
      const error = new Error('export failed')
      mocks.handleExportDatabase.mockRejectedValue(error)

      dispatch({ id: 32, type: 'exportDatabase' })

      await vi.waitFor(() => {
        expect(mocks.sendError).toHaveBeenCalledWith(32, error)
      })
    })
  })

  describe('generic execution requests', () => {
    it('dispatches exec with bind and return options and preserves duration', () => {
      dispatch({
        bind: [7, 'value'],
        id: 1,
        returnValue: 'resultRows',
        sql: 'SELECT * FROM posts WHERE id = ?',
        type: 'exec',
      })

      expect(mocks.handleExec).toHaveBeenCalledWith(
        'SELECT * FROM posts WHERE id = ?',
        [7, 'value'],
        'resultRows',
      )
      expect(mocks.sendResponse).toHaveBeenCalledWith(
        1,
        [['row']],
        undefined,
        2.5,
      )
    })

    it('dispatches transaction batches with all execution options', () => {
      const statements = [{ bind: [1], sql: 'DELETE FROM posts WHERE id = ?' }]

      dispatch({
        id: 2,
        returnIndices: [0],
        rollbackOnError: true,
        statements,
        type: 'execBatch',
      })

      expect(mocks.handleExecBatch).toHaveBeenCalledWith(statements, true, [0])
      expect(mocks.sendResponse).toHaveBeenCalledWith(2, {
        1: [['batch']],
      })
    })

    it('answers readiness probes without invoking a database handler', () => {
      dispatch({ id: 3, type: 'ready' })

      expect(mocks.sendResponse).toHaveBeenCalledWith(3, true)
      expect(mocks.handleExec).not.toHaveBeenCalled()
      expect(mocks.handleExecBatch).not.toHaveBeenCalled()
    })
  })

  describe('status mutation requests', () => {
    it('upserts one status with a scoped change hint', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 10,
        statusJson: '{"id":"one"}',
        tag: 'vitest',
        timelineType: 'tag',
        type: 'upsertStatus',
      })

      expect(mocks.handleUpsertStatus).toHaveBeenCalledWith(
        db,
        '{"id":"one"}',
        'https://social.example',
        'tag',
        'vitest',
      )
      expectOkResponse(10, ['posts'], {
        backendUrl: 'https://social.example',
        tag: 'vitest',
        timelineType: 'tag',
      })
    })

    it('bulk-upserts statuses and forwards the profile update policy', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 11,
        skipProfileUpdate: true,
        statusesJson: ['{"id":"one"}', '{"id":"two"}'],
        timelineType: 'home',
        type: 'bulkUpsertStatuses',
      })

      expect(mocks.handleBulkUpsertStatuses).toHaveBeenCalledWith(
        db,
        ['{"id":"one"}', '{"id":"two"}'],
        'https://social.example',
        'home',
        undefined,
        true,
      )
      expectOkResponse(11, ['posts'], {
        backendUrl: 'https://social.example',
        tag: undefined,
        timelineType: 'home',
      })
    })

    it('updates an interaction for the resolved local account', () => {
      dispatch({
        action: 'favourited',
        backendUrl: 'https://social.example',
        id: 12,
        statusId: 'remote-12',
        type: 'updateStatusAction',
        value: true,
      })

      expect(mocks.handleUpdateStatusAction).toHaveBeenCalledWith(
        db,
        11,
        'remote-12',
        'favourited',
        true,
      )
      expectOkResponse(12, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('treats an interaction update without a local account as a no-op', () => {
      mocks.resolveLocalAccountId.mockReturnValue(null)

      dispatch({
        action: 'bookmarked',
        backendUrl: 'https://missing.example',
        id: 13,
        statusId: 'remote-13',
        type: 'updateStatusAction',
        value: false,
      })

      expect(mocks.handleUpdateStatusAction).not.toHaveBeenCalled()
      expect(mocks.sendResponse).toHaveBeenCalledWith(13, { ok: true }, [])
    })

    it('updates a complete status document', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 14,
        statusJson: '{"id":"edited"}',
        type: 'updateStatus',
      })

      expect(mocks.handleUpdateStatus).toHaveBeenCalledWith(
        db,
        '{"id":"edited"}',
        'https://social.example',
      )
      expectOkResponse(14, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('deletes a status for the resolved account with source context', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 15,
        sourceTimelineType: 'local',
        statusId: 'remote-15',
        tag: 'news',
        type: 'handleDeleteEvent',
      })

      expect(mocks.handleDeleteEvent).toHaveBeenCalledWith(db, 11, 'remote-15')
      expectOkResponse(15, ['posts'], {
        backendUrl: 'https://social.example',
        tag: 'news',
        timelineType: 'local',
      })
    })

    it('treats delete without a local account as a no-op', () => {
      mocks.resolveLocalAccountId.mockReturnValue(undefined)

      dispatch({
        backendUrl: 'https://missing.example',
        id: 16,
        sourceTimelineType: 'home',
        statusId: 'remote-16',
        type: 'handleDeleteEvent',
      })

      expect(mocks.handleDeleteEvent).not.toHaveBeenCalled()
      expect(mocks.sendResponse).toHaveBeenCalledWith(16, { ok: true }, [])
    })

    it('resolves account, timeline key, and post before removing an entry', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 17,
        statusId: 'remote-17',
        tag: 'vitest',
        timelineType: 'tag',
        type: 'removeFromTimeline',
      })

      expect(mocks.buildTimelineKey).toHaveBeenCalledWith('tag', {
        tag: 'vitest',
      })
      expect(mocks.resolvePostIdInternal).toHaveBeenCalledWith(
        db,
        11,
        'remote-17',
      )
      expect(mocks.handleRemoveFromTimeline).toHaveBeenCalledWith(
        db,
        11,
        'tag:vitest',
        22,
      )
      expectOkResponse(17, ['posts'], {
        backendUrl: 'https://social.example',
        tag: 'vitest',
        timelineType: 'tag',
      })
    })

    it('does not resolve a post when timeline removal has no local account', () => {
      mocks.resolveLocalAccountId.mockReturnValue(null)

      dispatch({
        backendUrl: 'https://missing.example',
        id: 18,
        statusId: 'remote-18',
        timelineType: 'home',
        type: 'removeFromTimeline',
      })

      expect(mocks.buildTimelineKey).not.toHaveBeenCalled()
      expect(mocks.resolvePostIdInternal).not.toHaveBeenCalled()
      expect(mocks.handleRemoveFromTimeline).not.toHaveBeenCalled()
      expect(mocks.sendResponse).toHaveBeenCalledWith(18, { ok: true }, [])
    })

    it('does not remove a timeline entry when the remote post is unknown', () => {
      mocks.resolvePostIdInternal.mockReturnValue(null)

      dispatch({
        backendUrl: 'https://social.example',
        id: 19,
        statusId: 'missing-post',
        timelineType: 'home',
        type: 'removeFromTimeline',
      })

      expect(mocks.buildTimelineKey).toHaveBeenCalledWith('home', {
        tag: undefined,
      })
      expect(mocks.handleRemoveFromTimeline).not.toHaveBeenCalled()
      expect(mocks.sendResponse).toHaveBeenCalledWith(19, { ok: true }, [])
    })
  })

  describe('notification, cleanup, account, and emoji requests', () => {
    it('adds a notification and forwards its backend change hint', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 20,
        notificationJson: '{"id":"notification"}',
        type: 'addNotification',
      })

      expect(mocks.handleAddNotification).toHaveBeenCalledWith(
        db,
        '{"id":"notification"}',
        'https://social.example',
      )
      expectOkResponse(20, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('adds a batch of notifications', () => {
      dispatch({
        backendUrl: 'https://social.example',
        id: 21,
        notificationsJson: ['{"id":"one"}', '{"id":"two"}'],
        type: 'bulkAddNotifications',
      })

      expect(mocks.handleBulkAddNotifications).toHaveBeenCalledWith(
        db,
        ['{"id":"one"}', '{"id":"two"}'],
        'https://social.example',
      )
      expectOkResponse(21, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('updates status actions embedded in notifications', () => {
      dispatch({
        action: 'reblogged',
        backendUrl: 'https://social.example',
        id: 22,
        statusId: 'remote-22',
        type: 'updateNotificationStatusAction',
        value: true,
      })

      expect(mocks.handleUpdateNotificationStatusAction).toHaveBeenCalledWith(
        db,
        'https://social.example',
        'remote-22',
        'reblogged',
        true,
      )
      expectOkResponse(22, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('enforces cleanup limits and returns progress details', () => {
      dispatch({
        batchLimit: 25,
        id: 23,
        mode: 'emergency',
        targetRatio: 0.4,
        type: 'enforceMaxLength',
      })

      expect(mocks.handleEnforceMaxLength).toHaveBeenCalledWith(
        db,
        100,
        200,
        300,
        {
          batchLimit: 25,
          mode: 'emergency',
          targetRatio: 0.4,
        },
      )
      expect(mocks.sendResponse).toHaveBeenCalledWith(
        23,
        {
          deletedCounts: {
            notifications: 2,
            posts: 3,
            timeline_entries: 1,
          },
          hasMore: true,
          ok: true,
          phaseTimings: {
            notifications: 2,
            phase1Total: 3,
            phase2Total: 4,
            postsCount: 1,
            postsDelete: 3,
            timeline: 1,
            total: 7,
          },
        },
        ['timeline_entries', 'posts'],
      )
    })

    it('ensures the active local account exists', () => {
      dispatch({
        accountJson: '{"id":"me"}',
        backendUrl: 'https://social.example',
        id: 24,
        type: 'ensureLocalAccount',
      })

      expect(mocks.handleEnsureLocalAccount).toHaveBeenCalledWith(
        db,
        'https://social.example',
        '{"id":"me"}',
      )
      expect(mocks.sendResponse).toHaveBeenCalledWith(24, { ok: true }, [
        'posts',
      ])
    })

    it('toggles a reaction for the resolved local account', () => {
      dispatch({
        backendUrl: 'https://social.example',
        emoji: ':blobcat:',
        id: 25,
        statusId: 'remote-25',
        type: 'toggleReaction',
        value: true,
      })

      expect(mocks.handleToggleReaction).toHaveBeenCalledWith(
        db,
        11,
        'remote-25',
        true,
        ':blobcat:',
      )
      expectOkResponse(25, ['posts'], {
        backendUrl: 'https://social.example',
      })
    })

    it('treats a reaction without a local account as a no-op', () => {
      mocks.resolveLocalAccountId.mockReturnValue(null)

      dispatch({
        backendUrl: 'https://missing.example',
        emoji: '👍',
        id: 26,
        statusId: 'remote-26',
        type: 'toggleReaction',
        value: false,
      })

      expect(mocks.handleToggleReaction).not.toHaveBeenCalled()
      expect(mocks.sendResponse).toHaveBeenCalledWith(26, { ok: true }, [])
    })

    it('upserts a backend custom emoji catalog', () => {
      dispatch({
        backendUrl: 'https://social.example',
        emojisJson: '[{"shortcode":"blobcat"}]',
        id: 27,
        type: 'bulkUpsertCustomEmojis',
      })

      expect(mocks.handleBulkUpsertCustomEmojis).toHaveBeenCalledWith(
        db,
        'https://social.example',
        '[{"shortcode":"blobcat"}]',
      )
      expect(mocks.sendResponse).toHaveBeenCalledWith(27, { ok: true }, [
        'posts',
      ])
    })
  })

  describe('query and timeline requests', () => {
    it('adds captured versions to legacy query-plan results', () => {
      const plan = { meta: {}, steps: [] }

      dispatch({ id: 40, plan, type: 'executeQueryPlan' })

      expect(mocks.runQueryPlan).toHaveBeenCalledWith(db, plan)
      expect(mocks.captureTableVersions).toHaveBeenCalledOnce()
      expect(mocks.sendResponse).toHaveBeenCalledWith(
        40,
        {
          capturedVersions: {
            posts: 4,
            timeline_entries: 2,
          },
          stepResults: [],
          totalDurationMs: 8,
        },
        undefined,
        8,
      )
    })

    it('synchronizes cache versions before executing a graph plan', () => {
      const options = { limit: 30 }
      const plan = { nodes: [] }

      dispatch({ id: 41, options, plan, type: 'executeGraphPlan' })

      expect(mocks.syncGraphCacheVersions).toHaveBeenCalledWith(
        mocks.getTableVersionsMap.mock.results[0].value,
      )
      expect(mocks.runGraphPlan).toHaveBeenCalledWith(
        db,
        plan,
        options,
        mocks.captureTableVersions,
      )
      expect(mocks.sendResponse).toHaveBeenCalledWith(
        41,
        {
          meta: { totalDurationMs: 9 },
          rows: [],
        },
        undefined,
        9,
      )
    })

    it('executes a flat entity fetch and reports its duration', () => {
      const request = { ids: [1, 2], sourceType: 'post' }

      dispatch({ id: 42, request, type: 'executeFlatFetch' })

      expect(mocks.runFlatFetch).toHaveBeenCalledWith(db, request)
      expect(mocks.sendResponse).toHaveBeenCalledWith(
        42,
        {
          meta: { totalDurationMs: 10 },
          rows: [],
        },
        undefined,
        10,
      )
    })

    it('delegates complete timeline fetching to its specialized handler', () => {
      const message = {
        batchSqls: {},
        id: 43,
        phase1: { bind: [], sql: 'SELECT id FROM posts' },
        phase2BaseSql: 'SELECT * FROM posts WHERE id IN ({IDS})',
        type: 'fetchTimeline',
      }

      dispatch(message)

      expect(mocks.handleFetchTimeline).toHaveBeenCalledWith(message)
      expect(mocks.sendResponse).toHaveBeenCalledWith(43, {
        phase1Rows: [],
      })
    })
  })

  describe('dispatch and runtime recovery failures', () => {
    it('reports unknown request types with the original request id', () => {
      dispatch({ id: 50, type: 'futureRequest' })

      expect(mocks.sendError).toHaveBeenCalledWith(
        50,
        'Unknown message type: futureRequest',
      )
    })

    it('reports ordinary handler errors without attempting recovery', () => {
      const error = new Error('query syntax error')
      mocks.handleExec.mockImplementation(() => {
        throw error
      })

      dispatch({ id: 51, sql: 'invalid SQL', type: 'exec' })

      expect(mocks.sendError).toHaveBeenCalledWith(51, error)
      expect(mocks.isSqliteCorruptError).toHaveBeenCalledWith(error)
      expect(mocks.recoverFromCorruption).not.toHaveBeenCalled()
    })

    it.each([
      ['restored', 'Restored from backup'],
      ['reset', 'Reset to empty database'],
      ['failed', 'Recovery failed'],
    ])(
      'publishes the %s runtime recovery outcome and invalidates all tables',
      async (method, reason) => {
        const corruption = new Error('database disk image is malformed')
        mocks.handleExec.mockImplementation(() => {
          throw corruption
        })
        mocks.isSqliteCorruptError.mockReturnValue(true)
        mocks.recoverFromCorruption.mockResolvedValue(method)

        dispatch({ id: 52, sql: 'SELECT * FROM posts', type: 'exec' })

        await vi.waitFor(() => {
          expect(postMessage).toHaveBeenCalledWith({
            method,
            reason,
            type: 'db-recovered',
          })
        })
        expect(mocks.sendError).toHaveBeenCalledWith(52, corruption)
        expect(mocks.recoverFromCorruption).toHaveBeenCalledWith(db, sqlite3)
        expect(mocks.isDatabaseHealthy).toHaveBeenCalledWith(db)
        expect(mocks.bumpTableVersions).toHaveBeenCalledWith([
          'cards',
          'hashtags',
          'local_accounts',
          'notifications',
          'poll_options',
          'polls',
          'post_backend_ids',
          'post_custom_emojis',
          'post_hashtags',
          'post_interactions',
          'post_media',
          'post_mentions',
          'post_stats',
          'posts',
          'profile_custom_emojis',
          'profiles',
          'servers',
          'timeline_entries',
        ])
      },
    )

    it('warns when recovery finishes but the database is still unhealthy', async () => {
      mocks.handleExec.mockImplementation(() => {
        throw new Error('SQLITE_CORRUPT')
      })
      mocks.isSqliteCorruptError.mockReturnValue(true)
      mocks.isDatabaseHealthy.mockReturnValue(false)
      mocks.recoverFromCorruption.mockResolvedValue('reset')

      dispatch({ id: 53, sql: 'SELECT 1', type: 'exec' })

      await vi.waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          'SQLite Worker: runtime recovery completed but DB still corrupt',
        )
      })
      expect(postMessage).toHaveBeenCalledWith({
        method: 'reset',
        reason: 'Reset to empty database',
        type: 'db-recovered',
      })
    })

    it.each([
      [new Error('backup restore exploded'), 'backup restore exploded'],
      ['non-error rejection', 'non-error rejection'],
    ])('publishes failures thrown by recovery', async (error, message) => {
      mocks.handleExec.mockImplementation(() => {
        throw new Error('SQLITE_CORRUPT')
      })
      mocks.isSqliteCorruptError.mockReturnValue(true)
      mocks.recoverFromCorruption.mockRejectedValue(error)

      dispatch({ id: 54, sql: 'SELECT 1', type: 'exec' })

      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith({
          method: 'failed',
          reason: `Recovery error: ${message}`,
          type: 'db-recovered',
        })
      })
      expect(console.error).toHaveBeenCalledWith(
        'SQLite Worker: runtime recovery failed:',
        error,
      )
    })

    it.each([
      ['database', null, sqlite3],
      ['SQLite module', db, null],
    ])(
      'abandons runtime recovery safely when the %s is unavailable',
      (_dependency, activeDb, activeSqlite3) => {
        mocks.getDb.mockReturnValue(activeDb)
        mocks.getSqlite3Module.mockReturnValue(activeSqlite3)
        mocks.handleExec.mockImplementation(() => {
          throw new Error('SQLITE_CORRUPT')
        })
        mocks.isSqliteCorruptError.mockReturnValue(true)

        dispatch({ id: 55, sql: 'SELECT 1', type: 'exec' })

        expect(mocks.recoverFromCorruption).not.toHaveBeenCalled()
        expect(postMessage).not.toHaveBeenCalled()

        dispatch({ id: 56, type: 'ready' })
        expect(mocks.sendResponse).toHaveBeenCalledWith(56, true)
      },
    )

    it('rejects messages received while asynchronous recovery is active', async () => {
      let finishRecovery: (result: 'restored') => void = () => {
        throw new Error('Recovery promise was not initialized')
      }
      const pendingRecovery = new Promise<'restored'>((resolve) => {
        finishRecovery = resolve
      })
      mocks.handleExec.mockImplementation(() => {
        throw new Error('SQLITE_CORRUPT')
      })
      mocks.isSqliteCorruptError.mockReturnValue(true)
      mocks.recoverFromCorruption.mockReturnValue(pendingRecovery)

      dispatch({ id: 57, sql: 'SELECT 1', type: 'exec' })
      dispatch({ id: 58, type: 'ready' })

      expect(mocks.sendError).toHaveBeenLastCalledWith(
        58,
        'Database recovery in progress',
      )
      expect(mocks.sendResponse).not.toHaveBeenCalledWith(58, true)
      expect(mocks.getDb).toHaveBeenCalledTimes(2)

      finishRecovery('restored')
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledWith({
          method: 'restored',
          reason: 'Restored from backup',
          type: 'db-recovered',
        })
      })

      dispatch({ id: 59, type: 'ready' })
      expect(mocks.sendResponse).toHaveBeenCalledWith(59, true)
    })
  })
})
