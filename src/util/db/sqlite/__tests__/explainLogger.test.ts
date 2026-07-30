import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('logSlowQueryExplain', () => {
  const postMessage = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    postMessage.mockReset()
    vi.stubGlobal('postMessage', postMessage)
    vi.stubGlobal('navigator', { userAgent: 'vitest-agent' })
  })

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('ignores queries below the slow-query threshold', async () => {
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const db = { exec: vi.fn() }

    logSlowQueryExplain(db, 'SELECT 1', undefined, 999.9)

    expect(db.exec).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('logs the explain plan and flushes a structured entry', async () => {
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const db = {
      exec: vi.fn().mockReturnValue([
        [2, 0, 0, 'SEARCH posts USING INDEX posts_created_at_idx'],
        [5, 2],
      ]),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'))

    logSlowQueryExplain(db, '  SELECT   *\nFROM posts  ', [42, null], 1250.4)

    expect(db.exec).toHaveBeenCalledWith(
      'EXPLAIN QUERY PLAN   SELECT   *\nFROM posts  ',
      { bind: [42, null], returnValue: 'resultRows' },
    )
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('SEARCH posts USING INDEX posts_created_at_idx'),
    )
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(5_000)

    expect(postMessage).toHaveBeenCalledWith({
      logs: [
        {
          bind: '[42,null]',
          durationMs: 1250,
          explainPlan:
            '    SEARCH posts USING INDEX posts_created_at_idx\n    5,2',
          sql: 'SELECT * FROM posts',
          timestamp: '2026-07-30T00:00:00.000Z',
          userAgent: 'vitest-agent',
        },
      ],
      type: 'slowQueryLogs',
    })
  })

  it('records an entry even when EXPLAIN QUERY PLAN fails', async () => {
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const db = {
      exec: vi.fn().mockImplementation(() => {
        throw new Error('unsupported')
      }),
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    logSlowQueryExplain(db, 'PRAGMA optimize', [], 1000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('(EXPLAIN QUERY PLAN failed)'),
    )
    expect(postMessage.mock.calls[0][0].logs[0]).toMatchObject({
      bind: '[]',
      explainPlan: '(EXPLAIN QUERY PLAN failed)',
      sql: 'PRAGMA optimize',
    })
  })

  it('redacts tokens, long literals, and long bind values', async () => {
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const longSingleQuoted = `'${'s'.repeat(60)}'`
    const longDoubleQuoted = `"${'d'.repeat(60)}"`
    const trailingSql = ` ${'x'.repeat(600)}`
    const db = { exec: vi.fn().mockReturnValue([]) }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    logSlowQueryExplain(
      db,
      `SELECT 'Authorization: Bearer secret-token_123', ${longSingleQuoted}, ${longDoubleQuoted}${trailingSql}`,
      ['b'.repeat(101), 'short', 3],
      1500,
    )
    await vi.advanceTimersByTimeAsync(5_000)

    const entry = postMessage.mock.calls[0][0].logs[0]
    expect(entry.bind).toBe('["[REDACTED]","short",3]')
    expect(entry.sql).toContain('Bearer [REDACTED]')
    expect(entry.sql).toContain("'[REDACTED]'")
    expect(entry.sql).toContain('"[REDACTED]"')
    expect(entry.sql).toHaveLength(500)
  })

  it('flushes immediately after ten entries and cancels the timer', async () => {
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const db = { exec: vi.fn().mockReturnValue([]) }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    for (let i = 0; i < 10; i++) {
      logSlowQueryExplain(db, `SELECT ${i}`, undefined, 1000 + i)
    }

    expect(postMessage).toHaveBeenCalledOnce()
    expect(postMessage.mock.calls[0][0].logs).toHaveLength(10)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('discards queued logs in the main-window fallback environment', async () => {
    vi.stubGlobal('window', globalThis)
    const { logSlowQueryExplain } = await import('util/db/sqlite/explainLogger')
    const db = { exec: vi.fn().mockReturnValue([]) }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    logSlowQueryExplain(db, 'SELECT 1', undefined, 1000)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(postMessage).not.toHaveBeenCalled()
  })
})
