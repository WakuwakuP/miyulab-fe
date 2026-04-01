import { describe, expect, it } from 'vitest'
import type { QueryPlan } from '../nodes'
import { migrateQueryPlanV1ToV2 } from './migrateV1ToV2'

describe('migrateQueryPlanV1ToV2', () => {
  it('単一ソースの V1 を getIds + output の V2 に変換する', () => {
    const v1: QueryPlan = {
      composites: [],
      filters: [],
      pagination: { kind: 'pagination', limit: 50 },
      sort: {
        direction: 'DESC',
        field: 'created_at_ms',
        kind: 'sort',
      },
      source: { kind: 'source', table: 'posts' },
    }
    const v2 = migrateQueryPlanV1ToV2(v1)
    expect(v2.version).toBe(2)
    expect(v2.nodes.some((n) => n.node.kind === 'get-ids')).toBe(true)
    expect(v2.nodes.some((n) => n.node.kind === 'output-v2')).toBe(true)
    expect(v2.edges).toHaveLength(1)
  })
})
