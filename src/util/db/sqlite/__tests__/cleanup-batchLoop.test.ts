/**
 * cleanup.ts — enforceMaxLength のバッチループ動作テスト
 *
 * sendCommand が hasMore を返している間はループ呼び出しし、false になったら停止することを検証する。
 */

import {
  __resetCleanupStateForTest,
  enforceMaxLength,
} from 'util/db/sqlite/cleanup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// getSqliteDb を差し替えるため、モジュール全体をモックする
vi.mock('util/db/sqlite/connection', () => {
  return {
    getSqliteDb: vi.fn(),
  }
})

import { getSqliteDb } from 'util/db/sqlite/connection'

type SendCommandCall = {
  command: { type: string; mode?: string; targetRatio?: number }
  opts?: { kind?: 'priority' | 'other' }
}

type MockHandleOptions = {
  /** execAsync が返す件数 [timeline_entries, notifications, posts]。順次返される。 */
  countsSequence?: [number, number, number][]
  /** execAsync を強制的に throw させたいテスト用 */
  execAsyncThrows?: boolean
}

function installMockHandle(
  responses: { hasMore: boolean }[],
  options: MockHandleOptions = {},
) {
  const calls: SendCommandCall[] = []
  let index = 0
  const sendCommand = vi.fn(
    async (
      command: SendCommandCall['command'],
      opts?: SendCommandCall['opts'],
    ) => {
      calls.push({ command, opts })
      const response = responses[index] ?? { hasMore: false }
      index++
      return {
        deletedCounts: { notifications: 0, posts: 0, timeline_entries: 0 },
        hasMore: response.hasMore,
        ok: true,
      }
    },
  )

  let countsIndex = 0
  const execAsync = vi.fn(async () => {
    if (options.execAsyncThrows) {
      throw new Error('execAsync failed (test)')
    }
    const seq = options.countsSequence ?? [[0, 0, 0]]
    const row = seq[countsIndex] ?? seq.at(-1) ?? [0, 0, 0]
    countsIndex++
    return [row]
  })

  vi.mocked(getSqliteDb).mockResolvedValue({
    cancelStaleRequests: vi.fn(),
    execAsync,
    execAsyncTimed: vi.fn(),
    execBatch: vi.fn(),
    executeFlatFetch: vi.fn(),
    executeGraphPlan: vi.fn(),
    executeQueryPlan: vi.fn(),
    fetchTimeline: vi.fn(),
    persistence: 'memory',
    sendCommand,
  })
  return { calls, execAsync, sendCommand }
}

