import type { QueryPlan } from 'util/db/query-ir/nodes'
import {
  validateFilterNode,
  validateQueryPlan,
} from 'util/db/query-ir/validate'
import { describe, expect, it } from 'vitest'

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    composites: [],
    filters: [],
    pagination: { kind: 'pagination', limit: 20 },
    sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
    source: { kind: 'source', table: 'posts' },
    ...overrides,
  }
}

describe('validateQueryPlan', () => {
  it('空のフィルタで有効な QueryPlan', () => {
    const result = validateQueryPlan(makePlan())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('未登録のソーステーブルでエラー', () => {
    const result = validateQueryPlan(
      makePlan({ source: { kind: 'source', table: 'nonexistent' } }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('nonexistent')
  })

  it('有効な TableFilter でエラーなし', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'language',
            kind: 'table-filter',
            op: 'IN',
            table: 'posts',
            value: ['ja'],
          },
        ],
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('未登録テーブルの TableFilter でエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'x',
            kind: 'table-filter',
            op: '=',
            table: 'nonexistent',
            value: 1,
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('レジストリにないカラムは警告（エラーではない）', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'unknown_col',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 1,
          },
        ],
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('joinPath のないテーブルフィルタでエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'account_acct',
            kind: 'table-filter',
            op: '=',
            table: 'muted_accounts',
            value: 'test',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('整数カラムに文字列値でエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'favourites_count',
            kind: 'table-filter',
            op: '>=',
            table: 'post_stats',
            value: 'not_a_number',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('IS NULL 演算子に値があるとエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'in_reply_to_uri',
            kind: 'table-filter',
            op: 'IS NULL',
            table: 'posts',
            value: 'something',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('IN 演算子に配列でない値でエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            column: 'language',
            kind: 'table-filter',
            op: 'IN',
            table: 'posts',
            value: 'ja',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('ExistsFilter の count モードで countValue なしはエラー', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          { kind: 'exists-filter', mode: 'count-gte', table: 'post_media' },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('有効な ExistsFilter', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
        ],
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('空の BackendFilter は警告', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [{ kind: 'backend-filter', localAccountIds: [] }],
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('RawSQLFilter で禁止 SQL を検出', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [{ kind: 'raw-sql-filter', where: 'DROP TABLE posts' }],
      }),
    )
    expect(result.valid).toBe(false)
  })

  it('安全な RawSQLFilter は有効', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [{ kind: 'raw-sql-filter', where: "p.language = 'ja'" }],
      }),
    )
    expect(result.valid).toBe(true)
  })

  it('MergeNode のサブプランを再帰的にバリデーション', () => {
    const result = validateQueryPlan(
      makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 20,
            sources: [
              makePlan({
                source: { kind: 'source', table: 'nonexistent' },
              }),
            ],
            strategy: 'interleave-by-time',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
  })
})

describe('validateFilterNode', () => {
  it('単一ノードをバリデーションする', () => {
    const result = validateFilterNode(
      {
        column: 'language',
        kind: 'table-filter',
        op: '=',
        table: 'posts',
        value: 'ja',
      },
      'posts',
    )
    expect(result.valid).toBe(true)
  })
})

describe('AerialReplyFilter バリデーション', () => {
  it('有効な空中リプフィルタは valid', () => {
    const result = validateFilterNode(
      {
        kind: 'aerial-reply-filter',
        notificationTypes: ['favourite'],
        timeWindowMs: 180000,
      },
      'posts',
    )
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('空の notificationTypes は warning', () => {
    const result = validateFilterNode(
      {
        kind: 'aerial-reply-filter',
        notificationTypes: [],
        timeWindowMs: 180000,
      },
      'posts',
    )
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain(
      'AerialReplyFilter has empty notificationTypes',
    )
  })

  it('timeWindowMs が 0 以下は error', () => {
    const result = validateFilterNode(
      {
        kind: 'aerial-reply-filter',
        notificationTypes: ['favourite'],
        timeWindowMs: 0,
      },
      'posts',
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'AerialReplyFilter timeWindowMs must be positive',
    )
  })
})
