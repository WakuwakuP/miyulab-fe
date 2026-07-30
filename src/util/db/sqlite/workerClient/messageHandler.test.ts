import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_TABLE_NAMES, type WorkerMessage } from '../protocol'
import { handleMessage, onSlowQueryLogs } from './messageHandler'
import {
  durationForId,
  getInitReject,
  getInitResolve,
  getInitTimer,
  pending,
  setInitReject,
  setInitResolve,
  setInitTimer,
  setNotifyChangeCallback,
  setSlowQueryLogCallback,
} from './state'

const dbQueueMocks = vi.hoisted(() => ({
  startSnapshotRecording: vi.fn(),
}))

vi.mock('../../dbQueue', () => dbQueueMocks)

function dispatch(message: WorkerMessage): void {
  handleMessage({ data: message } as MessageEvent<WorkerMessage>)
}

function resetMessageHandlerState(): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
  }
  pending.clear()
  durationForId.clear()
  const initTimer = getInitTimer()
  if (initTimer != null) {
    clearTimeout(initTimer)
  }
  setInitTimer(null)
  setInitResolve(null)
  setInitReject(null)
  setNotifyChangeCallback(null)
  setSlowQueryLogCallback(null)
}

describe('workerClient messageHandler', () => {
  beforeEach(() => {
    resetMessageHandlerState()
    dbQueueMocks.startSnapshotRecording.mockReset()
  })

  afterEach(() => {
    resetMessageHandlerState()
    vi.restoreAllMocks()
  })

  it('初期化待ちでない init メッセージは無視する', () => {
    dispatch({ persistence: 'memory', type: 'init' })

    expect(dbQueueMocks.startSnapshotRecording).not.toHaveBeenCalled()
  })

  it('init を解決し、初期化タイマーとコールバックをクリアする', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let resolveInit!: (persistence: 'opfs' | 'memory') => void
    let rejectInit!: (error: Error) => void
    const init = new Promise<'opfs' | 'memory'>((resolve, reject) => {
      resolveInit = resolve
      rejectInit = reject
    })
    setInitResolve(resolveInit)
    setInitReject(rejectInit)
    setInitTimer(setTimeout(() => undefined, 60_000))

    dispatch({
      persistence: 'opfs',
      recovered: 'restored',
      type: 'init',
    })

    await expect(init).resolves.toBe('opfs')
    expect(dbQueueMocks.startSnapshotRecording).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      'SQLite: database was recovered at startup (restored)',
    )
    expect(getInitResolve()).toBeNull()
    expect(getInitReject()).toBeNull()
    expect(getInitTimer()).toBeNull()
  })

  it('通常の init ではリカバリ警告を出さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let resolveInit!: (persistence: 'opfs' | 'memory') => void
    const init = new Promise<'opfs' | 'memory'>((resolve) => {
      resolveInit = resolve
    })
    setInitResolve(resolveInit)

    dispatch({ persistence: 'memory', type: 'init' })

    await expect(init).resolves.toBe('memory')
    expect(warn).not.toHaveBeenCalled()
  })

  it('response を pending へ dispatch し、変更テーブルごとに同じ enriched hint を通知する', () => {
    const resolve = vi.fn()
    const reject = vi.fn()
    const timer = setTimeout(() => undefined, 60_000)
    pending.set(7, { kind: 'other', reject, resolve, timer })
    const notify = vi.fn()
    setNotifyChangeCallback(notify)

    dispatch({
      changedTables: ['posts', 'post_interactions'],
      changeHint: { backendUrl: 'https://example.test', timelineType: 'home' },
      durationMs: 12.5,
      id: 7,
      result: { ok: true },
      type: 'response',
    })

    expect(pending.has(7)).toBe(false)
    expect(resolve).toHaveBeenCalledWith({ ok: true })
    expect(reject).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify.mock.calls).toEqual([
      [
        'posts',
        {
          backendUrl: 'https://example.test',
          changedTables: ['posts', 'post_interactions'],
          timelineType: 'home',
        },
      ],
      [
        'post_interactions',
        {
          backendUrl: 'https://example.test',
          changedTables: ['posts', 'post_interactions'],
          timelineType: 'home',
        },
      ],
    ])
    expect(durationForId.get(7)).toBe(12.5)
    clearTimeout(timer)
  })

  it('変更情報のない response も解決し、不明な id の response は無視する', () => {
    const resolve = vi.fn()
    const timer = setTimeout(() => undefined, 60_000)
    pending.set(8, {
      kind: 'timeline',
      reject: vi.fn(),
      resolve,
      timer,
    })
    const notify = vi.fn()
    setNotifyChangeCallback(notify)

    dispatch({ id: 8, result: 'done', type: 'response' })
    dispatch({
      changedTables: ['posts'],
      durationMs: 4,
      id: 999,
      result: 'late',
      type: 'response',
    })

    expect(resolve).toHaveBeenCalledWith('done')
    expect(notify).not.toHaveBeenCalled()
    expect(durationForId.has(8)).toBe(false)
    expect(durationForId.has(999)).toBe(false)
    clearTimeout(timer)
  })

  it('id=-1 の初期化エラーを初期化 Promise へ転送してタイマーを解除する', async () => {
    let rejectInit!: (error: Error) => void
    const init = new Promise<never>((_, reject) => {
      rejectInit = reject
    })
    const rejection = expect(init).rejects.toThrowError('OPFS unavailable')
    setInitReject(rejectInit)
    setInitResolve(vi.fn())
    setInitTimer(setTimeout(() => undefined, 60_000))

    dispatch({ error: 'OPFS unavailable', id: -1, type: 'error' })

    await rejection
    expect(getInitReject()).toBeNull()
    expect(getInitResolve()).toBeNull()
    expect(getInitTimer()).toBeNull()
  })

  it('通常の error は対応する pending だけを reject する', () => {
    const reject = vi.fn()
    const timer = setTimeout(() => undefined, 60_000)
    pending.set(9, {
      kind: 'priority',
      reject,
      resolve: vi.fn(),
      timer,
    })

    dispatch({ error: 'query failed', id: 9, type: 'error' })
    dispatch({ error: 'late error', id: 999, type: 'error' })

    expect(pending.has(9)).toBe(false)
    expect(reject).toHaveBeenCalledOnce()
    expect(reject.mock.calls[0][0]).toEqual(new Error('query failed'))
    clearTimeout(timer)
  })

  it('初期化 reject がなければ id=-1 も通常の pending error として扱う', () => {
    const reject = vi.fn()
    const timer = setTimeout(() => undefined, 60_000)
    pending.set(-1, {
      kind: 'other',
      reject,
      resolve: vi.fn(),
      timer,
    })

    dispatch({ error: 'late init error', id: -1, type: 'error' })

    expect(reject).toHaveBeenCalledOnce()
    expect(pending.has(-1)).toBe(false)
    clearTimeout(timer)
  })

  it('slowQueryLogs の購読と解除を行う', () => {
    const callback = vi.fn()
    const unsubscribe = onSlowQueryLogs(callback)
    const logs = [
      {
        bind: '[]',
        durationMs: 250,
        explainPlan: 'SCAN posts',
        sql: 'SELECT * FROM posts',
        timestamp: '2026-07-30T00:00:00.000Z',
        userAgent: 'vitest',
      },
    ]

    dispatch({ logs, type: 'slowQueryLogs' })
    expect(callback).toHaveBeenCalledWith(logs)

    unsubscribe()
    dispatch({ logs, type: 'slowQueryLogs' })
    expect(callback).toHaveBeenCalledOnce()
  })

  it('実行時 DB リカバリでは全テーブルの再読込を通知する', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notify = vi.fn()
    setNotifyChangeCallback(notify)

    dispatch({
      method: 'reset',
      reason: 'integrity check failed',
      type: 'db-recovered',
    })

    expect(warn).toHaveBeenCalledWith(
      'SQLite: database recovered at runtime (reset): integrity check failed',
    )
    expect(notify).toHaveBeenCalledTimes(ALL_TABLE_NAMES.length)
    expect(notify.mock.calls.map(([table]) => table)).toEqual(ALL_TABLE_NAMES)
    expect(notify.mock.calls.every(([, hint]) => hint === undefined)).toBe(true)
  })
})
