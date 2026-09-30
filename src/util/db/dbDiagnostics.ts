import {
  DB_DIAGNOSTIC_DETAIL_FIELDS,
  DB_DIAGNOSTIC_MAX_OPERATIONS,
  DB_DIAGNOSTIC_MAX_PENDING,
  DB_DIAGNOSTIC_MAX_SOURCES,
  DB_DIAGNOSTIC_REQUEST_TYPES,
  type DbDiagnosticActive,
  type DbDiagnosticKind,
  type DbDiagnosticOperation,
  type DbDiagnosticOutcome,
  type DbDiagnosticQueues,
  type DbDiagnosticRequestType,
  type DbDiagnosticTimeline,
  type DbDiagnosticVerb,
  type DbDiagnosticWindow,
  type DbWorkerRequestMetrics,
} from './dbDiagnosticTypes'

type Metadata = Pick<
  DbDiagnosticOperation,
  'kind' | 'requestType' | 'sourceId' | 'timelineType' | 'sqlVerb'
>
type Pending = { metadata: Metadata; enqueuedAt: number; startedAt?: number }
type Clock = { now: () => number; date: () => number }
const emptyQueues = (): DbDiagnosticQueues => ({
  other: 0,
  priority: 0,
  timeline: 0,
})

function emptyOperation(metadata: Metadata): DbDiagnosticOperation {
  return {
    ...metadata,
    cacheHits: 0,
    cacheMisses: 0,
    cancelled: 0,
    cleanupNotificationsDeleted: 0,
    cleanupNotificationsMs: 0,
    cleanupPostsCountMs: 0,
    cleanupPostsDeleted: 0,
    cleanupPostsDeleteMs: 0,
    cleanupTimelineDeleted: 0,
    cleanupTimelineMs: 0,
    cleanupTotalMs: 0,
    enqueued: 0,
    failed: 0,
    queueWaitMaxMs: 0,
    queueWaitSumMs: 0,
    receivedItems: 0,
    requestedItems: 0,
    resultRows: 0,
    serviceMaxMs: 0,
    serviceSumMs: 0,
    sqlCalls: 0,
    sqlTimeMs: 0,
    started: 0,
    succeeded: 0,
    timedOut: 0,
    workerMaxMs: 0,
    workerMeasured: 0,
    workerSumMs: 0,
  }
}
function itemCount(message: Record<string, unknown>): number {
  for (const key of [
    'statusesJson',
    'notificationsJson',
    'accountsJson',
    'statements',
  ]) {
    if (Array.isArray(message[key])) return message[key].length
  }
  return [
    'upsertStatus',
    'updateStatus',
    'addNotification',
    'updateStatusAction',
    'toggleReaction',
    'updateNotificationStatusAction',
  ].includes(String(message.type))
    ? 1
    : 0
}

export class DbDiagnosticRecorder {
  private readonly operations = new Map<string, DbDiagnosticOperation>()
  private readonly pending = new Map<number, Pending>()
  private readonly sources = new Map<string, string>()
  private queue = emptyQueues()
  private queueMax = emptyQueues()
  private sequence = 0
  private windowStartedAt: number
  private droppedEvents = 0
  private droppedWindows = 0
  private transportFailures = 0
  private capturedLosses = {
    droppedEvents: 0,
    droppedWindows: 0,
    transportFailures: 0,
  }
  private execution: DbDiagnosticWindow['execution'] = 'unknown'
  private storage: DbDiagnosticWindow['storage'] = 'unknown'

  constructor(
    private readonly clock: Clock = {
      date: () => Date.now(),
      now: () => performance.now(),
    },
  ) {
    this.windowStartedAt = clock.now()
  }

  setEnvironment(
    execution: DbDiagnosticWindow['execution'],
    storage: DbDiagnosticWindow['storage'],
  ): void {
    this.execution = execution
    this.storage = storage
  }

  private sourceId(backendUrl: unknown): string {
    if (typeof backendUrl !== 'string' || !backendUrl) return 'snone'
    const cached = this.sources.get(backendUrl)
    if (cached) return cached
    if (this.sources.size >= DB_DIAGNOSTIC_MAX_SOURCES) return 'soverflow'
    const id = `s${this.sources.size + 1}`
    this.sources.set(backendUrl, id)
    return id
  }

