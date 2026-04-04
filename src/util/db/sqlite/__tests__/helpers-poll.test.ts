import { syncPollData, syncPollVotes } from 'util/db/sqlite/helpers/poll'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { describe, expect, it, vi } from 'vitest'

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録し、SELECT クエリに対して指定された行を返す。
 */
function createMockDb(selectRows: number[][] = []): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        return selectRows
      }
      return undefined
    }),
  }

  return { calls, db }
}

describe('syncPollData', () => {
  it('投票データをDBに保存する（UPSERT）', () => {
    const { db, calls } = createMockDb([[42]])

    syncPollData(db, 100, {
      expired: false,
      expires_at: '2025-01-01T00:00:00Z',
      id: 'poll-abc',
      multiple: false,
      options: [
        { title: 'Option A', votes_count: 6 },
        { title: 'Option B', votes_count: 4 },
      ],
      votes_count: 10,
    })

    // 最初の呼び出しは polls への UPSERT
    expect(calls[0].sql).toContain('INSERT INTO polls')
    expect(calls[0].sql).toContain('ON CONFLICT(post_id) DO UPDATE SET')
    expect(calls[0].opts?.bind).toEqual([
      100,
      'poll-abc',
      '2025-01-01T00:00:00Z',
      0,
      0,
      10,
    ])
  })

  it('投票オプションを同期する（DELETE + INSERT）', () => {
    const { db, calls } = createMockDb([[42]])

    syncPollData(db, 100, {
      options: [
        { title: 'Option A', votes_count: 6 },
        { title: 'Option B', votes_count: 4 },
      ],
    })

    // SELECT id FROM polls WHERE post_id = ?
    const selectCall = calls.find((c) => c.sql.includes('SELECT id FROM polls'))
    expect(selectCall).toBeDefined()
    expect(selectCall?.opts?.bind).toEqual([100])

    // DELETE FROM poll_options WHERE poll_id = ?
    const deleteCall = calls.find((c) =>
      c.sql.includes('DELETE FROM poll_options'),
    )
    expect(deleteCall).toBeDefined()
    expect(deleteCall?.opts?.bind).toEqual([42])

    // INSERT INTO poll_options — multi-value INSERT で1回
    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO poll_options'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].opts?.bind).toEqual([
      42,
      0,
      'Option A',
      6,
      42,
      1,
      'Option B',
      4,
    ])
  })

  it('既存の投票データを更新する', () => {
    const { db, calls } = createMockDb([[42]])

    // 1回目の保存
    syncPollData(db, 100, {
      expired: false,
      expires_at: '2025-01-01T00:00:00Z',
      id: 'poll-abc',
      multiple: false,
      options: [{ title: 'Option A', votes_count: 6 }],
      votes_count: 10,
    })

    const firstCallCount = calls.length

    // 2回目の保存（更新）
    syncPollData(db, 100, {
      expired: true,
      expires_at: '2025-01-01T00:00:00Z',
      id: 'poll-abc',
      multiple: false,
      options: [{ title: 'Option A', votes_count: 20 }],
      votes_count: 20,
    })

    // UPSERT SQL が2回発行される
    const upsertCalls = calls.filter(
      (c) =>
        c.sql.includes('INSERT INTO polls') &&
        c.sql.includes('ON CONFLICT(post_id) DO UPDATE SET'),
    )
    expect(upsertCalls).toHaveLength(2)

    // 2回目は expired=1, votes_count=20
    expect(upsertCalls[1].opts?.bind).toEqual([
      100,
      'poll-abc',
      '2025-01-01T00:00:00Z',
      1,
      0,
      20,
    ])

    // 2回目のオプション INSERT
    const secondInsertCalls = calls
      .slice(firstCallCount)
      .filter((c) => c.sql.includes('INSERT INTO poll_options'))
    expect(secondInsertCalls).toHaveLength(1)
    expect(secondInsertCalls[0].opts?.bind).toEqual([42, 0, 'Option A', 20])
  })

  it('poll が null の場合何もしない', () => {
    const { db, calls } = createMockDb()

    syncPollData(db, 100, null)

    expect(calls).toHaveLength(0)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('poll が undefined の場合何もしない', () => {
    const { db, calls } = createMockDb()

    syncPollData(db, 100, undefined)

    expect(calls).toHaveLength(0)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('poll_local_id を保存する', () => {
    const { db, calls } = createMockDb([[1]])

    syncPollData(db, 100, {
      id: 'local-id-999',
      options: [{ title: 'Yes' }],
    })

    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO polls'))
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.sql).toContain('poll_local_id')
    expect(upsertCall?.opts?.bind?.[1]).toBe('local-id-999')
  })

  it('expired 状態を保存する', () => {
    const { db: db1, calls: calls1 } = createMockDb([[1]])

    syncPollData(db1, 100, {
      expired: true,
      options: [{ title: 'A' }],
    })

    const upsert1 = calls1.find((c) => c.sql.includes('INSERT INTO polls'))
    expect(upsert1).toBeDefined()
    expect(upsert1?.sql).toContain('expired')
    // expired = true → 1
    expect(upsert1?.opts?.bind?.[3]).toBe(1)

    const { db: db2, calls: calls2 } = createMockDb([[2]])

    syncPollData(db2, 200, {
      expired: false,
      options: [{ title: 'B' }],
    })

    const upsert2 = calls2.find((c) => c.sql.includes('INSERT INTO polls'))
    expect(upsert2).toBeDefined()
    // expired = false → 0
    expect(upsert2?.opts?.bind?.[3]).toBe(0)
  })

  it('poll_options の votes_count が null の場合 null を保存する', () => {
    const { db, calls } = createMockDb([[1]])

    syncPollData(db, 100, {
      options: [{ title: 'A', votes_count: null }],
    })

    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_options'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall?.opts?.bind).toEqual([1, 0, 'A', null])
  })

  it('SELECT で行が返らない場合 options の同期をスキップする', () => {
    const { db, calls } = createMockDb([]) // 空の結果

    syncPollData(db, 100, {
      options: [{ title: 'A' }],
    })

    // UPSERT と SELECT は呼ばれるが、DELETE と INSERT INTO poll_options は呼ばれない
    const deleteCall = calls.find((c) =>
      c.sql.includes('DELETE FROM poll_options'),
    )
    expect(deleteCall).toBeUndefined()

    const insertOptionCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_options'),
    )
    expect(insertOptionCall).toBeUndefined()
  })
})

