import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setQueuePriority } from '../../dbQueue'
import {
  cancelStaleRequests,
  resetQueueFairnessState,
  sendRequest,
} from './queueManager'
import {
  durationForId,
  getActiveRequest,
  otherQueue,
  pending,
  priorityQueue,
  setActiveRequest,
  setConsecutiveOther,
  setWorker,
  TIMEOUT_BY_TYPE,
  TIMEOUT_MS,
  timelineDedup,
  timelineQueue,
} from './state'

class FakeWorker {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()
}

function resetWorkerClientState(): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
  }
  pending.clear()
  priorityQueue.length = 0
  otherQueue.length = 0
  timelineQueue.length = 0
  timelineDedup.clear()
  setActiveRequest(false)
  setConsecutiveOther(0)
  resetQueueFairnessState()
  setWorker(null)
  setQueuePriority('auto')
}

function resolvePending(id: number, value: unknown, durationMs?: number): void {
  const request = pending.get(id)
  if (!request) {
    throw new Error(`No pending request for id=${id}`)
  }
  pending.delete(id)
  request.resolve(value, durationMs)
}

function rejectPending(id: number, reason: Error): void {
  const request = pending.get(id)
  if (!request) {
    throw new Error(`No pending request for id=${id}`)
  }
  pending.delete(id)
  request.reject(reason)
}