  private metadata(
    message: Record<string, unknown>,
    kind: DbDiagnosticKind,
  ): Metadata {
    const type = DB_DIAGNOSTIC_REQUEST_TYPES.includes(
      message.type as DbDiagnosticRequestType,
    )
      ? (message.type as DbDiagnosticRequestType)
      : 'unknown'
    const timeline = [
      'home',
      'local',
      'public',
      'tag',
      'notification',
    ].includes(String(message.timelineType))
      ? (message.timelineType as DbDiagnosticTimeline)
      : 'none'
    const verb =
      typeof message.sql === 'string'
        ? message.sql.trimStart().match(/^\w+/)?.[0].toUpperCase()
        : undefined
    const sqlVerb = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'PRAGMA'].includes(
      verb ?? '',
    )
      ? (verb as DbDiagnosticVerb)
      : 'OTHER'
    return {
      kind,
      requestType: type,
      sourceId: this.sourceId(message.backendUrl),
      sqlVerb,
      timelineType: timeline,
    }
  }

  private operation(metadata: Metadata): DbDiagnosticOperation | null {
    const key = [
      metadata.kind,
      metadata.requestType,
      metadata.sourceId,
      metadata.timelineType,
      metadata.sqlVerb,
    ].join(':')
    const existing = this.operations.get(key)
    if (existing) return existing
    if (this.operations.size >= DB_DIAGNOSTIC_MAX_OPERATIONS) {
      this.droppedEvents++
      return null
    }
    const created = emptyOperation(metadata)
    this.operations.set(key, created)
    return created
  }

  observeQueues(queue: DbDiagnosticQueues): void {
    this.queue = { ...queue }
    for (const kind of ['priority', 'other', 'timeline'] as const) {
      this.queueMax[kind] = Math.max(this.queueMax[kind], queue[kind])
    }
  }

  recordIngress(
    type: 'statusIngress' | 'notificationIngress',
    backendUrl: string,
    timelineType: DbDiagnosticTimeline,
    count = 1,
  ): void {
    const entry = this.operation(
      this.metadata({ backendUrl, timelineType, type }, 'input'),
    )
    if (entry) entry.receivedItems += count
  }

  recordEnqueue(
    id: number,
    message: Record<string, unknown>,
    kind: Exclude<DbDiagnosticKind, 'input'>,
  ): void {
    const metadata = this.metadata(message, kind)
    const entry = this.operation(metadata)
    if (entry) {
      entry.enqueued++
      entry.requestedItems += itemCount(message)
    }
    if (this.pending.size >= DB_DIAGNOSTIC_MAX_PENDING) {
      this.droppedEvents++
      return
    }
    this.pending.set(id, { enqueuedAt: this.clock.now(), metadata })
  }

  recordStart(id: number): void {
    const request = this.pending.get(id)
    if (!request || request.startedAt !== undefined) return
    request.startedAt = this.clock.now()
    const entry = this.operation(request.metadata)
    if (!entry) return
    const wait = Math.max(0, request.startedAt - request.enqueuedAt)
    entry.started++
    entry.queueWaitSumMs += wait
    entry.queueWaitMaxMs = Math.max(entry.queueWaitMaxMs, wait)
  }

  recordEnd(
    id: number,
    outcome: DbDiagnosticOutcome,
    metrics?: DbWorkerRequestMetrics,
  ): void {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    const entry = this.operation(request.metadata)
    if (!entry) return
    if (outcome === 'cancelled') entry.cancelled++
    else if (outcome === 'timeout') entry.timedOut++
    else {
      if (outcome === 'success') entry.succeeded++
      else entry.failed++
      if (request.startedAt !== undefined) {
        const service = Math.max(0, this.clock.now() - request.startedAt)
        entry.serviceSumMs += service
        entry.serviceMaxMs = Math.max(entry.serviceMaxMs, service)
      }
    }
    if (metrics && outcome !== 'cancelled' && outcome !== 'timeout') {
      entry.workerMeasured++
      entry.workerSumMs += metrics.workerDurationMs
      entry.workerMaxMs = Math.max(entry.workerMaxMs, metrics.workerDurationMs)
      entry.sqlCalls += metrics.sqlCalls
      entry.sqlTimeMs += metrics.sqlTimeMs
      entry.resultRows += metrics.resultRows
      for (const field of DB_DIAGNOSTIC_DETAIL_FIELDS)
        entry[field] = (entry[field] ?? 0) + (metrics[field] ?? 0)
    }
  }

  recordTransportFailure(): void {
    this.transportFailures++
  }
  recordDroppedWindow(): void {
    this.droppedWindows++
  }

  capture(): DbDiagnosticWindow | null {
    const now = this.clock.now()
    let active: DbDiagnosticActive | null = null
    for (const request of this.pending.values()) {
      if (request.startedAt === undefined) continue
      const elapsedMs = Math.max(0, now - request.startedAt)
      if (!active || elapsedMs > active.elapsedMs)
        active = { ...request.metadata, elapsedMs }
    }
    const intervalMs = Math.max(1, now - this.windowStartedAt)
    this.windowStartedAt = now
    const operations = [...this.operations.values()].map((entry) => ({
      ...entry,
    }))
    this.operations.clear()
    const queueMax = this.queueMax
    this.queueMax = { ...this.queue }
    const losses = {
      droppedEvents: this.droppedEvents,
      droppedWindows: this.droppedWindows,
      transportFailures: this.transportFailures,
    }
    const lossesChanged = (
      ['droppedEvents', 'droppedWindows', 'transportFailures'] as const
    ).some((field) => losses[field] !== this.capturedLosses[field])
    if (!operations.length && !active && !this.pending.size && !lossesChanged)
      return null
    this.capturedLosses = losses
    return {
      active,
      capturedAt: new Date(this.clock.date()).toISOString(),
      droppedEvents: losses.droppedEvents,
      droppedWindows: losses.droppedWindows,
      execution: this.execution,
      intervalMs,
      operations,
      queue: { ...this.queue },
      queueMax,
      sequence: ++this.sequence,
      storage: this.storage,
      transportFailures: losses.transportFailures,
      version: 1,
    }
  }
}

