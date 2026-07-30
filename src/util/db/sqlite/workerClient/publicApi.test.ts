import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setQueuePriority, stopSnapshotRecording } from '../../dbQueue'
import type { FlatFetchRequest } from '../../query-ir/executor/flatFetchTypes'
import type {
  GraphExecuteOptions,
  SerializedGraphPlan,
} from '../../query-ir/executor/types'
import {
  clearIdCollectCache,
  getCachedIdCollect,
} from '../../query-ir/idCollectCache'
import type {
  FetchTimelineRequest,
  QueryPlanResult,
  SerializedExecutionPlan,
} from '../protocol'
import {
  execAsync,
  execAsyncTimed,
  execBatch,
  executeFlatFetch,
  executeGraphPlan,
  executeQueryPlan,
  fetchTimeline,
  initWorker,
  sendCommand,
  terminateWorker,
} from './publicApi'
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
  timelineDedup,
  timelineQueue,
} from './state'

class FakeBrowserWorker {
  static instances: FakeBrowserWorker[] = []

  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(
    readonly scriptUrl?: URL | string,
    readonly options?: WorkerOptions,
  ) {
    FakeBrowserWorker.instances.push(this)
  }
}

function resetPublicApiState(): void {
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
  setInitPromise(null)
  setInitResolve(null)
  setInitReject(null)
  setInitTimer(null)
  setNotifyChangeCallback(null)
  setSlowQueryLogCallback(null)
  clearIdCollectCache()
  stopSnapshotRecording()
  setQueuePriority('auto')
  FakeBrowserWorker.instances.length = 0
}

function connectFakeWorker(): FakeBrowserWorker {
  const worker = new FakeBrowserWorker()
  setWorker(worker as unknown as Worker)
  return worker
}

function lastPostedMessage(worker: FakeBrowserWorker): {
  id: number
  type: string
  [key: string]: unknown
} {
  const call = worker.postMessage.mock.calls.at(-1)
  if (!call) {
    throw new Error('Worker did not receive a message')
  }
  return call[0] as {
    id: number
    type: string
    [key: string]: unknown
  }
}

function resolveMessage(
  message: { id: number },
  result: unknown,
  durationMs?: number,
): void {
  if (durationMs != null) {
    durationForId.set(message.id, durationMs)
  }
  const request = pending.get(message.id)
  if (!request) {
    throw new Error(`No pending request for id=${message.id}`)
  }
  pending.delete(message.id)
  request.resolve(result)
}

const flatFetchRequest = {
  ids: [1, 2],
  target: 'posts',
} as unknown as FlatFetchRequest

const graphPlan = {
  nodes: [],
} as unknown as SerializedGraphPlan

const graphOptions = {
  limit: 40,
} as unknown as GraphExecuteOptions

const timelineRequest: Omit<FetchTimelineRequest, 'type' | 'id'> = {
  batchSqls: {
    belongingTags: 'SELECT belonging tags',
    customEmojis: 'SELECT custom emojis',
    interactions: 'SELECT interactions',
    media: 'SELECT media',
    mentions: 'SELECT mentions',
    polls: 'SELECT polls',
    profileEmojis: 'SELECT profile emojis',
    timelineTypes: 'SELECT timeline types',
  },
  phase1: {
    bind: ['https://example.test'],
    sql: 'SELECT id FROM posts WHERE backend_url = ?',
  },
  phase2BaseSql: 'SELECT * FROM posts WHERE id IN ({IDS})',
  reblogPostIdColumnIndex: 4,
}

