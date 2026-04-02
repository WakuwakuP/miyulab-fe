// ============================================================
// Query IR — Execution Engine (runs inside Worker)
// ============================================================

import type {
  BatchEnrichResult,
  DetailFetchResult,
  IdCollectResult,
  MergeResult,
  QueryPlanResult,
  SerializedExecutionPlan,
  SerializedStep,
  StepResult,
} from '../protocol'

/**
 * Minimal db interface for step execution.
 * In the Worker, this is the sqlite-wasm OO1 db object.
 */
export type DbExec = {
  exec: (
    sql: string,
    opts: { bind?: (string | number | null)[]; returnValue: 'resultRows' },
  ) => (string | number | null)[][]
}

/** Mutable context passed between steps */
export type ExecutionContext = {
  /** stepIndex → collected row IDs */
  collectedIds: Map<number, number[]>
  /** Merged IDs from MergeStep */
  mergedIds: { id: number; type: string; createdAtMs: number }[]
  /** All post IDs (including reblogs) for detail-fetch and batch-enrich */
  allPostIds: number[]
  /** All notification IDs for detail-fetch */
  allNotifIds: number[]
}

function createContext(): ExecutionContext {
  return {
    allNotifIds: [],
    allPostIds: [],
    collectedIds: new Map(),
    mergedIds: [],
  }
}

// --------------- Step executors ---------------

function executeIdCollect(
  db: DbExec,
  step: Extract<SerializedStep, { type: 'id-collect' }>,
): IdCollectResult {
  const rawRows = db.exec(step.sql, {
    bind: step.binds.length > 0 ? step.binds : undefined,
    returnValue: 'resultRows',
  })
  // SQL は常に `SELECT ... AS id, ... AS created_at_ms` の順で返す
  const rows = rawRows.map((row) => ({
    createdAtMs: row[1] as number,
    id: row[0] as number,
  }))
  return { rows, type: 'id-collect' }
}

function executeMerge(
  step: Extract<SerializedStep, { type: 'merge' }>,
  prevResults: StepResult[],
  plan: SerializedExecutionPlan,
): MergeResult {
  const allItems: { id: number; type: string; createdAtMs: number }[] = []
  for (const idx of step.sourceStepIndices) {
    const prev = prevResults[idx]
    if (prev && prev.type === 'id-collect') {
      const sourceStep = plan.steps[idx]
      const sourceType =
        sourceStep.type === 'id-collect' ? sourceStep.source : 'post'
      for (const row of prev.rows) {
        allItems.push({
          createdAtMs: row.createdAtMs,
          id: row.id,
          type: sourceType,
        })
      }
    }
  }
  allItems.sort((a, b) => b.createdAtMs - a.createdAtMs)
  const merged = allItems.slice(0, step.limit)
  return { mergedIds: merged, type: 'merge' }
}

function executeDetailFetch(
  db: DbExec,
  step: Extract<SerializedStep, { type: 'detail-fetch' }>,
  ctx: ExecutionContext,
): DetailFetchResult {
  const ids = step.target === 'notifications' ? ctx.allNotifIds : ctx.allPostIds
  if (ids.length === 0) {
    return { rows: [], type: 'detail-fetch' }
  }

  const placeholders = ids.map(() => '?').join(',')
  const sql = step.sqlTemplate.replaceAll('{IDS}', placeholders)
  const rows = db.exec(sql, {
    bind: ids,
    returnValue: 'resultRows',
  })

  // Expand reblog post IDs
  if (step.reblogColumnIndex != null) {
    const reblogIds: number[] = []
    for (const row of rows) {
      const rbId = row[step.reblogColumnIndex] as number | null
      if (rbId != null) reblogIds.push(rbId)
    }
    if (reblogIds.length > 0) {
      const combined = new Set([...ctx.allPostIds, ...reblogIds])
      ctx.allPostIds = [...combined]
    }
  }

  return { rows, type: 'detail-fetch' }
}

function executeBatchEnrich(
  db: DbExec,
  step: Extract<SerializedStep, { type: 'batch-enrich' }>,
  ctx: ExecutionContext,
): BatchEnrichResult {
  const ids = ctx.allPostIds
  if (ids.length === 0) {
    const emptyResults: Record<string, (string | number | null)[][]> = {}
    for (const key of Object.keys(step.queries)) {
      emptyResults[key] = []
    }
    return { results: emptyResults, type: 'batch-enrich' }
  }

  const placeholders = ids.map(() => '?').join(',')
  const results: Record<string, (string | number | null)[][]> = {}

  for (const [key, sqlTemplate] of Object.entries(step.queries)) {
    const sql = sqlTemplate.replaceAll('{IDS}', placeholders)
    results[key] = db.exec(sql, {
      bind: ids,
      returnValue: 'resultRows',
    })
  }

  return { results, type: 'batch-enrich' }
}

// --------------- Context updater ---------------

function updateContext(
  ctx: ExecutionContext,
  stepIndex: number,
  step: SerializedStep,
  result: StepResult,
  _plan: SerializedExecutionPlan,
): void {
  if (step.type === 'id-collect' && result.type === 'id-collect') {
    const ids = result.rows.map((row) => row.id)
    ctx.collectedIds.set(stepIndex, ids)

    // Determine which ID list to populate based on source
    if (step.source === 'notifications') {
      ctx.allNotifIds.push(...ids)
    } else {
      ctx.allPostIds.push(...ids)
    }
  }

  if (step.type === 'merge' && result.type === 'merge') {
    ctx.mergedIds = result.mergedIds
    // Redistribute merged IDs to post/notif lists
    ctx.allPostIds = []
    ctx.allNotifIds = []
    for (const item of result.mergedIds) {
      if (item.type === 'notifications') {
        ctx.allNotifIds.push(item.id)
      } else {
        ctx.allPostIds.push(item.id)
      }
    }
  }
}

// --------------- Main entry point ---------------

/** Execute an entire plan, step by step */
export function executeQueryPlan(
  db: DbExec,
  plan: SerializedExecutionPlan,
): QueryPlanResult {
  const start = performance.now()
  const ctx = createContext()
  const stepResults: StepResult[] = []

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]
    let result: StepResult

    switch (step.type) {
      case 'id-collect': {
        // Phase 2c: precomputed キャッシュヒット時はDB実行をスキップ
        const precomputed = plan.precomputedResults?.[i]
        result = precomputed ?? executeIdCollect(db, step)
        break
      }
      case 'merge':
        result = executeMerge(step, stepResults, plan)
        break
      case 'detail-fetch':
        result = executeDetailFetch(db, step, ctx)
        break
      case 'batch-enrich':
        result = executeBatchEnrich(db, step, ctx)
        break
    }

    stepResults.push(result)
    updateContext(ctx, i, step, result, plan)
  }

  return {
    stepResults,
    totalDurationMs: performance.now() - start,
  }
}