export const dbDiagnosticRecorder = new DbDiagnosticRecorder()
let sessionId: string | null = null
export function getDbDiagnosticSessionId(): string {
  sessionId ??= globalThis.crypto.randomUUID()
  return sessionId
}

export type DbDiagnosticOperationReport = {
  operation: DbDiagnosticOperation
  arrivalPerSecond: number
  completionPerSecond: number
  averageWaitMs: number | null
  averageServiceMs: number | null
  averageWorkerMs: number | null
}

export type DbDiagnosticAnalysis = {
  windows: number
  intervalMs: number
  operations: DbDiagnosticOperation[]
  operationReports: DbDiagnosticOperationReport[]
  maxQueue: DbDiagnosticQueues
  missingSequences: number
  droppedEvents: number
  droppedWindows: number
  transportFailures: number
}

export function analyzeDbDiagnosticWindows(
  windows: readonly DbDiagnosticWindow[],
): DbDiagnosticAnalysis {
  const ordered = [
    ...new Map(windows.map((window) => [window.sequence, window])).values(),
  ].sort((a, b) => a.sequence - b.sequence)
  const operations = new Map<string, DbDiagnosticOperation>()
  const result: DbDiagnosticAnalysis = {
    droppedEvents: 0,
    droppedWindows: 0,
    intervalMs: 0,
    maxQueue: emptyQueues(),
    missingSequences: 0,
    operationReports: [],
    operations: [],
    transportFailures: 0,
    windows: ordered.length,
  }
  let previous: number | undefined
  for (const window of ordered) {
    result.intervalMs += window.intervalMs
    if (previous !== undefined)
      result.missingSequences += Math.max(0, window.sequence - previous - 1)
    previous = window.sequence
    for (const kind of ['priority', 'other', 'timeline'] as const)
      result.maxQueue[kind] = Math.max(
        result.maxQueue[kind],
        window.queueMax[kind],
      )
    result.droppedEvents = Math.max(result.droppedEvents, window.droppedEvents)
    result.droppedWindows = Math.max(
      result.droppedWindows,
      window.droppedWindows,
    )
    result.transportFailures = Math.max(
      result.transportFailures,
      window.transportFailures,
    )
    for (const entry of window.operations) {
      const key = [
        entry.kind,
        entry.requestType,
        entry.sourceId,
        entry.timelineType,
        entry.sqlVerb,
      ].join(':')
      const total = operations.get(key) ?? emptyOperation(entry)
      for (const field of [
        'receivedItems',
        'enqueued',
        'requestedItems',
        'started',
        'succeeded',
        'failed',
        'timedOut',
        'cancelled',
        'queueWaitSumMs',
        'serviceSumMs',
        'workerMeasured',
        'workerSumMs',
        'sqlCalls',
        'sqlTimeMs',
        'resultRows',
      ] as const)
        total[field] += entry[field]
      for (const field of [
        'queueWaitMaxMs',
        'serviceMaxMs',
        'workerMaxMs',
      ] as const)
        total[field] = Math.max(total[field], entry[field])
      for (const field of DB_DIAGNOSTIC_DETAIL_FIELDS)
        total[field] = (total[field] ?? 0) + (entry[field] ?? 0)
      operations.set(key, total)
    }
  }
  result.operations = [...operations.values()].sort(
    (a, b) => b.serviceSumMs - a.serviceSumMs,
  )
  const seconds = result.intervalMs / 1_000
  result.operationReports = result.operations.map((operation) => ({
    arrivalPerSecond: seconds > 0 ? operation.enqueued / seconds : 0,
    averageServiceMs:
      operation.succeeded + operation.failed > 0
        ? operation.serviceSumMs / (operation.succeeded + operation.failed)
        : null,
    averageWaitMs:
      operation.started > 0
        ? operation.queueWaitSumMs / operation.started
        : null,
    averageWorkerMs:
      operation.workerMeasured > 0
        ? operation.workerSumMs / operation.workerMeasured
        : null,
    completionPerSecond:
      seconds > 0 ? (operation.succeeded + operation.failed) / seconds : 0,
    operation,
  }))
  return result
}