describe('workerClient publicApi RPC', () => {
  beforeEach(() => {
    resetPublicApiState()
  })

  afterEach(() => {
    resetPublicApiState()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('execAsync と execBatch が採番済み payload と queue kind を送る', async () => {
    const worker = connectFakeWorker()

    const exec = execAsync('SELECT * FROM posts WHERE id = ?', {
      bind: [10],
      kind: 'timeline',
      returnValue: 'resultRows',
      sessionTag: 'home-tab',
    })
    const execMessage = lastPostedMessage(worker)
    expect(execMessage).toEqual({
      bind: [10],
      id: 0,
      returnValue: 'resultRows',
      sql: 'SELECT * FROM posts WHERE id = ?',
      type: 'exec',
    })
    expect(pending.get(execMessage.id)?.kind).toBe('timeline')
    resolveMessage(execMessage, [[10]])
    await expect(exec).resolves.toEqual([[10]])

    const defaultBatch = execBatch([{ sql: 'DELETE FROM posts' }])
    const defaultBatchMessage = lastPostedMessage(worker)
    expect(defaultBatchMessage).toEqual({
      id: 1,
      returnIndices: undefined,
      rollbackOnError: true,
      statements: [{ sql: 'DELETE FROM posts' }],
      type: 'execBatch',
    })
    expect(pending.get(defaultBatchMessage.id)?.kind).toBe('other')
    resolveMessage(defaultBatchMessage, {})
    await expect(defaultBatch).resolves.toEqual({})

    const configuredBatch = execBatch(
      [
        { bind: [1], sql: 'UPDATE posts SET hidden = ?' },
        { returnValue: 'resultRows', sql: 'SELECT changes()' },
      ],
      { returnIndices: [1], rollbackOnError: false },
    )
    const configuredBatchMessage = lastPostedMessage(worker)
    expect(configuredBatchMessage).toMatchObject({
      id: 2,
      returnIndices: [1],
      rollbackOnError: false,
      type: 'execBatch',
    })
    resolveMessage(configuredBatchMessage, { 1: [[1]] })
    await expect(configuredBatch).resolves.toEqual({ 1: [[1]] })
  })

  it('GraphPlan、FlatFetch、fetchTimeline を timeline RPC として送る', async () => {
    const worker = connectFakeWorker()

    const graph = executeGraphPlan(graphPlan, graphOptions, 'graph-session')
    const graphMessage = lastPostedMessage(worker)
    expect(graphMessage).toEqual({
      id: 0,
      options: graphOptions,
      plan: graphPlan,
      type: 'executeGraphPlan',
    })
    expect(pending.get(graphMessage.id)?.kind).toBe('timeline')
    resolveMessage(graphMessage, { output: [] })
    await expect(graph).resolves.toEqual({ output: [] })

    const flat = executeFlatFetch(flatFetchRequest, 'flat-session')
    const flatMessage = lastPostedMessage(worker)
    expect(flatMessage).toEqual({
      id: 1,
      request: flatFetchRequest,
      type: 'executeFlatFetch',
    })
    expect(pending.get(flatMessage.id)?.kind).toBe('timeline')
    resolveMessage(flatMessage, { rows: [] })
    await expect(flat).resolves.toEqual({ rows: [] })

    const timeline = fetchTimeline(timelineRequest, 'timeline-session')
    const timelineMessage = lastPostedMessage(worker)
    expect(timelineMessage).toEqual({
      ...timelineRequest,
      id: 2,
      type: 'fetchTimeline',
    })
    expect(pending.get(timelineMessage.id)?.kind).toBe('timeline')
    resolveMessage(timelineMessage, { phase1Rows: [] })
    await expect(timeline).resolves.toEqual({ phase1Rows: [] })
  })

  it('sendCommand は command を保持して既定 other または指定 priority に送る', async () => {
    const worker = connectFakeWorker()
    const command = {
      action: 'favourited' as const,
      backendUrl: 'https://example.test',
      statusId: 'status-1',
      type: 'updateStatusAction' as const,
      value: true,
    }

    const other = sendCommand(command)
    const otherMessage = lastPostedMessage(worker)
    expect(otherMessage).toEqual({ ...command, id: 0 })
    expect(pending.get(otherMessage.id)?.kind).toBe('other')
    resolveMessage(otherMessage, { ok: true })
    await expect(other).resolves.toEqual({ ok: true })

    const priority = sendCommand(command, { kind: 'priority' })
    const priorityMessage = lastPostedMessage(worker)
    expect(priorityMessage).toEqual({ ...command, id: 1 })
    expect(pending.get(priorityMessage.id)?.kind).toBe('priority')
    resolveMessage(priorityMessage, { ok: true })
    await expect(priority).resolves.toEqual({ ok: true })
  })

  it('execAsyncTimed は Worker duration を返して消費し、未通知時は 0 を返す', async () => {
    const worker = connectFakeWorker()

    const timed = execAsyncTimed('SELECT timed', {
      kind: 'timeline',
      sessionTag: 'timed-session',
    })
    const timedMessage = lastPostedMessage(worker)
    resolveMessage(timedMessage, ['row'], 8.25)
    await expect(timed).resolves.toEqual({
      durationMs: 8.25,
      result: ['row'],
    })
    expect(durationForId.has(timedMessage.id)).toBe(false)

    const withoutDuration = execAsyncTimed('SELECT without_duration')
    const withoutDurationMessage = lastPostedMessage(worker)
    resolveMessage(withoutDurationMessage, 'ok')
    await expect(withoutDuration).resolves.toEqual({
      durationMs: 0,
      result: 'ok',
    })
  })

  it('executeQueryPlan は実行結果をキャッシュし、次回 payload に precomputedResults を付与する', async () => {
    const worker = connectFakeWorker()
    const plan: SerializedExecutionPlan = {
      meta: { requiresReblogExpansion: false, sourceType: 'post' },
      steps: [
        {
          binds: ['https://cache.example'],
          source: 'worker_client_cache_posts',
          sql: 'SELECT id, created_at_ms FROM cache_posts WHERE backend = ?',
          type: 'id-collect',
        },
        {
          limit: 20,
          sourceStepIndices: [0],
          strategy: 'interleave-by-time',
          type: 'merge',
        },
      ],
    }
    const firstResult: QueryPlanResult = {
      capturedVersions: { worker_client_cache_posts: 3 },
      stepResults: [
        {
          rows: [{ createdAtMs: 1_000, id: 10 }],
          type: 'id-collect',
        },
        { mergedIds: [], type: 'merge' },
      ],
      totalDurationMs: 5,
    }

    const first = executeQueryPlan(plan, 'cache-session')
    const firstMessage = lastPostedMessage(worker)
    expect(firstMessage.plan).toBe(plan)
    resolveMessage(firstMessage, firstResult)
    await expect(first).resolves.toBe(firstResult)
    expect(
      getCachedIdCollect({
        binds: ['https://cache.example'],
        sql: 'SELECT id, created_at_ms FROM cache_posts WHERE backend = ?',
      }),
    ).toEqual([
      {
        createdAtMs: 1_000,
        id: 10,
        table: 'worker_client_cache_posts',
      },
    ])

    const secondResult: QueryPlanResult = {
      capturedVersions: { worker_client_cache_posts: 3 },
      stepResults: [
        {
          rows: [{ createdAtMs: 1_000, id: 10 }],
          type: 'id-collect',
        },
        { mergedIds: [], type: 'merge' },
      ],
      totalDurationMs: 1,
    }
    const second = executeQueryPlan(plan, 'cache-session')
    const secondMessage = lastPostedMessage(worker)
    expect(secondMessage.plan).toEqual({
      ...plan,
      precomputedResults: {
        0: {
          rows: [
            {
              createdAtMs: 1_000,
              id: 10,
              table: 'worker_client_cache_posts',
            },
          ],
          type: 'id-collect',
        },
      },
    })
    expect(plan.precomputedResults).toBeUndefined()
    resolveMessage(secondMessage, secondResult)
    await expect(second).resolves.toBe(secondResult)
  })

  it('capturedVersions がない executeQueryPlan 結果はキャッシュしない', async () => {
    const worker = connectFakeWorker()
    const plan: SerializedExecutionPlan = {
      meta: { requiresReblogExpansion: false, sourceType: 'post' },
      steps: [
        {
          binds: [],
          source: 'uncached_posts',
          sql: 'SELECT id, created_at_ms FROM uncached_posts',
          type: 'id-collect',
        },
      ],
    }
    const result: QueryPlanResult = {
      stepResults: [
        {
          rows: [{ createdAtMs: 500, id: 5 }],
          type: 'id-collect',
        },
      ],
      totalDurationMs: 2,
    }

    const execution = executeQueryPlan(plan)
    const message = lastPostedMessage(worker)
    resolveMessage(message, result)
    await execution

    expect(
      getCachedIdCollect({
        binds: [],
        sql: 'SELECT id, created_at_ms FROM uncached_posts',
      }),
    ).toBeNull()
  })

  it('id-collect の結果が欠けている場合は capturedVersions があってもキャッシュしない', async () => {
    const worker = connectFakeWorker()
    const plan: SerializedExecutionPlan = {
      meta: { requiresReblogExpansion: false, sourceType: 'post' },
      steps: [
        {
          binds: [],
          source: 'missing_result_posts',
          sql: 'SELECT id, created_at_ms FROM missing_result_posts',
          type: 'id-collect',
        },
      ],
    }
    const result: QueryPlanResult = {
      capturedVersions: { missing_result_posts: 1 },
      stepResults: [],
      totalDurationMs: 0,
    }

    const execution = executeQueryPlan(plan)
    const message = lastPostedMessage(worker)
    resolveMessage(message, result)
    await execution

    expect(
      getCachedIdCollect({
        binds: [],
        sql: 'SELECT id, created_at_ms FROM missing_result_posts',
      }),
    ).toBeNull()
  })

  it('initWorker は Worker を 1 回だけ生成し、origin を送って init 完了を共有する', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { origin: 'https://client.example' })
    vi.stubGlobal('Worker', FakeBrowserWorker)
    const notify = vi.fn()

    const first = initWorker(notify)
    const second = initWorker(vi.fn())
    const worker = FakeBrowserWorker.instances[0]

    expect(second).toBe(first)
    expect(FakeBrowserWorker.instances).toHaveLength(1)
    expect(worker.scriptUrl).toBeInstanceOf(URL)
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.postMessage).toHaveBeenCalledWith({
      origin: 'https://client.example',
      type: '__init',
    })
    expect(worker.onmessage).toBeTypeOf('function')
    expect(worker.onerror).toBeTypeOf('function')

    worker.onmessage?.({
      data: { persistence: 'opfs', type: 'init' },
    } as MessageEvent)

    await expect(first).resolves.toBe('opfs')
    expect(getInitTimer()).toBeNull()
    expect(getNotifyChangeCallback()).toBe(notify)
    terminateWorker()
  })

  it('initWorker は init メッセージが来なければ規定時間で reject する', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { origin: 'https://client.example' })
    vi.stubGlobal('Worker', FakeBrowserWorker)

    const initialization = initWorker(vi.fn())
    const rejection = expect(initialization).rejects.toThrowError(
      `Worker initialization timed out after ${INIT_TIMEOUT_MS}ms`,
    )

    await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS - 1)
    expect(getInitReject()).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(getInitReject()).toBeNull()
    expect(getInitResolve()).toBeNull()
    expect(getInitTimer()).toBeNull()
    terminateWorker()
  })

  it('Worker onerror は初期化を reject してタイマーを解除する', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { origin: 'https://client.example' })
    vi.stubGlobal('Worker', FakeBrowserWorker)
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const initialization = initWorker(vi.fn())
    const rejection = expect(initialization).rejects.toThrowError(
      'Worker initialization failed: load failed',
    )
    const worker = FakeBrowserWorker.instances[0]
    const errorEvent = { message: 'load failed' } as ErrorEvent
    worker.onerror?.(errorEvent)

    await rejection
    expect(consoleError).toHaveBeenCalledWith(
      'SQLite Worker error:',
      errorEvent,
    )
    expect(getInitReject()).toBeNull()
    expect(getInitResolve()).toBeNull()
    expect(getInitTimer()).toBeNull()

    worker.onerror?.({ message: 'late error' } as ErrorEvent)
    expect(consoleError).toHaveBeenCalledTimes(2)
    terminateWorker()
  })

  it('初期化タイマーが既に解除済みでも Worker onerror を処理できる', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { origin: 'https://client.example' })
    vi.stubGlobal('Worker', FakeBrowserWorker)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const initialization = initWorker(vi.fn())
    const rejection = expect(initialization).rejects.toThrowError(
      'Worker initialization failed: load failed',
    )
    const initTimer = getInitTimer()
    if (initTimer != null) {
      clearTimeout(initTimer)
    }
    setInitTimer(null)

    FakeBrowserWorker.instances[0].onerror?.({
      message: 'load failed',
    } as ErrorEvent)

    await rejection
    expect(getInitTimer()).toBeNull()
    terminateWorker()
  })

  it.each([
    ['Error', new Error('constructor failed'), 'constructor failed'],
    ['非 Error', 'string failure', 'string failure'],
  ])(
    'Worker constructor が %s を throw した場合も Error として reject する',
    async (_, thrown, expectedMessage) => {
      vi.useFakeTimers()
      vi.stubGlobal('location', { origin: 'https://client.example' })
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw thrown
          }
        },
      )

      await expect(initWorker(vi.fn())).rejects.toThrowError(expectedMessage)
    },
  )

  it('terminateWorker は Worker、in-flight、全キュー、共有 callback と採番をリセットする', async () => {
    const worker = connectFakeWorker()
    const active = execAsync('SELECT active')
    const queuedOther = execAsync('SELECT queued')
    const queuedPriority = sendCommand(
      {
        backendUrl: 'https://example.test',
        mode: 'emergency',
        type: 'enforceMaxLength',
      },
      { kind: 'priority' },
    )
    const queuedTimeline = executeFlatFetch(flatFetchRequest, 'terminate-test')
    const allSettled = Promise.allSettled([
      active,
      queuedOther,
      queuedPriority,
      queuedTimeline,
    ])
    setInitPromise(Promise.resolve('memory'))
    setInitResolve(vi.fn())
    setInitReject(vi.fn())
    setNotifyChangeCallback(vi.fn())
    setSlowQueryLogCallback(vi.fn())
    setConsecutiveOther(7)

    terminateWorker()

    const results = await allSettled
    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect(result.reason).toEqual(new Error('Worker terminated'))
      }
    }
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(getWorker()).toBeNull()
    expect(pending.size).toBe(0)
    expect(priorityQueue).toHaveLength(0)
    expect(otherQueue).toHaveLength(0)
    expect(timelineQueue).toHaveLength(0)
    expect(timelineDedup.size).toBe(0)
    expect(getActiveRequest()).toBe(false)
    expect(getConsecutiveOther()).toBe(0)
    expect(getInitPromise()).toBeNull()
    expect(getInitResolve()).toBeNull()
    expect(getInitReject()).toBeNull()
    expect(getNotifyChangeCallback()).toBeNull()
    expect(getSlowQueryLogCallback()).toBeNull()
    expect(incrementNextId()).toBe(0)

    terminateWorker()
  })
})
