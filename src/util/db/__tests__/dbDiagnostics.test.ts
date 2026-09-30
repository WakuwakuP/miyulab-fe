import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  analyzeDbDiagnosticWindows,
  DbDiagnosticRecorder,
} from '../dbDiagnostics'
import {
  type DbDiagnosticSaveResult,
  DbDiagnosticTransport,
} from '../dbDiagnosticTransport'
import {
  type DbDiagnosticWindow,
  sanitizeDbDiagnosticWindow,
} from '../dbDiagnosticTypes'
import {
  beginWorkerDiagnostics,
  finishWorkerDiagnostics,
} from '../sqlite/worker/workerDiagnostics'

const SESSION = '00000000-0000-4000-8000-000000000001'

function fixture() {
  let now = 0
  const recorder = new DbDiagnosticRecorder({
    date: () => Date.UTC(2026, 8, 30) + now,
    now: () => now,
  })
  return {
    at: (value: number) => {
      now = value
    },
    recorder,
  }
}

function sample(recorder: DbDiagnosticRecorder, id: number): void {
  recorder.recordEnqueue(
    id,
    {
      backendUrl: 'https://example.test',
      statusesJson: ['sensitive-body'],
      timelineType: 'home',
      type: 'bulkUpsertStatuses',
    },
    'other',
  )
  recorder.recordStart(id)
  recorder.recordEnd(id, 'success', {
    resultRows: 1,
    sqlCalls: 2,
    sqlTimeMs: 1,
    workerDurationMs: 3,
  })
}

