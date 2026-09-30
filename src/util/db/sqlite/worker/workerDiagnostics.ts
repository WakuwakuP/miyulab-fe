import type { DbWorkerRequestMetrics } from '../../dbDiagnosticTypes'

type MetricState = {
  startedAt: number
  sqlCalls: number
  sqlTimeMs: number
  resultRows: number
  cacheNodeIds: string[]
}
const requests = new Map<number, MetricState>()
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
const numeric = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

export function beginWorkerDiagnostics<T extends object>(
  id: number,
  db: T,
  cacheNodeIds: string[] = [],
): T {
  const state: MetricState = {
    cacheNodeIds,
    resultRows: 0,
    sqlCalls: 0,
    sqlTimeMs: 0,
    startedAt: performance.now(),
  }
  requests.set(id, state)
  return new Proxy(db, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (property !== 'exec' || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args: unknown[]) => {
        const startedAt = performance.now()
        state.sqlCalls++
        try {
          const result: unknown = Reflect.apply(value, target, args)
          const options = args[1]
          if (
            Array.isArray(result) &&
            options &&
            typeof options === 'object' &&
            'returnValue' in options &&
            options.returnValue === 'resultRows'
          ) {
            state.resultRows += result.length
          }
          return result
        } finally {
          state.sqlTimeMs += performance.now() - startedAt
        }
      }
    },
  })
}

export function finishWorkerDiagnostics(
  id: number,
  result?: unknown,
): DbWorkerRequestMetrics | undefined {
  const state = requests.get(id)
  if (!state) return undefined
  requests.delete(id)
  const payload = object(result)
  const stats = object(object(payload.meta).nodeStats)
  let cacheHits = 0
  let cacheMisses = 0
  for (const nodeId of state.cacheNodeIds) {
    const stat = object(stats[nodeId])
    if (stat.cacheHit === true) cacheHits++
    else if (stat.cacheHit === false) cacheMisses++
  }
  const deleted = object(payload.deletedCounts)
  const phases = object(payload.phaseTimings)
  return {
    cacheHits,
    cacheMisses,
    cleanupNotificationsDeleted: numeric(deleted.notifications),
    cleanupNotificationsMs: numeric(phases.notifications),
    cleanupPostsCountMs: numeric(phases.postsCount),
    cleanupPostsDeleted: numeric(deleted.posts),
    cleanupPostsDeleteMs: numeric(phases.postsDelete),
    cleanupTimelineDeleted: numeric(deleted.timeline_entries),
    cleanupTimelineMs: numeric(phases.timeline),
    cleanupTotalMs: numeric(phases.total),
    resultRows: state.resultRows,
    sqlCalls: state.sqlCalls,
    sqlTimeMs: state.sqlTimeMs,
    workerDurationMs: performance.now() - state.startedAt,
  }
}
