import { describe, expect, it } from 'vitest'
import { validateQueryPlanV2 } from './validateV2'

describe('validateQueryPlanV2', () => {
  it('output がないとエラー', () => {
    const r = validateQueryPlanV2({
      edges: [],
      nodes: [
        { id: 'a', node: { filters: [], kind: 'get-ids', table: 'posts' } },
      ],
      version: 2,
    })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes('output'))).toBe(true)
  })

  it('getIds + output の有効なプランは valid', () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    const r = validateQueryPlanV2({
      edges: [{ source: a, target: b }],
      nodes: [
        { id: a, node: { filters: [], kind: 'get-ids', table: 'posts' } },
        {
          id: b,
          node: {
            kind: 'output-v2',
            pagination: { limit: 50 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    })
    expect(r.valid).toBe(true)
    expect(r.errors).toHaveLength(0)
  })
})