describe('syncPollVotes', () => {
  it('投票状態を同期する（UPSERT）', () => {
    const { db, calls } = createMockDb([[42]])

    syncPollVotes(db, 100, 1, true, [0, 2])

    // SELECT id FROM polls WHERE post_id = ?
    const selectCall = calls.find((c) => c.sql.includes('SELECT id FROM polls'))
    expect(selectCall).toBeDefined()
    expect(selectCall?.opts?.bind).toEqual([100])

    // INSERT INTO poll_votes ... ON CONFLICT ... DO UPDATE SET
    const upsertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_votes'),
    )
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.sql).toContain(
      'ON CONFLICT(poll_id, local_account_id) DO UPDATE SET',
    )
    expect(upsertCall?.opts?.bind).toEqual([42, 1, 1, '[0,2]'])
  })

  it('voted フラグと own_votes_json を保存する', () => {
    const { db, calls } = createMockDb([[10]])

    syncPollVotes(db, 200, 5, false, [])

    const upsertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_votes'),
    )
    expect(upsertCall).toBeDefined()
    // voted = false → 0, own_votes = []
    expect(upsertCall?.opts?.bind).toEqual([10, 5, 0, '[]'])
  })

  it('poll が存在しない場合何もしない', () => {
    const { db, calls } = createMockDb([]) // 空の結果

    syncPollVotes(db, 999, 1, true, [0])

    // SELECT は呼ばれるが INSERT は呼ばれない
    const selectCall = calls.find((c) => c.sql.includes('SELECT id FROM polls'))
    expect(selectCall).toBeDefined()

    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_votes'),
    )
    expect(insertCall).toBeUndefined()
  })

  it('own_votes の配列を JSON 文字列として保存する', () => {
    const { db, calls } = createMockDb([[7]])

    syncPollVotes(db, 300, 2, true, [1, 3, 5])

    const upsertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO poll_votes'),
    )
    expect(upsertCall).toBeDefined()
    expect(upsertCall?.opts?.bind?.[3]).toBe('[1,3,5]')
  })
})
