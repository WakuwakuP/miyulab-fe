import {
  toggleReaction,
  updateInteraction,
} from 'util/db/sqlite/helpers/interaction'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { describe, expect, it, vi } from 'vitest'

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録する。
 */
function createMockDb(): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      return undefined
    }),
  }

  return { calls, db }
}

describe('updateInteraction', () => {
  it('favourite の状態を設定する', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 100, 1, 'favourite', true)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('is_favourited')
    expect(calls[0].opts?.bind).toEqual([100, 1, 1, expect.any(Number)])
  })

  it('reblog の状態を設定する', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 200, 2, 'reblog', true)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('is_reblogged')
    expect(calls[0].opts?.bind).toEqual([200, 2, 1, expect.any(Number)])
  })

  it('bookmark の状態を設定する', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 300, 3, 'bookmark', false)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('is_bookmarked')
    expect(calls[0].opts?.bind).toEqual([300, 3, 0, expect.any(Number)])
  })

  it('mute の状態を設定する', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 400, 4, 'mute', true)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('is_muted')
    expect(calls[0].opts?.bind).toEqual([400, 4, 1, expect.any(Number)])
  })

  it('pin の状態を設定する', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 500, 5, 'pin', false)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('is_pinned')
    expect(calls[0].opts?.bind).toEqual([500, 5, 0, expect.any(Number)])
  })

  it('既存レコードがある場合は UPDATE する（UPSERT）', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 100, 1, 'favourite', true)
    updateInteraction(db, 100, 1, 'favourite', false)

    expect(calls).toHaveLength(2)

    // 両方とも UPSERT SQL（ON CONFLICT … DO UPDATE）が発行される
    expect(calls[0].sql).toContain('ON CONFLICT')
    expect(calls[0].sql).toContain('DO UPDATE SET')
    expect(calls[0].opts?.bind).toEqual([100, 1, 1, expect.any(Number)])

    expect(calls[1].sql).toContain('ON CONFLICT')
    expect(calls[1].sql).toContain('DO UPDATE SET')
    expect(calls[1].opts?.bind).toEqual([100, 1, 0, expect.any(Number)])
  })

  it('不明なアクション名の場合何もしない', () => {
    const { db, calls } = createMockDb()

    updateInteraction(db, 100, 1, 'unknown_action', true)

    expect(calls).toHaveLength(0)
    expect(db.exec).not.toHaveBeenCalled()
  })
})

describe('toggleReaction', () => {
  it('リアクションを設定する（name + url）', () => {
    const { db, calls } = createMockDb()

    toggleReaction(db, 100, 1, '👍', 'https://example.com/thumbsup.png')

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('my_reaction_name')
    expect(calls[0].sql).toContain('my_reaction_url')
    expect(calls[0].sql).toContain('ON CONFLICT')
    expect(calls[0].sql).toContain('DO UPDATE SET')
    expect(calls[0].opts?.bind).toEqual([
      100,
      1,
      '👍',
      'https://example.com/thumbsup.png',
      expect.any(Number),
    ])
  })

  it('リアクションをクリアする（null）', () => {
    const { db, calls } = createMockDb()

    toggleReaction(db, 100, 1, null, null)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('my_reaction_name')
    expect(calls[0].sql).toContain('my_reaction_url')
    expect(calls[0].opts?.bind).toEqual([
      100,
      1,
      null,
      null,
      expect.any(Number),
    ])
  })
})