describe('DB診断の計測契約', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => {
    f = fixture()
  })

  it('待機と処理を別々に計測した時、投入数・完了数と時間が正確であること', () => {
    f.recorder.setEnvironment('worker', 'opfs')
    f.recorder.recordIngress('statusIngress', 'https://example.test', 'home', 4)
    f.recorder.recordEnqueue(
      1,
      {
        backendUrl: 'https://example.test',
        statusesJson: ['a', 'b', 'c'],
        timelineType: 'home',
        type: 'bulkUpsertStatuses',
      },
      'other',
    )
    f.recorder.observeQueues({ other: 51, priority: 0, timeline: 2 })
    f.at(25)
    f.recorder.recordStart(1)
    f.at(65)
    f.recorder.recordEnd(1, 'success', {
      cacheHits: 1,
      cacheMisses: 2,
      resultRows: 3,
      sqlCalls: 2,
      sqlTimeMs: 20,
      workerDurationMs: 30,
    })
    f.recorder.observeQueues({ other: 1, priority: 0, timeline: 0 })
    f.at(100)

    const window = f.recorder.capture()

    expect(window).toMatchObject({
      active: null,
      execution: 'worker',
      intervalMs: 100,
      queue: { other: 1 },
      queueMax: { other: 51, timeline: 2 },
      storage: 'opfs',
    })
    expect(window?.operations.find((op) => op.kind === 'other')).toMatchObject({
      cacheHits: 1,
      cacheMisses: 2,
      enqueued: 1,
      queueWaitMaxMs: 25,
      queueWaitSumMs: 25,
      requestedItems: 3,
      resultRows: 3,
      serviceMaxMs: 40,
      serviceSumMs: 40,
      sqlCalls: 2,
      sqlTimeMs: 20,
      started: 1,
      succeeded: 1,
      workerMeasured: 1,
      workerSumMs: 30,
    })
    expect(
      window?.operations.find((op) => op.kind === 'input')?.receivedItems,
    ).toBe(4)
  })

  it('複数の計測窓を跨ぐ処理の時、継続中の処理と完了を二重計上しないこと', () => {
    f.recorder.recordEnqueue(1, { type: 'exportDatabase' }, 'other')
    f.at(10)
    f.recorder.recordStart(1)
    f.at(50)
    const first = f.recorder.capture() as DbDiagnosticWindow
    f.at(80)
    f.recorder.recordEnd(1, 'error')
    f.recorder.recordEnd(1, 'success')
    f.at(100)
    const second = f.recorder.capture() as DbDiagnosticWindow

    const analysis = analyzeDbDiagnosticWindows([second, first, first])

    expect(first.active).toMatchObject({
      elapsedMs: 40,
      requestType: 'exportDatabase',
    })
    expect(second.active).toBeNull()
    expect(analysis).toMatchObject({
      intervalMs: 100,
      missingSequences: 0,
      windows: 2,
    })
    expect(analysis.operations[0]).toMatchObject({
      enqueued: 1,
      failed: 1,
      queueWaitSumMs: 10,
      serviceSumMs: 70,
      started: 1,
      succeeded: 0,
    })
    expect(analysis.operationReports[0]).toMatchObject({
      arrivalPerSecond: 10,
      averageServiceMs: 70,
      averageWaitMs: 10,
      averageWorkerMs: null,
      completionPerSecond: 10,
    })
  })

  it('キャンセルとタイムアウトの時、正常完了や未計測Worker時間に数えないこと', () => {
    f.recorder.recordEnqueue(1, { type: 'executeGraphPlan' }, 'timeline')
    f.recorder.recordEnqueue(2, { type: 'bulkUpsertStatuses' }, 'other')
    f.recorder.recordStart(2)
    f.at(500)
    f.recorder.recordEnd(1, 'cancelled')
    f.recorder.recordEnd(2, 'timeout')

    const window = f.recorder.capture()

    expect(window?.active).toBeNull()
    expect(
      window?.operations.find((op) => op.kind === 'timeline'),
    ).toMatchObject({ cancelled: 1, started: 0, succeeded: 0 })
    expect(window?.operations.find((op) => op.kind === 'other')).toMatchObject({
      serviceSumMs: 0,
      timedOut: 1,
      workerMeasured: 0,
    })
  })

  it('診断入力に本文やトークンが含まれる時、許可した計測値だけを残すこと', () => {
    f.recorder.recordEnqueue(
      1,
      {
        backendUrl: 'https://private.example.test',
        bind: ['sensitive-body'],
        sql: "SELECT 'sensitive-token'",
        type: 'exec',
      },
      'other',
    )
    f.recorder.recordStart(1)
    f.recorder.recordEnd(1, 'success')
    const raw = {
      ...f.recorder.capture(),
      accessToken: 'sensitive-token',
      content: 'sensitive-body',
    }

    const sanitized = sanitizeDbDiagnosticWindow(raw)

    expect(sanitized?.operations[0]).toMatchObject({
      sourceId: 's1',
      sqlVerb: 'SELECT',
    })
    expect(JSON.stringify(sanitized)).not.toMatch(/sensitive|private\.example/)
    expect(
      sanitizeDbDiagnosticWindow({ ...raw, intervalMs: Number.NaN }),
    ).toBeNull()
    expect(
      sanitizeDbDiagnosticWindow({
        ...raw,
        operations: [{ ...raw.operations?.[0], succeeded: 0.5 }],
      }),
    ).toBeNull()
    expect(
      sanitizeDbDiagnosticWindow({
        ...raw,
        operations: [{ ...raw.operations?.[0], cleanupPostsDeleted: -1 }],
      }),
    ).toBeNull()
  })

  it.each(['recordDroppedWindow', 'recordTransportFailure'] as const)(
    '%s が一度増えた時、その後のアイドル窓を出し続けないこと',
    (method) => {
      f.recorder[method]()
      f.at(10_000)

      const first = f.recorder.capture() as DbDiagnosticWindow
      f.at(20_000)
      const idle = f.recorder.capture()
      f.recorder[method]()
      f.at(30_000)
      const second = f.recorder.capture() as DbDiagnosticWindow
      f.at(40_000)
      const nextIdle = f.recorder.capture()

      const field =
        method === 'recordDroppedWindow'
          ? 'droppedWindows'
          : 'transportFailures'
      expect(first[field]).toBe(1)
      expect(idle).toBeNull()
      expect(second[field]).toBe(2)
      expect(second.sequence).toBe(first.sequence + 1)
      expect(nextIdle).toBeNull()
      expect(analyzeDbDiagnosticWindows([first, second])[field]).toBe(2)
    },
  )

  it('イベント欠落を記録した時、累積値は維持しつつ後続のアイドル窓を止めること', () => {
    const overflow = () => {
      for (let i = 0; i < 129; i++) {
        f.recorder.recordIngress(
          'statusIngress',
          `https://source${i % 64}.test`,
          (['home', 'local', 'public'] as const)[Math.floor(i / 64)],
        )
      }
    }
    overflow()
    f.at(10_000)

    const first = f.recorder.capture() as DbDiagnosticWindow
    f.at(20_000)
    const idle = f.recorder.capture()
    overflow()
    f.at(30_000)
    const second = f.recorder.capture() as DbDiagnosticWindow
    f.at(40_000)
    const nextIdle = f.recorder.capture()

    expect(first.droppedEvents).toBe(1)
    expect(idle).toBeNull()
    expect(second.droppedEvents).toBe(2)
    expect(nextIdle).toBeNull()
    expect(analyzeDbDiagnosticWindows([first, second]).droppedEvents).toBe(2)
  })

  it('診断窓に欠落と累積損失がある時、欠落数と損失を二重加算しないこと', () => {
    sample(f.recorder, 1)
    f.at(100)
    const first = f.recorder.capture() as DbDiagnosticWindow
    f.recorder.recordDroppedWindow()
    f.recorder.recordTransportFailure()
    sample(f.recorder, 2)
    f.at(200)
    const second = f.recorder.capture() as DbDiagnosticWindow
    second.sequence = 3

    const analysis = analyzeDbDiagnosticWindows([first, second, second])

    expect(analysis).toMatchObject({
      droppedWindows: 1,
      intervalMs: 200,
      missingSequences: 1,
      transportFailures: 1,
      windows: 2,
    })
    expect(analysis.operations[0]).toMatchObject({
      sqlCalls: 4,
      succeeded: 2,
      workerMeasured: 2,
      workerSumMs: 6,
    })
  })
})

