import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { logSlowQueryExplain } = vi.hoisted(() => ({
  logSlowQueryExplain: vi.fn(),
}))

vi.mock('util/db/sqlite/explainLogger', () => ({
  logSlowQueryExplain,
}))

import {
  handleExec,
  handleExecBatch,
} from 'util/db/sqlite/worker/workerExecHandlers'
import { handleFetchTimeline } from 'util/db/sqlite/worker/workerFetchTimelineHandler'
import {
  sendError,
  sendResponse,
} from 'util/db/sqlite/worker/workerMessageHelpers'
import {
  bumpTableVersions,
  captureTableVersions,
  getDb,
  getSqlite3Module,
  getTableVersionsMap,
  setDb,
  setSqlite3Module,
} from 'util/db/sqlite/worker/workerState'

describe('worker state and message helpers', () => {
  const postMessage = vi.fn()

  beforeEach(() => {
    postMessage.mockReset()
    vi.stubGlobal('self', { postMessage })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setDb(null)
    setSqlite3Module(null)
  })

  it('stores the active database and sqlite module', () => {
    const db = { exec: vi.fn() }
    const sqlite3Module = { capi: {} }

    setDb(db)
    setSqlite3Module(sqlite3Module)

    expect(getDb()).toBe(db)
    expect(getSqlite3Module()).toBe(sqlite3Module)
  })

  it('increments and captures table versions', () => {
    const before = captureTableVersions().posts ?? 0

    bumpTableVersions(undefined)
    bumpTableVersions(['posts'])
    bumpTableVersions(['posts'])

    expect(captureTableVersions().posts).toBe(before + 2)
    expect(getTableVersionsMap().get('posts')).toBe(before + 2)
  })

  it('posts a response and increments versions for changed tables', () => {
    const before = captureTableVersions().timeline_entries ?? 0

    sendResponse(42, { ok: true }, ['timeline_entries'], 12.5, {
      backendUrl: 'https://example.com',
      timelineType: 'home',
    })

    expect(captureTableVersions().timeline_entries).toBe(before + 1)
    expect(postMessage).toHaveBeenCalledWith({
      changedTables: ['timeline_entries'],
      changeHint: {
        backendUrl: 'https://example.com',
        timelineType: 'home',
      },
      durationMs: 12.5,
      id: 42,
      result: { ok: true },
      type: 'response',
    })
  })

  it.each([
    [new Error('broken'), 'broken'],
    ['plain failure', 'plain failure'],
  ])('normalizes worker errors before posting', (error, expected) => {
    sendError(7, error)

    expect(postMessage).toHaveBeenCalledWith({
      error: expected,
      id: 7,
      type: 'error',
    })
  })
})

describe('worker exec handlers', () => {
  beforeEach(() => {
    logSlowQueryExplain.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setDb(null)
  })

  it('returns result rows and records the worker execution duration', () => {
    const rows = [[1, 'hello']]
    const exec = vi.fn().mockReturnValue(rows)
    setDb({ exec })
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(125)

    expect(handleExec('SELECT value FROM items', [1], 'resultRows')).toEqual({
      durationMs: 25,
      result: rows,
    })
    expect(exec).toHaveBeenCalledWith('SELECT value FROM items', {
      bind: [1],
      returnValue: 'resultRows',
    })
    expect(logSlowQueryExplain).toHaveBeenCalledWith(
      { exec },
      'SELECT value FROM items',
      [1],
      25,
    )
  })

  it('executes statements without requesting rows', () => {
    const exec = vi.fn()
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(10)

    expect(handleExec('DELETE FROM items')).toEqual({
      durationMs: 0,
      result: undefined,
    })
    expect(exec).toHaveBeenCalledWith('DELETE FROM items', {
      bind: undefined,
    })
  })

  it('commits a batch and returns only requested statement results', () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce([['first']])
      .mockReturnValueOnce([['second']])
      .mockReturnValueOnce(undefined)
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(0)

    const result = handleExecBatch(
      [
        { returnValue: 'resultRows', sql: 'SELECT 1' },
        { returnValue: 'resultRows', sql: 'SELECT 2' },
      ],
      true,
      [1],
    )

    expect(result).toEqual({ 1: [['second']] })
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN;',
      'SELECT 1',
      'SELECT 2',
      'COMMIT;',
    ])
  })

  it('returns all statement entries when returnIndices is omitted', () => {
    const exec = vi
      .fn()
      .mockReturnValueOnce([['first']])
      .mockReturnValueOnce(undefined)
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(0)

    expect(
      handleExecBatch(
        [
          { returnValue: 'resultRows', sql: 'SELECT 1' },
          { sql: 'UPDATE items SET value = 1' },
        ],
        false,
      ),
    ).toEqual({ 0: [['first']], 1: undefined })
  })

  it('rolls back and rethrows when a statement fails', () => {
    const failure = new Error('constraint failed')
    const exec = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockReturnValueOnce(undefined)
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(0)

    expect(() =>
      handleExecBatch([{ sql: 'INSERT INTO items VALUES (1)' }], true),
    ).toThrow(failure)
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN;',
      'INSERT INTO items VALUES (1)',
      'ROLLBACK;',
    ])
  })

  it('preserves the original error when rollback also fails', () => {
    const failure = new Error('insert failed')
    const exec = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockImplementationOnce(() => {
        throw new Error('rollback failed')
      })
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(0)

    expect(() =>
      handleExecBatch([{ sql: 'INSERT INTO items VALUES (1)' }], true),
    ).toThrow(failure)
  })
})