describe('enforceMaxLength — batch loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetCleanupStateForTest()
  })

  afterEach(() => {
    vi.clearAllMocks()
    __resetCleanupStateForTest()
  })

  it('hasMore=false が返されるまで sendCommand を繰り返す', async () => {
    const { sendCommand } = installMockHandle([
      { hasMore: true },
      { hasMore: true },
      { hasMore: false },
    ])

    await enforceMaxLength()

    expect(sendCommand).toHaveBeenCalledTimes(3)
  })

  it('1 回の hasMore=false で即終了する', async () => {
    const { sendCommand } = installMockHandle([{ hasMore: false }])
    await enforceMaxLength()
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('options.kind="priority" を sendCommand に伝播させる', async () => {
    const { calls } = installMockHandle([{ hasMore: false }])
    await enforceMaxLength({ kind: 'priority' })
    expect(calls[0].opts?.kind).toBe('priority')
  })

  it('options.kind 未指定のとき "priority" が使われる', async () => {
    const { calls } = installMockHandle([{ hasMore: false }])
    await enforceMaxLength()
    expect(calls[0].opts?.kind).toBe('priority')
  })

  it('options.kind="other" を明示指定すれば sendCommand に伝播する', async () => {
    const { calls } = installMockHandle([{ hasMore: false }])
    await enforceMaxLength({ kind: 'other' })
    expect(calls[0].opts?.kind).toBe('other')
  })

  it('options.mode="emergency" と targetRatio がコマンドに含まれる', async () => {
    const { calls } = installMockHandle([{ hasMore: false }])
    await enforceMaxLength({
      kind: 'priority',
      mode: 'emergency',
      targetRatio: 0.5,
    })
    expect(calls[0].command).toMatchObject({
      mode: 'emergency',
      targetRatio: 0.5,
      type: 'enforceMaxLength',
    })
  })

  it('sendCommand が throw した場合、途中までの集計ログを出してから再 throw する', async () => {
    // 1 回目は成功 (削除件数あり)、2 回目で throw
    let callCount = 0
    const sendCommand = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return {
          deletedCounts: {
            notifications: 3,
            posts: 5,
            timeline_entries: 10,
          },
          hasMore: true,
          ok: true,
        }
      }
      throw new Error(
        'Worker request timed out (id=108, type=enforceMaxLength)',
      )
    })
    const execAsync = vi.fn(async () => [[0, 0, 0]])
    vi.mocked(getSqliteDb).mockResolvedValue({
      cancelStaleRequests: vi.fn(),
      execAsync,
      execAsyncTimed: vi.fn(),
      execBatch: vi.fn(),
      executeFlatFetch: vi.fn(),
      executeGraphPlan: vi.fn(),
      executeQueryPlan: vi.fn(),
      fetchTimeline: vi.fn(),
      persistence: 'memory',
      sendCommand,
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(enforceMaxLength()).rejects.toThrow(/Worker request timed out/)

    // `aborted (partial)` を含むログが呼ばれている
    const abortedCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('aborted (partial)'),
    )
    expect(abortedCalls.length).toBeGreaterThan(0)
    const message = String(abortedCalls[0][0])
    expect(message).toContain('timeline_entries=10')
    expect(message).toContain('notifications=3')
    expect(message).toContain('posts=5')
    expect(message).toContain('total=18')
    expect(message).toContain('iterations=2')

    warnSpy.mockRestore()
  })

  it('完了ログにテーブル件数を出力する (初回は前回比 n/a)', async () => {
    installMockHandle([{ hasMore: false }], {
      countsSequence: [[123, 45, 678]],
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await enforceMaxLength()

    const countsCalls = infoSpy.mock.calls.filter((args) =>
      String(args[0]).includes('table counts after'),
    )
    expect(countsCalls.length).toBe(1)
    const line = String(countsCalls[0][0])
    expect(line).toContain('timeline_entries=123 (n/a)')
    expect(line).toContain('notifications=45 (n/a)')
    expect(line).toContain('posts=678 (n/a)')

    infoSpy.mockRestore()
  })

  it('2 回目以降は前回からの差分を符号付きで出力する', async () => {
    // 1 回目: (1000, 200, 5000)
    // 2 回目: (900, 250, 5000)  → te=-100, n=+50, posts=±0
    installMockHandle([{ hasMore: false }, { hasMore: false }], {
      countsSequence: [
        [1000, 200, 5000],
        [900, 250, 5000],
      ],
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await enforceMaxLength()
    await enforceMaxLength()

    const countsCalls = infoSpy.mock.calls.filter((args) =>
      String(args[0]).includes('table counts after'),
    )
    expect(countsCalls.length).toBe(2)
    const second = String(countsCalls[1][0])
    expect(second).toContain('timeline_entries=900 (-100)')
    expect(second).toContain('notifications=250 (+50)')
    expect(second).toContain('posts=5000 (±0)')

    infoSpy.mockRestore()
  })

  it('execAsync が throw しても enforceMaxLength は完了し、unavailable ログを出す', async () => {
    installMockHandle([{ hasMore: false }], { execAsyncThrows: true })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await expect(enforceMaxLength()).resolves.toBeUndefined()

    const unavailable = infoSpy.mock.calls.find((args) =>
      String(args[0]).includes('table counts unavailable'),
    )
    expect(unavailable).toBeDefined()

    infoSpy.mockRestore()
  })

  it('件数クエリが空でも各テーブルをゼロとしてログ出力する', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined)
    const execAsync = vi.fn().mockResolvedValue([])
    vi.mocked(getSqliteDb).mockResolvedValue({
      cancelStaleRequests: vi.fn(),
      execAsync,
      execAsyncTimed: vi.fn(),
      execBatch: vi.fn(),
      executeFlatFetch: vi.fn(),
      executeGraphPlan: vi.fn(),
      executeQueryPlan: vi.fn(),
      fetchTimeline: vi.fn(),
      persistence: 'memory',
      sendCommand,
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await enforceMaxLength()

    const countsLine = infoSpy.mock.calls.find((args) =>
      String(args[0]).includes('table counts after'),
    )
    expect(countsLine?.[0]).toContain('timeline_entries=0')
    expect(countsLine?.[0]).toContain('notifications=0')
    expect(countsLine?.[0]).toContain('posts=0')
  })

  it('null のテーブル件数をゼロへ正規化する', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ hasMore: false })
    const execAsync = vi.fn().mockResolvedValue([[null, null, null]])
    vi.mocked(getSqliteDb).mockResolvedValue({
      cancelStaleRequests: vi.fn(),
      execAsync,
      execAsyncTimed: vi.fn(),
      execBatch: vi.fn(),
      executeFlatFetch: vi.fn(),
      executeGraphPlan: vi.fn(),
      executeQueryPlan: vi.fn(),
      fetchTimeline: vi.fn(),
      persistence: 'memory',
      sendCommand,
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await enforceMaxLength()

    expect(
      infoSpy.mock.calls.find((args) =>
        String(args[0]).includes('table counts after'),
      )?.[0],
    ).toContain(
      'timeline_entries=0 (n/a), notifications=0 (n/a), posts=0 (n/a)',
    )
  })

  it('複数バッチの phase timings を合計し最大値を記録する', async () => {
    const phase = (total: number) => ({
      notifications: total + 1,
      phase1Total: total + 2,
      phase2Total: total + 3,
      postsCount: total + 4,
      postsDelete: total + 5,
      timeline: total + 6,
      total: total + 7,
    })
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        hasMore: true,
        phaseTimings: phase(20),
      })
      .mockResolvedValueOnce({
        hasMore: false,
        phaseTimings: phase(10),
      })
    const execAsync = vi.fn().mockResolvedValue([[0, 0, 0]])
    vi.mocked(getSqliteDb).mockResolvedValue({
      cancelStaleRequests: vi.fn(),
      execAsync,
      execAsyncTimed: vi.fn(),
      execBatch: vi.fn(),
      executeFlatFetch: vi.fn(),
      executeGraphPlan: vi.fn(),
      executeQueryPlan: vi.fn(),
      fetchTimeline: vi.fn(),
      persistence: 'memory',
      sendCommand,
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    await enforceMaxLength()

    const timingsLine = String(
      infoSpy.mock.calls.find((args) =>
        String(args[0]).includes('phase timings'),
      )?.[0],
    )
    expect(timingsLine).toContain('phase2Total=36 (maxBatch=23)')
    expect(timingsLine).toContain('postsDelete=40 (maxBatch=25)')
    expect(timingsLine).toContain('workerTotal=44')
  })

  it('中断時も収集済み phase timings と件数を警告ログへ残す', async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        hasMore: true,
        phaseTimings: {
          notifications: 1,
          phase1Total: 2,
          phase2Total: 3,
          postsCount: 4,
          postsDelete: 5,
          timeline: 6,
          total: 7,
        },
      })
      .mockRejectedValueOnce(new Error('worker stopped'))
    const execAsync = vi.fn().mockResolvedValue([[1, 2, 3]])
    vi.mocked(getSqliteDb).mockResolvedValue({
      cancelStaleRequests: vi.fn(),
      execAsync,
      execAsyncTimed: vi.fn(),
      execBatch: vi.fn(),
      executeFlatFetch: vi.fn(),
      executeGraphPlan: vi.fn(),
      executeQueryPlan: vi.fn(),
      fetchTimeline: vi.fn(),
      persistence: 'memory',
      sendCommand,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(enforceMaxLength()).rejects.toThrow('worker stopped')

    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0]).includes('phase timings'),
      ),
    ).toBe(true)
    expect(
      warnSpy.mock.calls.some((args) =>
        String(args[0]).includes('table counts after aborted'),
      ),
    ).toBe(true)
  })

  it('安全上限の100バッチで停止して次回継続を警告する', async () => {
    const { sendCommand } = installMockHandle(
      Array.from({ length: 100 }, () => ({ hasMore: true })),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await enforceMaxLength()

    expect(sendCommand).toHaveBeenCalledTimes(100)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reached MAX_BATCH_ITERATIONS (100)'),
    )
  })
})
