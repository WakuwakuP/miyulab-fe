import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  durationForId,
  getActiveRequest,
  getConsecutiveOther,
  getInitPromise,
  getInitReject,
  getInitResolve,
  getInitTimer,
  getNotifyChangeCallback,
  getSlowQueryLogCallback,
  getWorker,
  INIT_TIMEOUT_MS,
  incrementNextId,
  otherQueue,
  pending,
  priorityQueue,
  setActiveRequest,
  setConsecutiveOther,
  setInitPromise,
  setInitReject,
  setInitResolve,
  setInitTimer,
  setNextId,
  setNotifyChangeCallback,
  setSlowQueryLogCallback,
  setWorker,
  TIMEOUT_BY_TYPE,
  TIMEOUT_MS,
  timelineDedup,
  timelineQueue,
} from './state'

function resetState(): void {
  const initTimer = getInitTimer()
  if (initTimer != null) {
    clearTimeout(initTimer)
  }
  for (const request of pending.values()) {
    clearTimeout(request.timer)
  }
  pending.clear()
  priorityQueue.length = 0
  otherQueue.length = 0
  timelineQueue.length = 0
  timelineDedup.clear()
  durationForId.clear()
  setWorker(null)
  setNextId(0)
  setActiveRequest(false)
  setConsecutiveOther(0)
  setNotifyChangeCallback(null)
  setInitResolve(null)
  setInitReject(null)
  setInitPromise(null)
  setInitTimer(null)
  setSlowQueryLogCallback(null)
}

describe('workerClient state', () => {
  afterEach(() => {
    resetState()
  })

  it('タイムアウト定数を操作種別ごとに公開する', () => {
    expect(TIMEOUT_MS).toBe(30_000)
    expect(INIT_TIMEOUT_MS).toBe(15_000)
    expect(TIMEOUT_BY_TYPE).toEqual({
      bulkUpsertStatuses: 60_000,
      enforceMaxLength: 90_000,
      executeGraphPlan: 45_000,
    })
  })

  it('Worker、キュー状態、採番を共有する', () => {
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } as unknown as Worker

    setWorker(worker)
    setActiveRequest(true)
    setConsecutiveOther(3)
    setNextId(41)

    expect(getWorker()).toBe(worker)
    expect(getActiveRequest()).toBe(true)
    expect(getConsecutiveOther()).toBe(3)
    expect(incrementNextId()).toBe(41)
    expect(incrementNextId()).toBe(42)
  })

  it('初期化と通知に使うコールバック状態を保持・解除できる', async () => {
    const notify = vi.fn()
    const resolve = vi.fn()
    const reject = vi.fn()
    const slowQueryLog = vi.fn()
    const initPromise = Promise.resolve<'opfs' | 'memory'>('opfs')
    const timer = setTimeout(() => undefined, 60_000)

    setNotifyChangeCallback(notify)
    setInitResolve(resolve)
    setInitReject(reject)
    setInitPromise(initPromise)
    setInitTimer(timer)
    setSlowQueryLogCallback(slowQueryLog)

    expect(getNotifyChangeCallback()).toBe(notify)
    expect(getInitResolve()).toBe(resolve)
    expect(getInitReject()).toBe(reject)
    expect(getInitPromise()).toBe(initPromise)
    expect(getInitTimer()).toBe(timer)
    expect(getSlowQueryLogCallback()).toBe(slowQueryLog)
    await expect(getInitPromise()).resolves.toBe('opfs')

    setNotifyChangeCallback(null)
    setInitResolve(null)
    setInitReject(null)
    setInitPromise(null)
    setInitTimer(null)
    setSlowQueryLogCallback(null)
    clearTimeout(timer)

    expect(getNotifyChangeCallback()).toBeNull()
    expect(getInitResolve()).toBeNull()
    expect(getInitReject()).toBeNull()
    expect(getInitPromise()).toBeNull()
    expect(getInitTimer()).toBeNull()
    expect(getSlowQueryLogCallback()).toBeNull()
  })
})
