import { describe, expect, it } from 'vitest'
import type {
  GetIdsNode,
  LookupRelatedNode,
  OutputNodeV2,
  QueryPlan,
  QueryPlanV2,
} from '../nodes'
import { migrateQueryPlanV1ToV2 } from './migrateV1ToV2'
import { queryPlanV2ToQueryPlanV1 } from './v2ToV1'

const baseSort = {
  direction: 'DESC' as const,
  field: 'created_at_ms',
  kind: 'sort' as const,
}

const basePagination = { kind: 'pagination' as const, limit: 50 }

function simplePostsPlan(): QueryPlan {
  return {
    composites: [],
    filters: [],
    pagination: basePagination,
    sort: baseSort,
    source: { kind: 'source', table: 'posts' },
  }
}

describe('queryPlanV2ToQueryPlanV1', () => {
  it('単一ソースの V2 を V1 に戻し、テーブル・ページネーション・ソートを維持する', () => {
    const v1In = simplePostsPlan()
    const v2 = migrateQueryPlanV1ToV2(v1In)
    const v1Out = queryPlanV2ToQueryPlanV1(v2)
    expect(v1Out.source.table).toBe('posts')
    expect(v1Out.pagination.limit).toBe(50)
    expect(v1Out.sort.field).toBe('created_at_ms')
    expect(v1Out.composites).toHaveLength(0)
  })

  it('merge を含む V2 を V1 の merge 複合に戻す', () => {
    const branch = simplePostsPlan()
    const v1In: QueryPlan = {
      composites: [
        {
          kind: 'merge',
          limit: 80,
          sources: [branch, branch],
          strategy: 'interleave-by-time',
        },
      ],
      filters: [],
      pagination: basePagination,
      sort: baseSort,
      source: { kind: 'source', table: 'posts' },
    }
    const v2 = migrateQueryPlanV1ToV2(v1In)
    const v1Out = queryPlanV2ToQueryPlanV1(v2)
    expect(v1Out.composites).toHaveLength(1)
    const m = v1Out.composites[0]
    expect(m?.kind).toBe('merge')
    if (m?.kind === 'merge') {
      expect(m.sources).toHaveLength(2)
      expect(m.strategy).toBe('interleave-by-time')
      expect(m.limit).toBe(80)
    }
  })

  it('notifications → lookup(posts) → output は空中リプライ近似の V1 になる', () => {
    const gId = 'g'
    const lId = 'l'
    const oId = 'o'
    const getIds: GetIdsNode = {
      filters: [],
      kind: 'get-ids',
      table: 'notifications',
    }
    const lookup: LookupRelatedNode = {
      joinConditions: [{ inputColumn: 'id', lookupColumn: 'notification_id' }],
      kind: 'lookup-related',
      lookupTable: 'posts',
      timeCondition: {
        afterInput: true,
        inputTimeColumn: 'created_at_ms',
        lookupTimeColumn: 'created_at_ms',
        windowMs: 120000,
      },
    }
    const output: OutputNodeV2 = {
      kind: 'output-v2',
      pagination: { limit: 25 },
      sort: { direction: 'DESC', field: 'created_at_ms' },
    }
    const plan: QueryPlanV2 = {
      edges: [
        { source: gId, target: lId },
        { source: lId, target: oId },
      ],
      nodes: [
        { id: gId, node: getIds },
        { id: lId, node: lookup },
        { id: oId, node: output },
      ],
      version: 2,
    }
    const v1 = queryPlanV2ToQueryPlanV1(plan)
    expect(v1.source.table).toBe('posts')
    expect(v1.filters[0]).toMatchObject({
      kind: 'aerial-reply-filter',
      timeWindowMs: 120000,
    })
    expect(v1.pagination.limit).toBe(25)
  })

  it('legacyV1Overlay のフィルタを V1 の filters に載せる', () => {
    const v1In = simplePostsPlan()
    const v2 = migrateQueryPlanV1ToV2(v1In)
    v2.legacyV1Overlay = {
      filters: [
        {
          apply: ['mute'],
          kind: 'moderation-filter',
          serverIds: [1, 2],
        },
      ],
    }
    const v1 = queryPlanV2ToQueryPlanV1(v2)
    expect(v1.filters.some((f) => f.kind === 'moderation-filter')).toBe(true)
  })
})
