/**
 * cleanup.ts — enforceMaxLength のバッチループ動作テスト
 *
 * sendCommand が hasMore を返している間はループ呼び出しし、false になったら停止することを検証する。
 */

import { enforceMaxLength } from 'util/db/sqlite/cleanup'
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

function installMockHandle(responses: { hasMore: boolean }[]) {
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
  vi.mocked(getSqliteDb).mockResolvedValue({
    sendCommand,
  } as unknown as Awaited<ReturnType<typeof getSqliteDb>>)
  return { calls, sendCommand }
}

describe('enforceMaxLength — batch loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
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
    vi.mocked(getSqliteDb).mockResolvedValue({
      sendCommand,
    } as unknown as Awaited<ReturnType<typeof getSqliteDb>>)

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
})
