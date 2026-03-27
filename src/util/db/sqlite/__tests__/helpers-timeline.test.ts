import { buildTimelineKey } from 'util/db/sqlite/helpers/timeline'
import { describe, expect, it } from 'vitest'

describe('buildTimelineKey', () => {
  it('"home" タイムラインキーを生成する', () => {
    expect(buildTimelineKey('home')).toBe('home')
  })

  it('"local" タイムラインキーを生成する', () => {
    expect(buildTimelineKey('local')).toBe('local')
  })

  it('"public" タイムラインキーを生成する', () => {
    expect(buildTimelineKey('public')).toBe('public')
  })

  it('"public:local" タイムラインキーを生成する', () => {
    expect(buildTimelineKey('public:local')).toBe('public:local')
  })

  it('タグ付きタイムラインキーを生成する', () => {
    expect(buildTimelineKey('tag', { tag: '技術' })).toBe('tag:技術')
  })

  it('タグが未指定の場合は空文字で生成する', () => {
    expect(buildTimelineKey('tag')).toBe('tag:')
    expect(buildTimelineKey('tag', {})).toBe('tag:')
  })

  it('リスト付きタイムラインキーを生成する', () => {
    expect(buildTimelineKey('list', { listId: '12345' })).toBe('list:12345')
  })

  it('リストIDが未指定の場合は空文字で生成する', () => {
    expect(buildTimelineKey('list')).toBe('list:')
    expect(buildTimelineKey('list', {})).toBe('list:')
  })

  it('ユーザータイムラインキーを生成する', () => {
    expect(buildTimelineKey('user', { acct: 'alice@example.com' })).toBe(
      'user:alice@example.com',
    )
  })

  it('acctが未指定の場合は空文字で生成する', () => {
    expect(buildTimelineKey('user')).toBe('user:')
    expect(buildTimelineKey('user', {})).toBe('user:')
  })

  it('不明なタイプの場合そのまま返す', () => {
    expect(buildTimelineKey('unknown_type')).toBe('unknown_type')
    expect(buildTimelineKey('custom')).toBe('custom')
    expect(buildTimelineKey('notifications')).toBe('notifications')
  })
})