describe('DB診断の送信契約', () => {
  let f: ReturnType<typeof fixture>
  beforeEach(() => {
    f = fixture()
  })

  it('保存が一度失敗した時、同じ診断窓を再送して確認後にだけ除去すること', async () => {
    const batches: DbDiagnosticWindow[][] = []
    const transport = new DbDiagnosticTransport(
      f.recorder,
      async (_session, windows) => {
        batches.push(windows)
        return batches.length === 1
          ? { error: 'offline', success: false }
          : { accepted: windows.length, count: 0, success: true }
      },
      SESSION,
    )
    sample(f.recorder, 1)
    f.at(10)
    await transport.captureAndFlush()

    await transport.flush()

    expect(
      batches.map((batch) => batch.map((window) => window.sequence)),
    ).toEqual([[1], [1]])
    expect(transport.getStatus()).toMatchObject({
      lastError: null,
      pendingWindows: 0,
      savedWindows: 1,
      uploading: false,
    })
  })

  it('送信中も窓が増える時、送信中の窓を保持し待機バッファが20以内であること', async () => {
    let acknowledge: ((value: DbDiagnosticSaveResult) => void) | undefined
    const transport = new DbDiagnosticTransport(
      f.recorder,
      () =>
        new Promise((resolve) => {
          acknowledge = resolve
        }),
      SESSION,
    )
    sample(f.recorder, 1)
    f.at(10)
    const sending = transport.captureAndFlush()
    for (let id = 2; id <= 24; id++) {
      sample(f.recorder, id)
      f.at(id * 10)
      await transport.captureAndFlush()
    }
    expect(transport.getStatus().pendingWindows).toBe(20)

    acknowledge?.({ accepted: 1, count: 1, success: true })
    await sending

    expect(transport.getStatus()).toMatchObject({
      pendingWindows: 19,
      savedWindows: 1,
    })
    expect(f.recorder.capture()?.droppedWindows).toBe(4)
  })

  it('送信が応答しない時、30秒で待機を解き未保存の窓を維持すること', async () => {
    vi.useFakeTimers()
    onTestFinished(() => vi.useRealTimers())
    const transport = new DbDiagnosticTransport(
      f.recorder,
      () => new Promise(() => undefined),
      SESSION,
    )
    sample(f.recorder, 1)
    const sending = transport.captureAndFlush()

    await vi.advanceTimersByTimeAsync(30_001)
    await sending

    expect(transport.getStatus()).toMatchObject({
      lastError: 'Diagnostic upload timed out',
      pendingWindows: 1,
      savedWindows: 0,
      uploading: false,
    })
  })
})

describe('Worker診断のSQL計測契約', () => {
  it('実SQLiteを測定した時、成功と失敗したSQL本数・返却行数を正確に残すこと', () => {
    const native = new DatabaseSync(':memory:')
    onTestFinished(() => {
      finishWorkerDiagnostics(101)
      native.close()
    })
    native.exec(
      'CREATE TABLE items(id INTEGER); INSERT INTO items VALUES(1), (2);',
    )
    const db = {
      exec(sql: string, options?: { returnValue?: string }) {
        if (options?.returnValue === 'resultRows')
          return native.prepare(sql).all()
        return native.exec(sql)
      },
    }
    const measured = beginWorkerDiagnostics(101, db, ['source', 'lookup'])
    measured.exec('SELECT * FROM items', { returnValue: 'resultRows' })
    measured.exec('UPDATE items SET id = id + 1')
    expect(() => measured.exec('INVALID SQL')).toThrow()

    const metrics = finishWorkerDiagnostics(101, {
      deletedCounts: { notifications: 3, posts: 4, timeline_entries: 2 },
      meta: {
        nodeStats: {
          lookup: { cacheHit: false },
          output: { cacheHit: false },
          source: { cacheHit: true },
        },
      },
      phaseTimings: {
        notifications: 2,
        postsCount: 3,
        postsDelete: 4,
        timeline: 1,
        total: 11,
      },
    })

    expect(metrics).toMatchObject({
      cacheHits: 1,
      cacheMisses: 1,
      cleanupNotificationsDeleted: 3,
      cleanupNotificationsMs: 2,
      cleanupPostsCountMs: 3,
      cleanupPostsDeleted: 4,
      cleanupPostsDeleteMs: 4,
      cleanupTimelineDeleted: 2,
      cleanupTimelineMs: 1,
      cleanupTotalMs: 11,
      resultRows: 2,
      sqlCalls: 3,
    })
    expect(metrics?.sqlTimeMs).toBeGreaterThanOrEqual(0)
    expect(metrics?.workerDurationMs).toBeGreaterThanOrEqual(
      metrics?.sqlTimeMs ?? 0,
    )
    expect(finishWorkerDiagnostics(101)).toBeUndefined()
    expect(native.prepare('SELECT id FROM items ORDER BY id').all()).toEqual([
      { id: 2 },
      { id: 3 },
    ])
  })
})
