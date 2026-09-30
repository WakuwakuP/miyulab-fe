import { DatabaseSync } from 'node:sqlite'
import {
  bumpGraphCacheVersion,
  clearGraphCache,
  executeGraphPlan,
} from 'util/db/query-ir/executor/graphExecutor'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import type { GetIdsNode, LookupRelatedNode } from 'util/db/query-ir/nodes'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { createFreshSchema } from 'util/db/sqlite/schema'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

function createRealDb(): {
  db: DbExecCompat
  native: DatabaseSync
  execLog: string[]
} {
  const native = new DatabaseSync(':memory:')
  const execLog: string[] = []
  const db: DbExecCompat = {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ): unknown => {
      execLog.push(sql)
      if (opts?.returnValue === 'resultRows') {
        const stmt = native.prepare(sql)
        const rows = (
          opts.bind ? stmt.all(...opts.bind) : stmt.all()
        ) as Record<string, unknown>[]
        return rows.map((row) => Object.values(row))
      }
      if (opts?.bind) {
        return native.prepare(sql).run(...opts.bind)
      }
      return native.exec(sql)
    },
  }
  return { db, execLog, native }
}

function seedPost(native: DatabaseSync, id: number, createdAtMs: number): void {
  native
    .prepare(
      `INSERT INTO posts (id, object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
       VALUES (?, ?, 0, 0, ?, 0);`,
    )
    .run(id, `post-${id}`, createdAtMs)
}

function seedNotification(
  native: DatabaseSync,
  id: number,
  relatedPostId: number | null,
  createdAtMs: number,
): void {
  native
    .prepare(
      `INSERT INTO notifications (id, local_account_id, local_id, notification_type_id, created_at_ms, related_post_id)
       VALUES (?, 0, ?, 0, ?, ?);`,
    )
    .run(id, `n${id}`, createdAtMs, relatedPostId)
}