describe('workerClient queueManager', () => {
  let worker: FakeWorker

  beforeEach(() => {
    resetWorkerClientState()
    worker = new FakeWorker()
    setWorker(worker as unknown as Worker)
  })

  afterEach(() => {
    resetWorkerClientState()
    vi.useRealTimers()
  })

  it('Worker が未初期化ならリクエストを拒否する', async () => {
    setWorker(null)

    await expect(sendRequest({ id: 1, type: 'ready' })).rejects.toThrowError(
      'Worker not initialized',
    )
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('同時に送信するのは 1 件だけで priority、other、timeline の順に処理する', async () => {
    setQueuePriority('default')
    const active = sendRequest({ id: 1, type: 'ready' }, 'other')
    const timeline = sendRequest(
      { id: 2, sql: 'SELECT timeline', type: 'exec' },
      'timeline',
    )
    const other = sendRequest({ id: 3, type: 'ready' }, 'other')
    const priority = sendRequest({ id: 4, type: 'ready' }, 'priority')

    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1])
    expect(getActiveRequest()).toBe(true)

    resolvePending(1, 'active')
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 4])

    resolvePending(4, 'priority')
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 4, 3])

    resolvePending(3, 'other')
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 4, 3, 2])
    resolvePending(2, 'timeline')

    await expect(
      Promise.all([active, priority, other, timeline]),
    ).resolves.toEqual(['active', 'priority', 'other', 'timeline'])
    expect(pending).toHaveLength(0)
    expect(getActiveRequest()).toBe(false)
  })

  it('other の連続処理上限に達したら timeline に処理を譲る', async () => {
    setQueuePriority('balanced')
    const active = sendRequest({ id: 1, type: 'ready' }, 'other')
    const other = sendRequest({ id: 2, type: 'ready' }, 'other')
    const timeline = sendRequest(
      { id: 3, sql: 'SELECT timeline', type: 'exec' },
      'timeline',
    )
    setConsecutiveOther(2)

    resolvePending(1, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 3])

    resolvePending(3, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 3, 2])
    resolvePending(2, undefined)
    await Promise.all([active, other, timeline])
  })

  it('同一 timeline exec を 1 回だけ送信し、結果を全呼び出し元で共有する', async () => {
    const first = sendRequest(
      {
        bind: [1, 'home'],
        id: 1,
        returnValue: 'resultRows',
        sql: 'SELECT * FROM posts WHERE id = ? AND timeline = ?',
        type: 'exec',
      },
      'timeline',
    )
    const duplicate = sendRequest(
      {
        bind: [1, 'home'],
        id: 2,
        returnValue: 'resultRows',
        sql: 'SELECT * FROM posts WHERE id = ? AND timeline = ?',
        type: 'exec',
      },
      'timeline',
    )

    expect(worker.postMessage).toHaveBeenCalledOnce()
    expect(timelineQueue).toHaveLength(0)
    expect(timelineDedup).toHaveLength(1)

    const rows = [[1, 'post']]
    resolvePending(1, rows)

    await expect(Promise.all([first, duplicate])).resolves.toEqual([rows, rows])
    expect(timelineDedup).toHaveLength(0)
  })

  it('重複排除した timeline exec のエラーを全呼び出し元へ共有する', async () => {
    const first = sendRequest(
      { id: 1, sql: 'SELECT broken', type: 'exec' },
      'timeline',
    )
    const duplicate = sendRequest(
      { id: 2, sql: 'SELECT broken', type: 'exec' },
      'timeline',
    )
    const firstRejection = expect(first).rejects.toThrowError('query failed')
    const duplicateRejection =
      expect(duplicate).rejects.toThrowError('query failed')

    rejectPending(1, new Error('query failed'))

    await Promise.all([firstRejection, duplicateRejection])
    expect(worker.postMessage).toHaveBeenCalledOnce()
    expect(timelineDedup).toHaveLength(0)
  })

  it('bind または returnValue が異なる timeline exec は重複排除しない', async () => {
    const first = sendRequest(
      { bind: [1], id: 1, sql: 'SELECT ?', type: 'exec' },
      'timeline',
    )
    const differentBind = sendRequest(
      { bind: [2], id: 2, sql: 'SELECT ?', type: 'exec' },
      'timeline',
    )
    const differentReturnValue = sendRequest(
      {
        bind: [1],
        id: 3,
        returnValue: 'resultRows',
        sql: 'SELECT ?',
        type: 'exec',
      },
      'timeline',
    )

    expect(timelineQueue).toHaveLength(2)
    resolvePending(1, 'first')
    resolvePending(2, 'second')
    resolvePending(3, 'third')

    await expect(
      Promise.all([first, differentBind, differentReturnValue]),
    ).resolves.toEqual(['first', 'second', 'third'])
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 2, 3])
  })

  it('fetchTimeline は phase1 が同じなら 1 回の結果を共有する', async () => {
    const first = sendRequest(
      {
        id: 1,
        phase1: { bind: [], sql: 'SELECT id FROM posts' },
        phase2BaseSql: 'first detail query',
        type: 'fetchTimeline',
      },
      'timeline',
    )
    const duplicate = sendRequest(
      {
        id: 2,
        phase1: { bind: [], sql: 'SELECT id FROM posts' },
        phase2BaseSql: 'different detail query',
        type: 'fetchTimeline',
      },
      'timeline',
    )

    expect(worker.postMessage).toHaveBeenCalledOnce()
    resolvePending(1, { phase1Rows: [[1]] })

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { phase1Rows: [[1]] },
      { phase1Rows: [[1]] },
    ])
  })

  it('dedup 対象外の timeline メッセージは個別にキューへ積む', async () => {
    const first = sendRequest(
      { id: 1, plan: {}, type: 'executeGraphPlan' },
      'timeline',
    )
    const second = sendRequest(
      { id: 2, plan: {}, type: 'executeGraphPlan' },
      'timeline',
    )

    expect(timelineQueue).toHaveLength(1)
    resolvePending(1, 'first')
    resolvePending(2, 'second')

    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ])
  })

  it('同じ sessionTag の未送信 timeline を位置を保ったまま最新リクエストへ置換する', async () => {
    const blocker = sendRequest({ id: 1, type: 'ready' })
    const stale = sendRequest(
      { id: 2, sql: 'SELECT old', type: 'exec' },
      'timeline',
      'home-tab',
    )
    const enqueuedAt = timelineQueue[0].enqueuedAt
    const latest = sendRequest(
      { id: 3, sql: 'SELECT latest', type: 'exec' },
      'timeline',
      'home-tab',
    )

    await expect(stale).resolves.toBeUndefined()
    expect(timelineQueue).toHaveLength(1)
    expect(timelineQueue[0].message.id).toBe(3)
    expect(timelineQueue[0].enqueuedAt).toBe(enqueuedAt)

    resolvePending(1, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 3])
    resolvePending(3, 'latest')

    await blocker
    await expect(latest).resolves.toBe('latest')
  })

  it('cancelStaleRequests は一致する未送信 sessionTag だけを指定値で解決する', async () => {
    const blocker = sendRequest({ id: 1, type: 'ready' })
    const stale = sendRequest(
      { id: 2, sql: 'SELECT stale', type: 'exec' },
      'timeline',
      'stale-tab',
    )
    const retained = sendRequest(
      { id: 3, sql: 'SELECT retained', type: 'exec' },
      'timeline',
      'active-tab',
    )

    expect(cancelStaleRequests('missing')).toBe(0)
    expect(cancelStaleRequests('stale-tab', [])).toBe(1)
    await expect(stale).resolves.toEqual([])
    expect(timelineQueue.map((item) => item.message.id)).toEqual([3])

    resolvePending(1, undefined)
    resolvePending(3, 'retained')
    await blocker
    await expect(retained).resolves.toBe('retained')
  })

  it('timeline キュー上限を超えると最古のリクエストを破棄する', async () => {
    const blocker = sendRequest({ id: 1, type: 'ready' })
    const timelineRequests = Array.from({ length: 21 }, (_, index) =>
      sendRequest(
        {
          id: 100 + index,
          sql: `SELECT ${index}`,
          type: 'exec',
        },
        'timeline',
      ),
    )

    await expect(timelineRequests[0]).resolves.toBeUndefined()
    expect(timelineQueue).toHaveLength(20)
    expect(timelineQueue[0].message.id).toBe(101)

    resolvePending(1, undefined)
    for (let id = 101; id <= 120; id++) {
      resolvePending(id, id)
    }

    await blocker
    await expect(Promise.all(timelineRequests.slice(1))).resolves.toEqual(
      Array.from({ length: 20 }, (_, index) => 101 + index),
    )
  })

  it.each([
    ['未登録の操作種別', 'customRequest', TIMEOUT_MS],
    [
      '操作別設定がある種別',
      'bulkUpsertStatuses',
      TIMEOUT_BY_TYPE.bulkUpsertStatuses,
    ],
  ])(
    '%sは送信開始後の規定時間でタイムアウトする',
    async (_, type, timeoutMs) => {
      vi.useFakeTimers()
      const timedOut = sendRequest({ id: 1, type })
      const rejection = expect(timedOut).rejects.toThrowError(
        `Worker request timed out (id=1, type=${type})`,
      )
      const following = sendRequest({ id: 2, type: 'ready' })

      await vi.advanceTimersByTimeAsync(timeoutMs - 1)
      expect(pending.has(1)).toBe(true)
      expect(worker.postMessage).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1)
      await rejection
      expect(pending.has(1)).toBe(false)
      expect(
        worker.postMessage.mock.calls.map(([message]) => message.id),
      ).toEqual([1, 2])

      resolvePending(2, 'continued')
      await expect(following).resolves.toBe('continued')
    },
  )

  it('captureDuration=true の呼び出し元は { result, durationMs } で解決する', async () => {
    const timed = sendRequest(
      { id: 1, type: 'ready' },
      'other',
      undefined,
      true,
    )
    const normal = sendRequest({ id: 2, type: 'ready' }, 'other')

    resolvePending(1, 'row', 8.25)
    resolvePending(2, 'raw')

    await expect(timed).resolves.toEqual({ durationMs: 8.25, result: 'row' })
    await expect(normal).resolves.toBe('raw')
  })

  it('dedup した呼び出し元は同じ物理 duration を受け取りつつ形は個別になる', async () => {
    const normal = sendRequest(
      { id: 1, sql: 'SELECT shared', type: 'exec' },
      'timeline',
    )
    const timed = sendRequest(
      { id: 2, sql: 'SELECT shared', type: 'exec' },
      'timeline',
      undefined,
      true,
    )

    expect(worker.postMessage).toHaveBeenCalledOnce()
    const rows = [[1]]
    resolvePending(1, rows, 15)

    await expect(normal).resolves.toBe(rows)
    await expect(timed).resolves.toEqual({ durationMs: 15, result: rows })
    expect(timelineDedup).toHaveLength(0)
  })

  it('通常レスポンスは durationForId に何も残さない (200 件連続)', async () => {
    const requests = Array.from({ length: 200 }, (_, i) =>
      sendRequest({ id: i + 1, type: 'ready' }, 'other'),
    )
    for (let i = 1; i <= 200; i++) {
      resolvePending(i, i, 12.5)
    }

    await Promise.all(requests)
    expect(durationForId.size).toBe(0)
  })

  it('sessionTag キャンセルで duration なしの値が来ても timed wrapper は durationMs:0 で解決する', async () => {
    const blocker = sendRequest({ id: 1, type: 'ready' })
    const timed = sendRequest(
      { id: 2, sql: 'SELECT stale', type: 'exec' },
      'timeline',
      'stale-tab',
      true,
    )

    expect(cancelStaleRequests('stale-tab', [])).toBe(1)
    await expect(timed).resolves.toEqual({ durationMs: 0, result: [] })

    resolvePending(1, undefined)
    await blocker
  })

  it('timeline キュー上限で追い出された timed 呼び出し元は { result: undefined, durationMs: 0 } で解決する', async () => {
    const blocker = sendRequest({ id: 1, type: 'ready' })
    const requests = Array.from({ length: 21 }, (_, index) =>
      sendRequest(
        { id: 100 + index, sql: `SELECT ${index}`, type: 'exec' },
        'timeline',
        undefined,
        index === 0,
      ),
    )

    await expect(requests[0]).resolves.toEqual({
      durationMs: 0,
      result: undefined,
    })
    expect(timelineQueue).toHaveLength(20)

    resolvePending(1, undefined)
    for (let id = 101; id <= 120; id++) {
      resolvePending(id, id)
    }
    await blocker
    await Promise.all(requests.slice(1))
  })

  it('auto モードで other の連続サービスが 50ms を超えたら timeline に譲る', async () => {
    vi.useFakeTimers()
    setQueuePriority('auto')
    const first = sendRequest({ id: 1, type: 'ready' }, 'other')
    const second = sendRequest({ id: 2, type: 'ready' }, 'other')
    const timeline = sendRequest(
      { id: 3, sql: 'SELECT tl', type: 'exec' },
      'timeline',
    )

    await vi.advanceTimersByTimeAsync(60)
    resolvePending(1, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 3])

    resolvePending(3, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 3, 2])
    resolvePending(2, undefined)

    await Promise.all([first, second, timeline])
  })

  it('50ms 未満の連続 other サービスは回数上限まで優先される', async () => {
    vi.useFakeTimers()
    setQueuePriority('auto')
    const first = sendRequest({ id: 1, type: 'ready' }, 'other')
    const second = sendRequest({ id: 2, type: 'ready' }, 'other')
    const timeline = sendRequest(
      { id: 3, sql: 'SELECT tl', type: 'exec' },
      'timeline',
    )

    await vi.advanceTimersByTimeAsync(30)
    resolvePending(1, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 2])

    resolvePending(2, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 2, 3])
    resolvePending(3, undefined)

    await Promise.all([first, second, timeline])
  })

  it('auto 以外のプリセットでは経過時間ではなく回数上限だけで譲る', async () => {
    vi.useFakeTimers()
    setQueuePriority('balanced')
    const first = sendRequest({ id: 1, type: 'ready' }, 'other')
    const second = sendRequest({ id: 2, type: 'ready' }, 'other')
    const timeline = sendRequest(
      { id: 3, sql: 'SELECT tl', type: 'exec' },
      'timeline',
    )

    await vi.advanceTimersByTimeAsync(120)
    resolvePending(1, undefined)
    expect(
      worker.postMessage.mock.calls.map(([message]) => message.id),
    ).toEqual([1, 2])

    resolvePending(2, undefined)
    resolvePending(3, undefined)
    await Promise.all([first, second, timeline])
  })
})