describe('handleFetchTimeline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setDb(null)
  })

  it('returns empty detail and batch results when phase 1 finds no posts', () => {
    const exec = vi.fn().mockReturnValue([])
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValueOnce(50).mockReturnValueOnce(53)

    const result = handleFetchTimeline({
      batchSqls: {
        belongingTags: 'tags {IDS}',
        customEmojis: 'emojis {IDS}',
        interactions: 'interactions {IDS}',
        media: 'media {IDS}',
        mentions: 'mentions {IDS}',
        polls: 'polls {IDS}',
        profileEmojis: 'profile-emojis {IDS}',
        timelineTypes: 'timelines {IDS}',
      },
      phase1: { bind: ['home'], sql: 'phase 1' },
      phase2BaseSql: 'phase 2 {IDS}',
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
      totalDurationMs: 3,
    })
    expect(exec).toHaveBeenCalledOnce()
  })

  it('fetches details and batches for posts and unique reblogs', () => {
    const phase1Rows = [[10], [20]]
    const firstPhase2Row = new Array(26).fill(null)
    const secondPhase2Row = new Array(26).fill(null)
    firstPhase2Row[25] = 30
    secondPhase2Row[25] = 10
    const phase2Rows = [firstPhase2Row, secondPhase2Row]
    const batchRows = [[10, 'batch']]
    const exec = vi
      .fn()
      .mockReturnValueOnce(phase1Rows)
      .mockReturnValueOnce(phase2Rows)
      .mockReturnValue(batchRows)
    setDb({ exec })
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(115)

    const result = handleFetchTimeline({
      batchSqls: {
        belongingTags: 'tags IN ({IDS})',
        customEmojis: 'emojis IN ({IDS})',
        interactions: 'interactions IN ({IDS})',
        media: 'media IN ({IDS})',
        mentions: 'mentions IN ({IDS})',
        polls: 'polls IN ({IDS})',
        profileEmojis: 'profile-emojis IN ({IDS})',
        timelineTypes: 'timelines IN ({IDS})',
      },
      phase1: { bind: ['home'], sql: 'phase 1' },
      phase2BaseSql: 'phase 2 IN ({IDS})',
    })

    expect(result.phase1Rows).toBe(phase1Rows)
    expect(result.phase2Rows).toBe(phase2Rows)
    expect(result.totalDurationMs).toBe(15)
    expect(result.batchResults.interactions).toBe(batchRows)
    expect(exec).toHaveBeenNthCalledWith(2, 'phase 2 IN (?,?)', {
      bind: [10, 20],
      returnValue: 'resultRows',
    })
    for (const [, options] of exec.mock.calls.slice(2)) {
      expect(options).toEqual({
        bind: [10, 20, 30],
        returnValue: 'resultRows',
      })
    }
    expect(exec.mock.calls.slice(2).map(([sql]) => sql)).toEqual([
      'tags IN (?,?,?)',
      'emojis IN (?,?,?)',
      'interactions IN (?,?,?)',
      'media IN (?,?,?)',
      'mentions IN (?,?,?)',
      'polls IN (?,?,?)',
      'profile-emojis IN (?,?,?)',
      'timelines IN (?,?,?)',
    ])
  })

  it('uses a custom reblog column index', () => {
    const phase2Row = [1, 99]
    const exec = vi
      .fn()
      .mockReturnValueOnce([[1]])
      .mockReturnValueOnce([phase2Row])
      .mockReturnValue([])
    setDb({ exec })
    vi.spyOn(performance, 'now').mockReturnValue(0)

    handleFetchTimeline({
      batchSqls: {
        belongingTags: '{IDS}',
        customEmojis: '{IDS}',
        interactions: '{IDS}',
        media: '{IDS}',
        mentions: '{IDS}',
        polls: '{IDS}',
        profileEmojis: '{IDS}',
        timelineTypes: '{IDS}',
      },
      phase1: { sql: 'phase 1' },
      phase2BaseSql: '{IDS}',
      reblogPostIdColumnIndex: 1,
    })

    expect(exec).toHaveBeenNthCalledWith(3, '?,?', {
      bind: [1, 99],
      returnValue: 'resultRows',
    })
  })
})
