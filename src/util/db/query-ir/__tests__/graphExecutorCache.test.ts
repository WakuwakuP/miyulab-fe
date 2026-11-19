import { DatabaseSync } from 'node:sqlite'
import { executeGetIds } from 'util/db/query-ir/executor/getIdsExecutor'
import {
  bumpAllGraphCacheVersions,
  bumpGraphCacheVersion,
  captureGraphCacheVersions,
  clearGraphCache,
  executeGraphPlan,
  syncGraphCacheVersions,
} from 'util/db/query-ir/executor/graphExecutor'
import { executeLookupRelated } from 'util/db/query-ir/executor/lookupRelatedExecutor'
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
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

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

  it('OR の各分岐内では全条件を要求し、空の分岐を無視する', () => {
    const result = executeGetIds(
      db as never,
      {
        ...baseGetIds,
        orBranches: [
          [],
          [
            { column: 'created_at_ms', op: '>=', table: 'posts', value: 200 },
            { column: 'id', op: '<', table: 'posts', value: 3 },
          ],
          [{ column: 'id', op: '=', table: 'posts', value: 1 }],
        ],
      },
      new Map(),
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([2, 1])
  })

  it('メディアの幅条件を満たす件数で投稿を絞り、メディアの変更を依存関係に含める', () => {
    native.exec(`
      INSERT INTO post_media (post_id, media_type_id, url, width)
      VALUES (1, 1, 'a', 800), (1, 1, 'b', 640),
             (2, 1, 'c', 800), (2, 1, 'd', 320)
    `)
    const result = executeGetIds(
      db as never,
      {
        ...baseGetIds,
        filters: [
          {
            countValue: 2,
            innerFilters: [
              { column: 'width', op: '>=', table: 'post_media', value: 640 },
            ],
            mode: 'count-gte',
            table: 'post_media',
          },
        ],
      },
      new Map(),
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([1])
    expect(result.dependentTables).toContain('post_media')
  })

  it.each([
    ['nearest', [12, 11]],
    ['furthest', [14, 13]],
  ] as const)(
    '時間窓内の通知を投稿ごとに1件選ぶ (%s)',
    (perLimitOrder, expected) => {
      seedNotification(native, 13, 1, 150)
      seedNotification(native, 14, 2, 250)
      seedNotification(native, 15, 1, 151)
      seedNotification(native, 16, 2, 199)
      const result = runPlan(
        planSourceToLookup(baseGetIds, {
          ...baseLookup,
          perLimit: 1,
          perLimitOrder,
          timeCondition: {
            afterInput: true,
            inputTimeColumn: 'created_at_ms',
            lookupTimeColumn: 'created_at_ms',
            windowMs: 50,
          },
        }),
      )
      expect(result.nodeOutputIds.lk.map((row) => row.id)).toEqual(expected)
    },
  )

  it('投稿と通知をマージして時刻順に返し、中間出力にもテーブルを保持する', () => {
    const result = runPlan({
      edges: [
        { source: 'posts', target: 'merge' },
        { source: 'notifications', target: 'merge' },
        { source: 'merge', target: 'out' },
      ],
      nodes: [
        { id: 'posts', node: baseGetIds },
        {
          id: 'notifications',
          node: { ...baseGetIds, table: 'notifications' },
        },
        {
          id: 'merge',
          node: { kind: 'merge-v2', limit: 3, strategy: 'union' },
        },
        {
          id: 'out',
          node: {
            kind: 'output-v2',
            pagination: { limit: 3 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    })
    const expected = [
      { id: 3, table: 'posts' },
      { id: 12, table: 'notifications' },
      { id: 2, table: 'posts' },
    ]
    expect(result.nodeOutputIds.merge).toEqual(expected)
    expect(result.displayOrder).toEqual(expected)
    expect(result.meta.sourceType).toBe('mixed')
    expect(result.meta.nodeStats.merge).toMatchObject({
      cacheHit: false,
      rowCount: 3,
    })
  })

  it('出力が未接続なら表示結果は空でも上流の実行結果とバージョンを返す', () => {
    const plan: SerializedGraphPlan = {
      edges: [],
      nodes: [
        { id: 'src', node: baseGetIds },
        {
          id: 'out',
          node: {
            kind: 'output-v2',
            pagination: { limit: 1 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const result = executeGraphPlan(
      db as never,
      plan,
      { backendUrls: [] },
      () => ({ posts: 7 }),
    )
    expect(result).toMatchObject({
      capturedVersions: { posts: 7 },
      displayOrder: [],
      meta: { nodeStats: { src: { rowCount: 1 } }, sourceType: 'post' },
      notifications: { detailRows: [] },
      posts: { batchResults: {}, detailRows: [] },
    })
    expect(result.nodeOutputIds).toEqual({ src: [{ id: 3, table: 'posts' }] })
  })

  it('ハッシュタグ名による絞り込みで中間テーブルとタグ辞書の両方を追跡する', () => {
    native.exec(`
      INSERT INTO hashtags (id, name) VALUES (51, 'sqlite'), (52, 'other');
      INSERT INTO post_hashtags (post_id, hashtag_id) VALUES (1, 51), (2, 52);
    `)
    const result = executeGetIds(
      db as never,
      {
        ...baseGetIds,
        filters: [
          {
            innerFilters: [
              { column: 'name', op: '=', table: 'hashtags', value: 'sqlite' },
            ],
            mode: 'exists',
            table: 'post_hashtags',
          },
        ],
      },
      new Map(),
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([1])
    expect(new Set(result.dependentTables)).toEqual(
      new Set(['posts', 'post_hashtags', 'hashtags']),
    )
  })

  it('入力未接続の lookup は空の中間結果を下流に渡し、SQL を発行しない', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    plan.nodes = plan.nodes.filter((entry) => entry.id !== 'src')
    plan.edges = [{ source: 'lk', target: 'out' }]
    const result = runPlan(plan)
    expect(result.nodeOutputIds).toEqual({ lk: [] })
    expect(result.meta.nodeStats.lk).toMatchObject({
      cacheHit: false,
      rowCount: 0,
    })
    expect(result.meta.nodeStats.out).toMatchObject({ rowCount: 0 })
    expect(result.displayOrder).toEqual([])
    expect(execLog).toEqual([])
  })

  it.each([
    ['nearest', [41, 43]],
    ['furthest', [42, 44]],
  ] as const)(
    '時刻列がない関連テーブルで入力ごとに ID 順で選ぶ (%s)',
    (perLimitOrder, expectedIds) => {
      native.exec(`
      INSERT INTO post_hashtags (id, post_id, hashtag_id)
      VALUES (41, 1, 7), (42, 1, 8), (43, 2, 7), (44, 2, 8), (45, 3, 9)
    `)
      const result = executeLookupRelated(
        db as never,
        {
          joinConditions: [{ inputColumn: 'id', lookupColumn: 'post_id' }],
          kind: 'lookup-related',
          lookupTable: 'post_hashtags',
          perLimit: 1,
          perLimitOrder,
        },
        {
          hash: 'two-posts',
          rows: [
            { createdAtMs: 100, id: 1, table: 'posts' },
            { createdAtMs: 200, id: 2, table: 'posts' },
          ],
          sourceTable: 'posts',
        },
      )
      expect(
        result.output.rows.map((row) => row.id).sort((a, b) => a - b),
      ).toEqual(expectedIds)
      expect(result.output.rows.map((row) => row.createdAtMs)).toEqual([0, 0])
      expect(new Set(result.dependentTables)).toEqual(
        new Set(['post_hashtags', 'posts']),
      )
    },
  )

  it.each([true, false])(
    '集約時は perLimit より関連行ごとのグループ化を優先する (時間窓=%s)',
    (withWindow) => {
      seedNotification(native, 13, 1, 150)
      const result = executeLookupRelated(
        db as never,
        {
          ...baseLookup,
          aggregate: { column: 'id', function: 'MAX' },
          perLimit: 1,
          ...(withWindow
            ? {
                timeCondition: {
                  afterInput: true,
                  inputTimeColumn: 'created_at_ms',
                  lookupTimeColumn: 'created_at_ms',
                  windowMs: 100,
                },
              }
            : {}),
        },
        {
          hash: 'post-1',
          rows: [{ createdAtMs: 100, id: 1, table: 'posts' }],
          sourceTable: 'posts',
        },
      )
      expect(result.output.rows).toEqual([
        { createdAtMs: 13, id: 13, table: 'notifications' },
        { createdAtMs: 11, id: 11, table: 'notifications' },
      ])
      expect(new Set(result.dependentTables)).toEqual(
        new Set(['posts', 'notifications']),
      )
    },
  )

  it.each([
    [true, 'nearest', 11],
    [true, 'furthest', 14],
    [false, 'nearest', 15],
    [false, 'furthest', 16],
  ] as const)(
    '通知の参照先を経由して時間窓内の1件を選ぶ (afterInput=%s, %s)',
    (afterInput, perLimitOrder, expectedId) => {
      seedNotification(native, 14, 1, 130)
      seedNotification(native, 15, 1, 109)
      seedNotification(native, 16, 1, 90)
      seedNotification(native, 17, 1, 89)
      seedNotification(native, 18, 1, 131)
      seedNotification(native, 19, 2, 129)
      const result = executeLookupRelated(
        db as never,
        {
          ...baseLookup,
          joinConditions: [
            {
              inputColumn: 'id',
              lookupColumn: 'related_post_id',
              resolve: {
                inputKey: 'id',
                lookupKey: 'id',
                matchColumn: 'related_post_id',
                via: 'notifications',
              },
            },
          ],
          perLimit: 1,
          perLimitOrder,
          timeCondition: {
            afterInput,
            inputTimeColumn: 'created_at_ms',
            lookupTimeColumn: 'created_at_ms',
            windowMs: 20,
          },
        },
        {
          hash: 'notification-11',
          rows: [{ createdAtMs: 110, id: 11, table: 'notifications' }],
          sourceTable: 'notifications',
        },
      )
      expect(result.output.rows.map((row) => row.id)).toEqual([expectedId])
    },
  )

  it.each([true, false])(
    '投稿とアクターが共に一致する通知を返し、プロフィールの変更を追跡する (時間窓=%s)',
    (withWindow) => {
      native.exec(`
      INSERT INTO profiles (id, username, server_id, acct, canonical_acct)
      VALUES (41, 'alice', 0, 'alice', 'alice@example.com'), (42, 'bob', 0, 'bob', 'bob@example.com');
      UPDATE posts SET author_profile_id = 41 WHERE id = 1;
      UPDATE notifications SET actor_profile_id = 41 WHERE id IN (11, 12);
    `)
      seedNotification(native, 13, 1, 115)
      native.exec(
        'UPDATE notifications SET actor_profile_id = 42 WHERE id = 13',
      )
      const result = executeLookupRelated(
        db as never,
        {
          ...baseLookup,
          joinConditions: [
            { inputColumn: 'id', lookupColumn: 'related_post_id' },
            {
              inputColumn: 'author_profile_id',
              lookupColumn: 'actor_profile_id',
              resolveIdentity: true,
            },
          ],
          ...(withWindow
            ? {
                timeCondition: {
                  afterInput: true,
                  inputTimeColumn: 'created_at_ms',
                  lookupTimeColumn: 'created_at_ms',
                  windowMs: 200,
                },
              }
            : {}),
        },
        {
          hash: 'post-1',
          rows: [{ createdAtMs: 100, id: 1, table: 'posts' }],
          sourceTable: 'posts',
        },
      )
      expect(result.output.rows.map((row) => row.id)).toEqual([11])
      expect(new Set(result.dependentTables)).toEqual(
        new Set(['posts', 'notifications', 'profiles']),
      )
    },
  )

  it.each([true, false])(
    '実行メタデータは各ノードとグラフの経過時間を記録する (接続=%s)',
    (connected) => {
      const plan = planSourceToLookup(baseGetIds, baseLookup)
      if (!connected)
        plan.edges = plan.edges.filter((edge) => edge.target !== 'out')
      let now = 100
      using clock = vi.spyOn(performance, 'now').mockImplementation(() => ++now)
      const { meta } = runPlan(plan)
      expect(meta.nodeStats.src.durationMs).toBe(1)
      expect(meta.totalDurationMs).toBe(clock.mock.calls.length - 1)
      if (connected) expect(meta.nodeStats.out.cacheHit).toBe(false)
    },
  )

  it('下流のSQLとバインドが同じでも、上流の出力が変われば再取得する', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    plan.nodes[1] = {
      id: 'lk',
      node: { ...baseGetIds, table: 'notifications' },
    }
    runPlan(plan)
    expect(runPlan(plan).meta.nodeStats.lk.cacheHit).toBe(true)
    seedPost(native, 4, 400)
    bumpGraphCacheVersion('posts')
    expect(runPlan(plan).meta.nodeStats.lk.cacheHit).toBe(false)
  })

  it.each([true, false])(
    'プロフィールの入力列が空なら主キーで本人を解決する (時間窓=%s)',
    (withWindow) => {
      native.exec(`
      INSERT INTO profiles (id, username, server_id, acct, canonical_acct) VALUES (51,'alice',0,'alice','alice@example.com');
      UPDATE notifications SET actor_profile_id = 51 WHERE id = 11;
    `)
      const result = executeLookupRelated(
        db as never,
        {
          ...baseLookup,
          joinConditions: [
            {
              inputColumn: '',
              lookupColumn: 'actor_profile_id',
              resolveIdentity: true,
            },
          ],
          ...(withWindow
            ? {
                timeCondition: {
                  afterInput: true,
                  inputTimeColumn: 'id',
                  lookupTimeColumn: 'created_at_ms',
                  windowMs: 100,
                },
              }
            : {}),
        },
        {
          hash: 'profile-51',
          rows: [{ createdAtMs: 51, id: 51, table: 'profiles' }],
          sourceTable: 'profiles',
        },
      )
      expect(result.output.rows.map((row) => row.id)).toEqual([11])
    },
  )

  it('参照を解決する条件と直接比較する条件を同時に満たす通知だけを取得する', () => {
    seedNotification(native, 21, 1, 120)
    const result = executeLookupRelated(
      db as never,
      {
        ...baseLookup,
        joinConditions: [
          { inputColumn: 'id', lookupColumn: 'id' },
          {
            inputColumn: 'id',
            lookupColumn: 'related_post_id',
            resolve: {
              inputKey: 'id',
              lookupKey: 'id',
              matchColumn: 'related_post_id',
              via: 'notifications',
            },
          },
        ],
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 50,
        },
      },
      {
        hash: 'notification-11',
        rows: [{ createdAtMs: 110, id: 11, table: 'notifications' }],
        sourceTable: 'notifications',
      },
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([11])
  })

  it('通知IDと時刻の順が逆でも perLimit は時刻順で通知を選ぶ', () => {
    seedNotification(native, 21, 1, 90)
    const result = executeLookupRelated(
      db as never,
      { ...baseLookup, perLimit: 1, perLimitOrder: 'nearest' },
      {
        hash: 'post-1',
        rows: [{ createdAtMs: 100, id: 1, table: 'posts' }],
        sourceTable: 'posts',
      },
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([21])
  })

  it('複数の本人照合条件で投稿者と通知元の各プロフィールを解決する', () => {
    native.exec(`
      INSERT INTO profiles (id, username, server_id, acct, canonical_acct)
      VALUES (1,'alice',0,'alice','alice@example.com'), (2,'bob',0,'bob','bob@example.com');
      UPDATE posts SET author_profile_id = 2 WHERE id = 1;
      UPDATE notifications SET actor_profile_id = 2 WHERE id = 11;
    `)
    const result = executeLookupRelated(
      db as never,
      {
        ...baseLookup,
        joinConditions: [
          {
            inputColumn: 'id',
            lookupColumn: 'related_post_id',
            resolveIdentity: true,
          },
          {
            inputColumn: 'author_profile_id',
            lookupColumn: 'actor_profile_id',
            resolveIdentity: true,
          },
        ],
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 50,
        },
      },
      {
        hash: 'two-identities',
        rows: [{ createdAtMs: 100, id: 1, table: 'posts' }],
        sourceTable: 'posts',
      },
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([11])
  })

  it('未指定の入力列は時間窓付きの通常の結合でも主キーを使う', () => {
    const result = executeLookupRelated(
      db as never,
      {
        ...baseLookup,
        joinConditions: [{ inputColumn: '', lookupColumn: 'related_post_id' }],
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 50,
        },
      },
      {
        hash: 'post-1',
        rows: [{ createdAtMs: 100, id: 1, table: 'posts' }],
        sourceTable: 'posts',
      },
    )
    expect(result.output.rows.map((row) => row.id)).toEqual([11])
  })

  it('孤立した出力ノードは他のノードの ID から入力を推測しない', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    plan.nodes = [
      { id: 'Stryker was here!', node: baseGetIds },
      ...plan.nodes.filter((entry) => entry.node.kind === 'output-v2'),
    ]
    plan.edges = []
    expect(runPlan(plan).displayOrder).toEqual([])
  })

  it('コールド実行は各ノードの SQL を発行し、ウォーム実行は detail のみ発行する', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)

    const cold = runPlan(plan)
    expect(execLog).toHaveLength(3)
    expect(cold.meta.nodeStats.src?.cacheHit).toBe(false)
    expect(cold.meta.nodeStats.lk?.cacheHit).toBe(false)
    expect(cold.nodeOutputIds.lk?.length).toBe(2)

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog).toHaveLength(1)
    expect(execLog[0]).toContain('FROM notifications')
    expect(warm.meta.nodeStats.src?.cacheHit).toBe(true)
    expect(warm.meta.nodeStats.lk?.cacheHit).toBe(true)
    expect(warm.nodeOutputIds.lk?.length).toBe(2)
  })

  it('一括更新と外部同期でキャッシュを無効化し、同じバージョンの再同期では再利用する', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    runPlan(plan)
    const before = captureGraphCacheVersions()
    bumpAllGraphCacheVersions(['posts', 'notifications'])
    const posts = (before.posts ?? 0) + 1
    const notifications = (before.notifications ?? 0) + 1
    expect(captureGraphCacheVersions()).toMatchObject({ notifications, posts })
    expect(runPlan(plan).meta.nodeStats.src?.cacheHit).toBe(false)

    const remote = new Map([['notifications', notifications + 1]])
    syncGraphCacheVersions(remote)
    const refreshed = runPlan(plan)
    expect(refreshed.meta.nodeStats.src?.cacheHit).toBe(true)
    expect(refreshed.meta.nodeStats.lk?.cacheHit).toBe(false)
    syncGraphCacheVersions(remote)
    expect(runPlan(plan).meta.nodeStats.lk?.cacheHit).toBe(true)
  })

  it('依存テーブルのバージョン bump で再クエリされる', () => {
    const plan = planSourceToLookup(baseGetIds, baseLookup)
    runPlan(plan)
    runPlan(plan)
    expect(execLog).toHaveLength(4)

    bumpGraphCacheVersion('posts')
    execLog.length = 0
    const afterBump = runPlan(plan)
    expect(execLog).toHaveLength(3)
    expect(afterBump.meta.nodeStats.src?.cacheHit).toBe(false)
    expect(afterBump.meta.nodeStats.lk?.cacheHit).toBe(false)

    bumpGraphCacheVersion('servers')
    execLog.length = 0
    const unrelated = runPlan(plan)
    expect(execLog).toHaveLength(1)
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
    expect(execLog).toHaveLength(1)
    expect(cold.nodeOutputIds.lk).toEqual([])

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog).toHaveLength(0)
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
      execLog.filter((s) => s.includes('FROM notifications lt')),
    ).toHaveLength(0)
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
    expect(execLog).toHaveLength(3)
    expect(cold.displayOrder).toHaveLength(2)

    execLog.length = 0
    const warm = runPlan(plan)
    expect(execLog).toHaveLength(1)
    expect(execLog[0]).toContain('FROM notifications')
    expect(warm.displayOrder).toHaveLength(2)
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
