import type { QueryPlan } from 'util/db/query-ir/nodes'
import { TABLE_REGISTRY } from 'util/db/query-ir/registry'
import {
  determineStrategy,
  resolveAllDependencies,
  resolveTableDependency,
} from 'util/db/query-ir/resolve'
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

describe('determineStrategy', () => {
  it('isSmallLookup テーブルは scalar-subquery', () => {
    expect(determineStrategy(TABLE_REGISTRY.visibility_types)).toBe(
      'scalar-subquery',
    )
  })

  it('preferExists テーブルは exists', () => {
    expect(determineStrategy(TABLE_REGISTRY.post_media)).toBe('exists')
  })

  it('1:N テーブルは exists', () => {
    expect(determineStrategy(TABLE_REGISTRY.timeline_entries)).toBe('exists')
  })

  it('1:1 テーブルは exists', () => {
    expect(determineStrategy(TABLE_REGISTRY.profiles)).toBe('exists')
  })
})

describe('resolveTableDependency', () => {
  it('ソーステーブル自身のカラムは direct', () => {
    const deps = resolveTableDependency(
      {
        column: 'language',
        kind: 'table-filter',
        op: '=',
        table: 'posts',
        value: 'ja',
      },
      'posts',
    )
    expect(deps).toHaveLength(1)
    expect(deps[0].strategy).toBe('direct')
    expect(deps[0].joinPath).toBeNull()
  })

  it('1:1 関連テーブルの依存を解決', () => {
    const deps = resolveTableDependency(
      {
        column: 'acct',
        kind: 'table-filter',
        op: '=',
        table: 'profiles',
        value: 'user@example',
      },
      'posts',
    )
    expect(deps).toHaveLength(1)
    expect(deps[0].table).toBe('profiles')
    expect(deps[0].joinPath).toBeDefined()
    expect(deps[0].strategy).toBe('exists')
  })

  it('lookup テーブルは scalar-subquery', () => {
    const deps = resolveTableDependency(
      {
        column: 'name',
        kind: 'table-filter',
        op: 'IN',
        table: 'visibility_types',
        value: ['public'],
      },
      'posts',
    )
    expect(deps[0].strategy).toBe('scalar-subquery')
  })

  it('ExistsFilter は exists 戦略', () => {
    const deps = resolveTableDependency(
      { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
      'posts',
    )
    expect(deps[0].strategy).toBe('exists')
  })

  it('ExistsFilter の not-exists は not-exists 戦略', () => {
    const deps = resolveTableDependency(
      { kind: 'exists-filter', mode: 'not-exists', table: 'post_media' },
      'posts',
    )
    expect(deps[0].strategy).toBe('not-exists')
  })

  it('BackendFilter は post_backend_ids の exists', () => {
    const deps = resolveTableDependency(
      { kind: 'backend-filter', localAccountIds: [1, 2] },
      'posts',
    )
    expect(deps[0].table).toBe('post_backend_ids')
    expect(deps[0].strategy).toBe('exists')
  })

  it('ModerationFilter は profiles の scalar-subquery', () => {
    const deps = resolveTableDependency(
      { apply: ['mute'], kind: 'moderation-filter' },
      'posts',
    )
    expect(deps[0].table).toBe('profiles')
    expect(deps[0].strategy).toBe('scalar-subquery')
  })

  it('TimelineScope は timeline_entries の inner-join', () => {
    const deps = resolveTableDependency(
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      'posts',
    )
    expect(deps[0].table).toBe('timeline_entries')
    expect(deps[0].strategy).toBe('inner-join')
  })

  it('RawSQLFilter は referencedTables から解決', () => {
    const deps = resolveTableDependency(
      {
        kind: 'raw-sql-filter',
        referencedTables: ['profiles', 'post_stats'],
        where: 'p.language = ?',
      },
      'posts',
    )
    expect(deps).toHaveLength(2)
    expect(deps.map((d) => d.table)).toEqual(['profiles', 'post_stats'])
  })

  it('未登録テーブルは空配列を返す', () => {
    const deps = resolveTableDependency(
      {
        column: 'x',
        kind: 'table-filter',
        op: '=',
        table: 'nonexistent',
        value: 1,
      },
      'posts',
    )
    expect(deps).toHaveLength(0)
  })
})

describe('resolveAllDependencies', () => {
  it('複数フィルタの依存をまとめて解決する', () => {
    const deps = resolveAllDependencies(
      makePlan({
        filters: [
          {
            column: 'acct',
            kind: 'table-filter',
            op: '=',
            table: 'profiles',
            value: 'user',
          },
          { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
          { kind: 'backend-filter', localAccountIds: [1] },
        ],
      }),
    )
    expect(deps.map((d) => d.table)).toContain('profiles')
    expect(deps.map((d) => d.table)).toContain('post_media')
    expect(deps.map((d) => d.table)).toContain('post_backend_ids')
  })

  it('同一テーブルの重複を排除する', () => {
    const deps = resolveAllDependencies(
      makePlan({
        filters: [
          {
            column: 'acct',
            kind: 'table-filter',
            op: '=',
            table: 'profiles',
            value: 'a',
          },
          {
            column: 'domain',
            kind: 'table-filter',
            op: '=',
            table: 'profiles',
            value: 'b',
          },
        ],
      }),
    )
    const profileDeps = deps.filter((d) => d.table === 'profiles')
    expect(profileDeps).toHaveLength(1)
  })
})

describe('AerialReplyFilter 依存解決', () => {
  it('空中リプフィルタは外部依存なし (自己完結サブクエリ)', () => {
    const deps = resolveTableDependency(
      {
        kind: 'aerial-reply-filter',
        notificationTypes: ['favourite'],
        timeWindowMs: 180000,
      },
      'posts',
    )
    expect(deps).toHaveLength(0)
  })
})
