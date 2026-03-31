import type { TableDependency } from '../../resolve'
import { resolveJoinClause } from '../joinResolver'

describe('resolveJoinClause', () => {
  it('joinPath が null の場合、テーブル名と 1=1 を返す', () => {
    const dep: TableDependency = {
      cardinality: '1:1',
      joinPath: null,
      strategy: 'exists',
      table: 'posts',
    }

    const result = resolveJoinClause(dep, 'p')

    expect(result.fromClause).toBe('posts')
    expect(result.finalJoin).toBeNull()
    expect(result.whereClause).toBe('1=1')
  })

  it('直接結合パスの場合、テーブル.カラム = エイリアス.ソースカラム を返す', () => {
    const dep: TableDependency = {
      cardinality: '1:1',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_stats',
    }

    const result = resolveJoinClause(dep, 'p')

    expect(result.fromClause).toBe('post_stats')
    expect(result.finalJoin).toBeNull()
    expect(result.whereClause).toBe('post_stats.post_id = p.id')
  })

  it('via チェーンの場合、中間テーブルとINNER JOINを返す', () => {
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: {
        column: 'id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'post_hashtags',
            toColumn: 'hashtag_id',
          },
        ],
      },
      strategy: 'exists',
      table: 'hashtags',
    }

    const result = resolveJoinClause(dep, 'p')

    expect(result.fromClause).toBe('post_hashtags _via0')
    expect(result.finalJoin).toBe(
      'INNER JOIN hashtags ON hashtags.id = _via0.hashtag_id',
    )
    expect(result.whereClause).toBe('_via0.post_id = p.id')
  })

  it('異なるソースエイリアスでも正しく解決する', () => {
    const dep: TableDependency = {
      cardinality: '1:1',
      joinPath: { column: 'id', sourceColumn: 'actor_profile_id' },
      strategy: 'exists',
      table: 'profiles',
    }

    const result = resolveJoinClause(dep, 'n')

    expect(result.whereClause).toContain('n.actor_profile_id')
  })
})
