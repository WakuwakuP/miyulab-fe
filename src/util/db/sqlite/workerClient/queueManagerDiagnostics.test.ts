import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbWorkerRequestMetrics } from '../../dbDiagnosticTypes'

class FakeWorker {
  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()
}

async function setup() {
  vi.resetModules()
  const queueManager = await import('./queueManager')
  const state = await import('./state')
  const handler = await import('./messageHandler')
  const { setQueuePriority } = await import('../../dbQueue')
  const { dbDiagnosticRecorder } = await import('../../dbDiagnostics')
  const worker = new FakeWorker()
  state.setWorker(worker as unknown as Worker)
  const respond = (
    id: number,
    result: unknown = null,
    diagnostics?: DbWorkerRequestMetrics,
  ) =>
    handler.handleMessage({
      data: {
        diagnostics,
        id,
        result,
        type: 'response',
      },
    } as MessageEvent)
  const respondError = (id: number, error = 'failed') =>
    handler.handleMessage({
      data: { error, id, type: 'error' },
    } as MessageEvent)
  return {
    cancelStaleRequests: queueManager.cancelStaleRequests,
    dbDiagnosticRecorder,
    pending: state.pending,
    respond,
    respondError,
    sendRequest: queueManager.sendRequest,
    setQueuePriority,
    setWorker: state.setWorker,
    state,
    timelineQueue: state.timelineQueue,
    worker,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queueManager diagnostics lifecycle', () => {
  it('物理リクエストごとに enqueue→start→end を記録し Worker 計測を反映する', async () => {
    const { dbDiagnosticRecorder, pending, respond, sendRequest } =
      await setup()
    const request = sendRequest(
      { id: 1, statusesJson: ['a', 'b'], type: 'bulkUpsertStatuses' },
      'other',
    )
    expect(pending.has(1)).toBe(true)

    const metrics: DbWorkerRequestMetrics = {
      resultRows: 0,
      sqlCalls: 3,
      sqlTimeMs: 2,
      workerDurationMs: 7,
    }
    respond(1, { ok: true }, metrics)
    await expect(request).resolves.toEqual({ ok: true })

    const window = dbDiagnosticRecorder.capture()
    const op = window?.operations.find((o) => o.kind === 'other')
    expect(op).toMatchObject({
      enqueued: 1,
      failed: 0,
      requestedItems: 2,
      sqlCalls: 3,
      started: 1,
      succeeded: 1,
      workerMeasured: 1,
      workerSumMs: 7,
    })
    expect(window?.active).toBeNull()
  })

  it('dedup に合流した呼び出しは物理 enqueue として数えない', async () => {
    const { dbDiagnosticRecorder, respond, sendRequest } = await setup()
    const first = sendRequest(
      { id: 1, sql: 'SELECT shared', type: 'exec' },
      'timeline',
    )
    const duplicate = sendRequest(
      { id: 2, sql: 'SELECT shared', type: 'exec' },
      'timeline',
    )

    respond(1, [[1]])
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      [[1]],
      [[1]],
    ])

    const window = dbDiagnosticRecorder.capture()
    const op = window?.operations.find((o) => o.kind === 'timeline')
    expect(op).toMatchObject({ enqueued: 1, started: 1, succeeded: 1 })
  })

  it('sessionTag 置換は旧リクエストを cancelled、新リクエストを enqueue する', async () => {
    const { dbDiagnosticRecorder, respond, sendRequest } = await setup()
    const blocker = sendRequest({ id: 1, type: 'ready' }, 'other')
    const stale = sendRequest(
      { id: 2, sql: 'SELECT old', type: 'exec' },
      'timeline',
      'home-tab',
    )
    const latest = sendRequest(
      { id: 3, sql: 'SELECT new', type: 'exec' },
      'timeline',
      'home-tab',
    )

    await expect(stale).resolves.toBeUndefined()
    respond(1, null)
    respond(3, 'latest')
    await expect(Promise.all([blocker, latest])).resolves.toEqual([
      null,
      'latest',
    ])

    const window = dbDiagnosticRecorder.capture()
    const other = window?.operations.find((o) => o.kind === 'other')
    const timeline = window?.operations.find((o) => o.kind === 'timeline')
    expect(other).toMatchObject({ enqueued: 1, succeeded: 1 })
    expect(timeline).toMatchObject({
      cancelled: 1,
      enqueued: 2,
      succeeded: 1,
    })
  })

  it('キュー上限で追い出されたリクエストは cancelled として記録する', async () => {
    const { dbDiagnosticRecorder, respond, sendRequest } = await setup()
    const blocker = sendRequest({ id: 1, type: 'ready' }, 'other')
    const evicted = sendRequest(
      { id: 100, sql: 'SELECT evict-me', type: 'exec' },
      'timeline',
    )
    const rest = Array.from({ length: 20 }, (_, i) =>
      sendRequest(
        { id: 200 + i, sql: `SELECT keep-${i}`, type: 'exec' },
        'timeline',
      ),
    )

    await expect(evicted).resolves.toBeUndefined()
    respond(1, null)
    for (let i = 0; i < rest.length; i++) {
      respond(200 + i, null)
    }
    await Promise.all(rest)

    const window = dbDiagnosticRecorder.capture()
    const timeline = window?.operations.find((o) => o.kind === 'timeline')
    expect(timeline).toMatchObject({ cancelled: 1, enqueued: 21 })
    await blocker
  })

  it('タイムアウトは timedOut として記録し後続リクエストを進める', async () => {
    vi.useFakeTimers()
    try {
      const { dbDiagnosticRecorder, sendRequest, state } = await setup()
      const timedOut = sendRequest({ id: 1, sql: 'SELECT 1', type: 'exec' })
      const rejection = expect(timedOut).rejects.toThrowError(
        'Worker request timed out',
      )
      const following = sendRequest({ id: 2, type: 'ready' })

      await vi.advanceTimersByTimeAsync(31_000)
      await rejection

      const window = dbDiagnosticRecorder.capture()
      const op = window?.operations.find((o) => o.kind === 'other')
      expect(op).toMatchObject({ timedOut: 1, workerMeasured: 0 })
      expect(state.pending.has(2)).toBe(true)
      void following.catch(() => {})
    } finally {
      vi.useRealTimers()
    }
  })

  it('postMessage が同期失敗したら error として記録してキューを解放する', async () => {
    const { dbDiagnosticRecorder, sendRequest, worker } = await setup()
    worker.postMessage.mockImplementationOnce(() => {
      throw new Error('postMessage failed')
    })

    const failed = sendRequest({ id: 1, type: 'ready' }, 'other')
    const rejection = expect(failed).rejects.toThrowError('postMessage failed')
    const following = sendRequest({ id: 2, type: 'ready' }, 'other')

    await rejection
    expect(worker.postMessage).toHaveBeenCalledTimes(2)

    const window = dbDiagnosticRecorder.capture()
    const op = window?.operations.find((o) => o.kind === 'other')
    expect(op).toMatchObject({ enqueued: 2, failed: 1 })
    void following.catch(() => {})
  })

  it('終了時に active を error・待機を cancelled として清算する', async () => {
    const { dbDiagnosticRecorder, sendRequest } = await setup()
    const { terminateWorker } = await import('./publicApi')
    const active = sendRequest({ id: 1, type: 'ready' }, 'other')
    const queued = sendRequest({ id: 2, type: 'ready' }, 'other')
    const activeRejection =
      expect(active).rejects.toThrowError('Worker terminated')
    const queuedRejection =
      expect(queued).rejects.toThrowError('Worker terminated')

    terminateWorker()
    await Promise.all([activeRejection, queuedRejection])

    const window = dbDiagnosticRecorder.capture()
    const op = window?.operations.find((o) => o.kind === 'other')
    expect(op).toMatchObject({ cancelled: 1, enqueued: 2, failed: 1 })
    expect(window?.active).toBeNull()
  })

  it('終了時の清算はキューカウンタを二重減算しない', async () => {
    const { sendRequest } = await setup()
    const { terminateWorker } = await import('./publicApi')
    const {
      getCurrentQueueSizes,
      getSnapshots,
      startSnapshotRecording,
      stopSnapshotRecording,
    } = await import('../../dbQueue')

    const active = sendRequest({ id: 1, type: 'ready' }, 'other')
    const queued = sendRequest({ id: 2, type: 'ready' }, 'other')
    const activeRejection =
      expect(active).rejects.toThrowError('Worker terminated')
    const queuedRejection =
      expect(queued).rejects.toThrowError('Worker terminated')

    terminateWorker()
    await Promise.all([activeRejection, queuedRejection])

    expect(getCurrentQueueSizes()).toEqual({
      other: 0,
      priority: 0,
      timeline: 0,
    })
    startSnapshotRecording()
    const snapshot = getSnapshots().at(-1)
    stopSnapshotRecording()
    expect(snapshot?.otherProcessed).toBe(2)
  })

  it('start は実際にデキューされるまで記録しない', async () => {
    const { dbDiagnosticRecorder, respond, sendRequest } = await setup()
    const first = sendRequest({ id: 1, type: 'ready' }, 'other')
    const second = sendRequest({ id: 2, type: 'ready' }, 'other')

    respond(1, null)
    await first

    const window = dbDiagnosticRecorder.capture()
    const op = window?.operations.find((o) => o.kind === 'other')
    expect(op).toMatchObject({ enqueued: 2, started: 2, succeeded: 1 })
    respond(2, null)
    await second
  })
})
