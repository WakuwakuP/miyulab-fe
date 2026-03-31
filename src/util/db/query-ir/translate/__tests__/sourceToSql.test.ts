import type { JoinClause } from '../../plan'
import {
  buildJoinString,
  getSourceAlias,
  translateSource,
} from '../sourceToSql'

describe('getSourceAlias', () => {
  it('posts のエイリアスは p', () => {
    expect(getSourceAlias('posts')).toBe('p')
  })

  it('notifications のエイリアスは n', () => {
    expect(getSourceAlias('notifications')).toBe('n')
  })

  it('未知のテーブルは先頭文字を使う', () => {
    expect(getSourceAlias('users')).toBe('u')
  })
})

describe('translateSource', () => {
  it('posts テーブルのデフォルト設定で FROM と ORDER BY を生成する', () => {
    const result = translateSource({ kind: 'source', table: 'posts' })

    expect(result.from).toBe('posts p')
    expect(result.alias).toBe('p')
    expect(result.orderBy).toBe('p.created_at_ms DESC')
  })

  it('notifications テーブルのデフォルト設定で FROM と ORDER BY を生成する', () => {
    const result = translateSource({ kind: 'source', table: 'notifications' })

    expect(result.from).toBe('notifications n')
    expect(result.alias).toBe('n')
    expect(result.orderBy).toBe('n.created_at_ms DESC')
  })

  it('カスタム orderBy と orderDirection を反映する', () => {
    const result = translateSource({
      kind: 'source',
      orderBy: 'id',
      orderDirection: 'ASC',
      table: 'posts',
    })

    expect(result.orderBy).toBe('p.id ASC')
  })
})

describe('buildJoinString', () => {
  it('空の配列で空文字列を返す', () => {
    expect(buildJoinString([])).toBe('')
  })

  it('INNER JOIN を正しく生成する', () => {
    const joins: JoinClause[] = [
      {
        alias: 'te',
        on: 'te.post_id = p.id',
        table: 'timeline_entries',
        type: 'inner',
      },
    ]

    expect(buildJoinString(joins)).toBe(
      'INNER JOIN timeline_entries te ON te.post_id = p.id',
    )
  })

  it('複数の JOIN を結合する', () => {
    const joins: JoinClause[] = [
      {
        alias: 'te',
        on: 'te.post_id = p.id',
        table: 'timeline_entries',
        type: 'inner',
      },
      {
        alias: 'ps',
        on: 'ps.post_id = p.id',
        table: 'post_stats',
        type: 'left',
      },
    ]

    const result = buildJoinString(joins)

    expect(result).toContain(
      'INNER JOIN timeline_entries te ON te.post_id = p.id',
    )
    expect(result).toContain('LEFT JOIN post_stats ps ON ps.post_id = p.id')
  })
})
