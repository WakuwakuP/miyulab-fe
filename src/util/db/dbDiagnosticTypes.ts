export const DB_DIAGNOSTIC_VERSION = 1
export const DB_DIAGNOSTIC_WINDOW_MS = 10_000
export const DB_DIAGNOSTIC_MAX_WINDOWS = 20
export const DB_DIAGNOSTIC_BATCH_SIZE = 4
export const DB_DIAGNOSTIC_MAX_OPERATIONS = 128
export const DB_DIAGNOSTIC_MAX_SOURCES = 64
export const DB_DIAGNOSTIC_MAX_PENDING = 10_000
export const DB_DIAGNOSTIC_MAX_BYTES = 128_000

export const DB_DIAGNOSTIC_REQUEST_TYPES = [
  'exec',
  'execBatch',
  'ready',
  'upsertStatus',
  'bulkUpsertStatuses',
  'updateStatusAction',
  'updateStatus',
  'handleDeleteEvent',
  'removeFromTimeline',
  'addNotification',
  'bulkAddNotifications',
  'updateNotificationStatusAction',
  'enforceMaxLength',
  'syncFollows',
  'exportDatabase',
  'ensureLocalAccount',
  'toggleReaction',
  'bulkUpsertCustomEmojis',
  'fetchTimeline',
  'executeQueryPlan',
  'executeGraphPlan',
  'executeFlatFetch',
  'statusIngress',
  'notificationIngress',
  'unknown',
] as const

export type DbDiagnosticRequestType =
  (typeof DB_DIAGNOSTIC_REQUEST_TYPES)[number]
export type DbDiagnosticKind = 'priority' | 'other' | 'timeline' | 'input'
export type DbDiagnosticTimeline =
  | 'home'
  | 'local'
  | 'public'
  | 'tag'
  | 'notification'
  | 'none'
export type DbDiagnosticVerb =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'PRAGMA'
  | 'OTHER'
export type DbDiagnosticOutcome = 'success' | 'error' | 'timeout' | 'cancelled'
export type DbDiagnosticQueues = {
  priority: number
  other: number
  timeline: number
}
export type DbWorkerRequestMetrics = {
  workerDurationMs: number
  sqlCalls: number
  sqlTimeMs: number
  resultRows: number
  cacheHits?: number
  cacheMisses?: number
  cleanupTimelineDeleted?: number
  cleanupNotificationsDeleted?: number
  cleanupPostsDeleted?: number
  cleanupTimelineMs?: number
  cleanupNotificationsMs?: number
  cleanupPostsCountMs?: number
  cleanupPostsDeleteMs?: number
  cleanupTotalMs?: number
}
export type DbDiagnosticOperation = {
  kind: DbDiagnosticKind
  requestType: DbDiagnosticRequestType
  sourceId: string
  timelineType: DbDiagnosticTimeline
  sqlVerb: DbDiagnosticVerb
  receivedItems: number
  enqueued: number
  requestedItems: number
  started: number
  succeeded: number
  failed: number
  timedOut: number
  cancelled: number
  queueWaitSumMs: number
  queueWaitMaxMs: number
  serviceSumMs: number
  serviceMaxMs: number
  workerMeasured: number
  workerSumMs: number
  workerMaxMs: number
  sqlCalls: number
  sqlTimeMs: number
  resultRows: number
  cacheHits?: number
  cacheMisses?: number
  cleanupTimelineDeleted?: number
  cleanupNotificationsDeleted?: number
  cleanupPostsDeleted?: number
  cleanupTimelineMs?: number
  cleanupNotificationsMs?: number
  cleanupPostsCountMs?: number
  cleanupPostsDeleteMs?: number
  cleanupTotalMs?: number
}
export type DbDiagnosticActive = Pick<
  DbDiagnosticOperation,
  'kind' | 'requestType' | 'sourceId' | 'timelineType' | 'sqlVerb'
> & {
  elapsedMs: number
}
export type DbDiagnosticWindow = {
  version: 1
  sequence: number
  capturedAt: string
  intervalMs: number
  execution: 'worker' | 'main-thread' | 'unknown'
  storage: 'opfs' | 'memory' | 'unknown'
  queue: DbDiagnosticQueues
  queueMax: DbDiagnosticQueues
  active: DbDiagnosticActive | null
  operations: DbDiagnosticOperation[]
  droppedEvents: number
  droppedWindows: number
  transportFailures: number
}

export const DB_DIAGNOSTIC_DETAIL_FIELDS = [
  'cacheHits',
  'cacheMisses',
  'cleanupTimelineDeleted',
  'cleanupNotificationsDeleted',
  'cleanupPostsDeleted',
  'cleanupTimelineMs',
  'cleanupNotificationsMs',
  'cleanupPostsCountMs',
  'cleanupPostsDeleteMs',
  'cleanupTotalMs',
] as const