function planSourceToLookup(
  getIds: GetIdsNode,
  lookup: LookupRelatedNode,
): SerializedGraphPlan {
  return {
    edges: [
      { source: 'src', target: 'lk' },
      { source: 'lk', target: 'out' },
    ],
    nodes: [
      { id: 'src', node: getIds },
      { id: 'lk', node: lookup },
      {
        id: 'out',
        node: {
          kind: 'output-v2',
          pagination: { limit: 10 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

const baseGetIds: GetIdsNode = {
  filters: [],
  kind: 'get-ids',
  table: 'posts',
}

const baseLookup: LookupRelatedNode = {
  joinConditions: [{ inputColumn: 'id', lookupColumn: 'related_post_id' }],
  kind: 'lookup-related',
  lookupTable: 'notifications',
}

describe('executeGraphPlan — ノードキャッシュ (実 SQLite)', () => {
  let db: DbExecCompat
  let native: DatabaseSync
  let execLog: string[]

  beforeEach(() => {
    clearGraphCache()
    const real = createRealDb()
    db = real.db
    native = real.native
    execLog = real.execLog
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = OFF;')
    seedPost(native, 1, 100)
    seedPost(native, 2, 200)
    seedPost(native, 3, 300)
    seedNotification(native, 11, 1, 110)
    seedNotification(native, 12, 2, 210)
    execLog.length = 0
    onTestFinished(() => {
      native.close()
    })
  })

  const runPlan = (plan: SerializedGraphPlan) =>
    executeGraphPlan(db as never, plan, { backendUrls: [] }, () => ({}))

  it('コールド実行は各ノードの SQL を発行し、ウォーム実行は detail のみ発行する', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)

    const cold = runPlan(plan)
    expect(execLog.length).toBe(3)
    expect(cold.meta.nodeStats.src?.cacheHit).toBe(false)
    expect(cold.meta.nodeStats.lk?.cacheHit).toBe(false)
    expect(cold.nodeOutputIds.lk?.length).toBe(2)

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog.length).toBe(1)
    expect(execLog[0]).toContain('FROM notifications')
    expect(warm.meta.nodeStats.src?.cacheHit).toBe(true)
    expect(warm.meta.nodeStats.lk?.cacheHit).toBe(true)
    expect(warm.nodeOutputIds.lk?.length).toBe(2)
  })

  it('依存テーブルのバージョン bump で再クエリされる', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    runPlan(plan)
    runPlan(plan)
    expect(execLog.length).toBe(4)

    bumpGraphCacheVersion('posts')
    execLog.length = 0
    const afterBump = runPlan(plan)
    expect(execLog.length).toBe(3)
    expect(afterBump.meta.nodeStats.src?.cacheHit).toBe(false)
    expect(afterBump.meta.nodeStats.lk?.cacheHit).toBe(false)

    bumpGraphCacheVersion('servers')
    execLog.length = 0
    const unrelated = runPlan(plan)
    expect(execLog.length).toBe(1)
    expect(unrelated.meta.nodeStats.src?.cacheHit).toBe(true)
  })

  it('同件数でも ID が異なる上流出力では lookup が再実行される', () => {
    const lookupCalls = () =>
      execLog.filter((s) => s.includes('FROM notifications lt')).length

    const planA = planSourceToLookup(
      {
        ...baseGetIds,
        filters: [{ column: 'id', op: 'IN', table: 'posts', value: [1, 2] }],
      },
      baseLookup,
    )
    const planB = planSourceToLookup(
      {
        ...baseGetIds,
        filters: [{ column: 'id', op: 'IN', table: 'posts', value: [2, 3] }],
      },
      baseLookup,
    )

    const outA = runPlan(planA)
    const outB = runPlan(planB)
    expect(outA.nodeOutputIds.src).toHaveLength(2)
    expect(outB.nodeOutputIds.src).toHaveLength(2)
    expect(new Set(outA.nodeOutputIds.src)).not.toEqual(
      new Set(outB.nodeOutputIds.src),
    )
    expect(outB.meta.nodeStats.lk?.cacheHit).toBe(false)
    expect(lookupCalls()).toBe(2)

    execLog.length = 0
    runPlan(planA)
    runPlan(planB)
    expect(lookupCalls()).toBe(0)
  })

  it('上流が空の場合 lookup は DB を呼ばず lookup:empty を返す', () => {
    const plan = planSourceToLookup(
      {
        ...baseGetIds,
        filters: [{ column: 'id', op: '=', table: 'posts', value: -999 }],
      },
      baseLookup,
    )

    const cold = runPlan(plan)
    expect(execLog.length).toBe(1)
    expect(cold.nodeOutputIds.lk).toEqual([])

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog.length).toBe(0)
    expect(warm.meta.nodeStats.lk?.cacheHit).toBe(true)
    expect(warm.nodeOutputIds.lk).toEqual([])
  })

  it('perLimit 指定の lookup は別キャッシュキーで管理される', () => {
    const limited: LookupRelatedNode = { ...baseLookup, perLimit: 1 }
    const planA = planSourceToLookup(baseGetIds, baseLookup)
    const planB = planSourceToLookup(baseGetIds, limited)

    runPlan(planA)
    runPlan(planB)
    const lookupCalls = execLog.filter((s) =>
      s.includes('FROM notifications lt'),
    ).length
    expect(lookupCalls).toBe(2)

    execLog.length = 0
    runPlan(planA)
    runPlan(planB)
    expect(
      execLog.filter((s) => s.includes('FROM notifications lt')).length,
    ).toBe(0)
  })

  it('出力ノード付き: ウォーム実行では detail SQL のみ発行される', () => {
    const plan: SerializedGraphPlan = {
      edges: [
        { source: 'src', target: 'lk' },
        { source: 'lk', target: 'out' },
      ],
      nodes: [
        { id: 'src', node: baseGetIds },
        { id: 'lk', node: baseLookup },
        {
          id: 'out',
          node: {
            kind: 'output-v2',
            pagination: { limit: 10 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }

    const cold = runPlan(plan)
    expect(execLog.length).toBe(3)
    expect(cold.displayOrder.length).toBe(2)

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog.length).toBe(1)
    expect(execLog[0]).toContain('FROM notifications')
    expect(warm.displayOrder.length).toBe(2)
    expect(warm.meta.nodeStats.src?.cacheHit).toBe(true)
    expect(warm.meta.nodeStats.lk?.cacheHit).toBe(true)
  })
})
