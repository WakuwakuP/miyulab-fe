import { DatabaseSync } from 'node:sqlite'
import { executeGetIds } from 'util/db/query-ir/executor/getIdsExecutor'
import {
  bumpGraphCacheVersion,
  clearGraphCache,
  executeGraphPlan,
} from 'util/db/query-ir/executor/graphExecutor'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import type {
  GetIdsNode,
  LookupRelatedNode,
  QueryPlanV2,
} from 'util/db/query-ir/nodes'
import {
  patchPlanForFetch,
  patchPlanForStreamingFetch,
} from 'util/db/query-ir/patchPlanForFetch'
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

  describe('時刻を持たない投稿参照の取得順', () => {
    beforeEach(() => {
      seedPost(native, 4, 400)
      native.exec(`
        INSERT INTO hashtags (id, name) VALUES (9, 'food');
        INSERT INTO post_hashtags (post_id, hashtag_id)
        VALUES (4, 9), (3, 9), (2, 9), (1, 9);
      `)
    })

    const makeHashtagPlan = (
      overrides: Partial<GetIdsNode> = {},
    ): QueryPlanV2 => ({
      edges: [
        { source: 'tags', target: 'tag-posts' },
        { source: 'tag-posts', target: 'out' },
      ],
      nodes: [
        {
          id: 'tags',
          node: {
            filters: [
              { column: 'name', op: '=', table: 'hashtags', value: 'food' },
            ],
            kind: 'get-ids',
            table: 'hashtags',
          },
        },
        {
          id: 'tag-posts',
          node: {
            filters: [
              {
                column: 'hashtag_id',
                op: 'IN',
                table: 'post_hashtags',
                upstreamSourceNodeId: 'tags',
              },
            ],
            kind: 'get-ids',
            outputIdColumn: 'post_id',
            table: 'post_hashtags',
            ...overrides,
          },
        },
        {
          id: 'out',
          node: {
            kind: 'output-v2',
            pagination: { limit: 2 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    })

    it.each([undefined, null])(
      'outputTimeColumn=%s: プレビューと初回取得は投稿時刻順で LIMIT する',
      (outputTimeColumn) => {
        const plan = makeHashtagPlan({ outputTimeColumn })
        const original = JSON.stringify(plan)
        for (const effectivePlan of [plan, patchPlanForFetch(plan, 2)]) {
          const result = runPlan(effectivePlan)
          expect(result.displayOrder).toEqual([
            { id: 4, table: 'posts' },
            { id: 3, table: 'posts' },
          ])
        }
        expect(JSON.stringify(plan)).toBe(original)
      },
    )

    it('初回、過去ページ、ストリーミングが同じ投稿時刻を使う', () => {
      const plan = makeHashtagPlan()
      expect(runPlan(plan).displayOrder.map((row) => row.id)).toEqual([4, 3])
      const older = patchPlanForFetch(plan, 2, {
        direction: 'before',
        field: 'created_at_ms',
        value: 300,
      })
      expect(runPlan(older).displayOrder.map((row) => row.id)).toEqual([2, 1])
      const newer = patchPlanForStreamingFetch(
        plan,
        2,
        { direction: 'after', field: 'created_at_ms', value: 200 },
        new Set(['post_hashtags']),
      )
      expect(runPlan(newer).displayOrder.map((row) => row.id)).toEqual([4, 3])
    })

    it.each([false, true])(
      '明示 JOIN=%s: 投稿 ID カーソルは元テーブルのカラムを使う',
      (explicitJoin) => {
        const result = executeGetIds(
          db as never,
          {
            cursor: { column: 'post_id', op: '<', value: 3 },
            filters: [],
            kind: 'get-ids',
            outputIdColumn: 'post_id',
            table: 'post_hashtags',
            timeSourceJoin: explicitJoin
              ? {
                  foreignColumn: 'id',
                  localColumn: 'post_id',
                  table: 'posts',
                  timeColumn: 'created_at_ms',
                }
              : undefined,
          },
          new Map(),
          2,
        )
        expect(result.output.rows).toEqual([
          { createdAtMs: 200, id: 2, table: 'posts' },
          { createdAtMs: 100, id: 1, table: 'posts' },
        ])
      },
    )

    it('明示した時刻 JOIN をページ・ストリーミング取得でも上書きしない', () => {
      native.exec('UPDATE posts SET edited_at_ms = 1000 - created_at_ms')
      const plan = makeHashtagPlan({
        timeSourceJoin: {
          foreignColumn: 'id',
          localColumn: 'post_id',
          table: 'posts',
          timeColumn: 'edited_at_ms',
        },
      })
      expect(runPlan(plan).displayOrder.map((row) => row.id)).toEqual([1, 2])
      const cursor = {
        direction: 'before' as const,
        field: 'created_at_ms' as const,
        value: 800,
      }
      for (const patched of [
        patchPlanForFetch(plan, 2, cursor),
        patchPlanForStreamingFetch(plan, 2, cursor, new Set(['post_hashtags'])),
      ]) {
        expect(runPlan(patched).displayOrder.map((row) => row.id)).toEqual([
          3, 4,
        ])
      }
    })

    it('参照先 posts の時刻変更で中間テーブルのキャッシュも無効になる', () => {
      const plan = makeHashtagPlan()
      runPlan(plan)
      expect(runPlan(plan).meta.nodeStats['tag-posts']?.cacheHit).toBe(true)
      native.exec('UPDATE posts SET created_at_ms = 500 WHERE id = 1')
      bumpGraphCacheVersion('posts')
      const result = runPlan(plan)
      expect(result.meta.nodeStats['tag-posts']?.cacheHit).toBe(false)
      expect(result.displayOrder.map((row) => row.id)).toEqual([1, 4])
    })
  })
})