const OPERATION_NUMBERS = [
  'receivedItems',
  'enqueued',
  'requestedItems',
  'started',
  'succeeded',
  'failed',
  'timedOut',
  'cancelled',
  'queueWaitSumMs',
  'queueWaitMaxMs',
  'serviceSumMs',
  'serviceMaxMs',
  'workerMeasured',
  'workerSumMs',
  'workerMaxMs',
  'sqlCalls',
  'sqlTimeMs',
  'resultRows',
] as const
const KINDS = ['priority', 'other', 'timeline', 'input'] as const
const TIMELINES = [
  'home',
  'local',
  'public',
  'tag',
  'notification',
  'none',
] as const
const VERBS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'PRAGMA',
  'OTHER',
] as const

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
function number(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000_000
  )
}
function integer(value: unknown): value is number {
  return number(value) && Number.isSafeInteger(value)
}
function choice<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === 'string' && values.includes(value as T)
}
function queues(value: unknown): DbDiagnosticQueues | null {
  const v = object(value)
  if (!v || !integer(v.priority) || !integer(v.other) || !integer(v.timeline))
    return null
  return { other: v.other, priority: v.priority, timeline: v.timeline }
}
function metadata(
  value: unknown,
): Pick<
  DbDiagnosticOperation,
  'kind' | 'requestType' | 'sourceId' | 'timelineType' | 'sqlVerb'
> | null {
  const v = object(value)
  if (
    !v ||
    !choice(v.kind, KINDS) ||
    !choice(v.requestType, DB_DIAGNOSTIC_REQUEST_TYPES) ||
    typeof v.sourceId !== 'string' ||
    !/^s(?:[0-9]{1,2}|overflow|none)$/.test(v.sourceId) ||
    !choice(v.timelineType, TIMELINES) ||
    !choice(v.sqlVerb, VERBS)
  )
    return null
  return {
    kind: v.kind,
    requestType: v.requestType,
    sourceId: v.sourceId,
    sqlVerb: v.sqlVerb,
    timelineType: v.timelineType,
  }
}

export function isDbDiagnosticSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}
export function dbDiagnosticMarker(sessionId: string): string {
  return `DB_DIAGNOSTICS_V1:${sessionId.toLowerCase()}`
}
export function sanitizeDbDiagnosticWindow(
  value: unknown,
): DbDiagnosticWindow | null {
  const v = object(value)
  if (
    v?.version !== 1 ||
    !integer(v.sequence) ||
    typeof v.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(v.capturedAt)) ||
    !number(v.intervalMs) ||
    v.intervalMs === 0 ||
    !choice(v.execution, ['worker', 'main-thread', 'unknown']) ||
    !choice(v.storage, ['opfs', 'memory', 'unknown']) ||
    !integer(v.droppedEvents) ||
    !integer(v.droppedWindows) ||
    !integer(v.transportFailures) ||
    !Array.isArray(v.operations) ||
    v.operations.length > DB_DIAGNOSTIC_MAX_OPERATIONS
  )
    return null
  const queue = queues(v.queue)
  const queueMax = queues(v.queueMax)
  if (!queue || !queueMax) return null
  const operations: DbDiagnosticOperation[] = []
  for (const raw of v.operations) {
    const entry = object(raw)
    const meta = metadata(raw)
    if (!entry || !meta) return null
    const values: Record<string, number> = {}
    for (const key of OPERATION_NUMBERS) {
      if (!number(entry[key])) return null
      values[key] = entry[key]
    }
    for (const key of [
      'receivedItems',
      'enqueued',
      'requestedItems',
      'started',
      'succeeded',
      'failed',
      'timedOut',
      'cancelled',
      'workerMeasured',
      'sqlCalls',
      'resultRows',
    ] as const) {
      if (!integer(values[key])) return null
    }
    for (const key of DB_DIAGNOSTIC_DETAIL_FIELDS) {
      const value = entry[key]
      if (value === undefined) continue
      if (!number(value)) return null
      if (
        (key.endsWith('Deleted') ||
          key === 'cacheHits' ||
          key === 'cacheMisses') &&
        !integer(value)
      )
        return null
      values[key] = value
    }
    operations.push({ ...meta, ...values } as DbDiagnosticOperation)
  }
  let active: DbDiagnosticActive | null = null
  if (v.active !== null) {
    const meta = metadata(v.active)
    const raw = object(v.active)
    if (!meta || !raw || !number(raw.elapsedMs)) return null
    active = { ...meta, elapsedMs: raw.elapsedMs }
  }
  const sanitized: DbDiagnosticWindow = {
    active,
    capturedAt: new Date(v.capturedAt).toISOString(),
    droppedEvents: v.droppedEvents,
    droppedWindows: v.droppedWindows,
    execution: v.execution,
    intervalMs: v.intervalMs,
    operations,
    queue,
    queueMax,
    sequence: v.sequence,
    storage: v.storage,
    transportFailures: v.transportFailures,
    version: 1,
  }
  return JSON.stringify(sanitized).length <= DB_DIAGNOSTIC_MAX_BYTES
    ? sanitized
    : null
}
