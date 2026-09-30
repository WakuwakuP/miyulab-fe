import type { QueryPlanV2 } from 'util/db/query-ir/nodes'
import type { TimelineItem } from 'util/hooks/useTimelineDataSource'
import { describe, expect, it } from 'vitest'

import {
  collectAffectedTimelineEntries,
  planReferencesTableDeep,
} from '../interactionRefresh'

const postsPlan: QueryPlanV2 = {
  edges: [],
  nodes: [
    {
      id: 'src',
      node: { filters: [], kind: 'get-ids', table: 'posts' },
    },
  ],
  version: 2,
}

describe('planReferencesTableDeep', () => {
  it('ソーステーブル・フィルタ・JOIN を持たないプランは false', () => {
    expect(planReferencesTableDeep(postsPlan, 'post_interactions')).toBe(false)
  })

  it('ソーステーブル自体が対象なら true', () => {
    const plan: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'src',
          node: {
            filters: [],
            kind: 'get-ids',
            table: 'post_interactions',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(plan, 'post_interactions')).toBe(true)
  })

  it('フィルタ条件が対象テーブルを参照すれば true', () => {
    const plan: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'src',
          node: {
            filters: [
              {
                column: 'is_favourited',
                op: '=',
                table: 'post_interactions',
                value: 1,
              },
            ],
            kind: 'get-ids',
            table: 'posts',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(plan, 'post_interactions')).toBe(true)
  })

  it('EXISTS 条件の innerFilters が対象テーブルを参照すれば true', () => {
    const plan: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'src',
          node: {
            filters: [
              {
                innerFilters: [
                  {
                    column: 'is_favourited',
                    op: '=',
                    table: 'post_interactions',
                    value: 1,
                  },
                ],
                mode: 'exists',
                table: 'post_hashtags',
              },
            ],
            kind: 'get-ids',
            table: 'posts',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(plan, 'post_interactions')).toBe(true)
  })

  it('OR 分岐のフィルタが対象テーブルを参照すれば true', () => {
    const plan: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'src',
          node: {
            filters: [],
            kind: 'get-ids',
            orBranches: [
              [
                {
                  column: 'is_favourited',
                  op: '=',
                  table: 'post_interactions',
                  value: 1,
                },
              ],
            ],
            table: 'posts',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(plan, 'post_interactions')).toBe(true)
  })

  it('timeSourceJoin が対象テーブルなら true', () => {
    const plan: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'src',
          node: {
            filters: [],
            kind: 'get-ids',
            table: 'timeline_entries',
            timeSourceJoin: {
              foreignColumn: 'id',
              localColumn: 'post_id',
              table: 'post_interactions',
              timeColumn: 'updated_at',
            },
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(plan, 'post_interactions')).toBe(true)
  })

  it('lookup-related の lookupTable / resolve.via が対象なら true', () => {
    const viaTable: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'lk',
          node: {
            joinConditions: [{ inputColumn: 'id', lookupColumn: 'post_id' }],
            kind: 'lookup-related',
            lookupTable: 'post_interactions',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(viaTable, 'post_interactions')).toBe(true)

    const viaResolve: QueryPlanV2 = {
      edges: [],
      nodes: [
        {
          id: 'lk',
          node: {
            joinConditions: [
              {
                inputColumn: 'id',
                lookupColumn: 'related_post_id',
                resolve: {
                  inputKey: 'id',
                  lookupKey: 'post_id',
                  matchColumn: 'local_id',
                  via: 'post_interactions',
                },
              },
            ],
            kind: 'lookup-related',
            lookupTable: 'notifications',
          },
        },
      ],
      version: 2,
    }
    expect(planReferencesTableDeep(viaResolve, 'post_interactions')).toBe(true)
  })
})

describe('collectAffectedTimelineEntries', () => {
  it('post_id が一致する投稿アイテムを返す', () => {
    const item = {
      created_at_ms: 100,
      id: 'p1',
      post_id: 10,
    } as unknown as TimelineItem
    const { notificationIds, postIds } = collectAffectedTimelineEntries(
      new Set([10]),
      [item],
    )
    expect([...postIds]).toEqual([10])
    expect(notificationIds.size).toBe(0)
  })

  it('リブログ内側の post_id がヒットしたら外側ラッパー ID を返す', () => {
    const wrapper = {
      created_at_ms: 100,
      id: 'p1',
      post_id: 50,
      reblog: { post_id: 42 },
    } as unknown as TimelineItem
    const { postIds } = collectAffectedTimelineEntries(new Set([42]), [wrapper])
    expect([...postIds]).toEqual([50])
  })

  it('通知アイテムは埋め込み status の post_id 一致で notification_id を返す', () => {
    const notification = {
      created_at_ms: 100,
      id: 'n1',
      notification_id: 7,
      status: { post_id: 42, reblog: null },
    } as unknown as TimelineItem
    const { notificationIds, postIds } = collectAffectedTimelineEntries(
      new Set([42]),
      [notification],
    )
    expect([...notificationIds]).toEqual([7])
    expect(postIds.size).toBe(0)
  })

  it('通知の埋め込みリブログ内側 post_id 一致でも notification_id を返す', () => {
    const notification = {
      created_at_ms: 100,
      id: 'n1',
      notification_id: 7,
      status: { post_id: 9, reblog: { post_id: 42 } },
    } as unknown as TimelineItem
    const { notificationIds } = collectAffectedTimelineEntries(new Set([42]), [
      notification,
    ])
    expect([...notificationIds]).toEqual([7])
  })

  it('一致しないアイテムや post_id を持たないアイテムは除外する', () => {
    const miss = {
      created_at_ms: 100,
      id: 'p1',
      post_id: 1,
    } as unknown as TimelineItem
    const bare = { created_at_ms: 100, id: 'x' } as unknown as TimelineItem
    const { notificationIds, postIds } = collectAffectedTimelineEntries(
      new Set([99]),
      [miss, bare],
    )
    expect(postIds.size).toBe(0)
    expect(notificationIds.size).toBe(0)
  })

  it('post_id が数値文字列でも数値 ID として一致させる', () => {
    const item = {
      created_at_ms: 100,
      id: 'p1',
      post_id: '42',
    } as unknown as TimelineItem
    const { postIds } = collectAffectedTimelineEntries(new Set([42]), [item])
    expect([...postIds]).toEqual([42])
  })
})
