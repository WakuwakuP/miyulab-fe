import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { handleEnforceMaxLength } from 'util/db/sqlite/worker/workerCleanup'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * returnValue === 'resultRows' の呼び出しに対して、
 * selectResults を順番に返す Mock DB を作成する。
 */
function createMockDb(selectResults: unknown[][] = []): {
  db: DbExecCompat
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  let selectIndex = 0

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        const result = selectResults[selectIndex]
        selectIndex++
        return result !== undefined ? result : []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── handleEnforceMaxLength ─────────────────────────────────────

describe('handleEnforceMaxLength', () => {
  it('タイムラインの上限を超えた投稿を削除する', () => {
    const maxTimeline = 5
    const maxNotifications = 100

    const { db, calls } = createMockDb([
      // 1. timeline GROUP BY HAVING → 1 グループ: (1, 'home', 8)
      [[1, 'home', 8]],
      // 2. timeline DELETE changes() → 3 件削除
      [[3]],
      // 3. notification GROUP BY HAVING → 上限以内なので空
      [],
      // 4. orphan DELETE changes() → 2 件削除
      [[2]],
    ])

    const result = handleEnforceMaxLength(db, maxTimeline, maxNotifications)

    expect(result.changedTables).toContain('posts')

    // BEGIN + COMMIT
    expect(calls[0].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')

    // timeline_entries から古いエントリが削除される
    const deleteTimeline = calls.find((c) =>
      c.sql.includes('DELETE FROM timeline_entries'),
    )
    expect(deleteTimeline).toBeDefined()
    // LIMIT = count - maxTimeline = 8 - 5 = 3
    expect(deleteTimeline?.opts?.bind).toContain(3)

    // 孤立 posts の削除クエリが実行される
    const deleteOrphan = calls.find(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('NOT EXISTS'),
    )
    expect(deleteOrphan).toBeDefined()
  })

  it('タイムラインが上限以内なら削除しない', () => {
    const maxTimeline = 100
    const maxNotifications = 100

    const { db, calls } = createMockDb([
      // 1. timeline GROUP BY HAVING → 上限以内なので空
      [],
      // 2. notification GROUP BY HAVING → 上限以内なので空
      [],
    ])

    const result = handleEnforceMaxLength(db, maxTimeline, maxNotifications)

    // 何も削除されないので changedTables は空
    expect(result.changedTables).toEqual([])

    // timeline_entries からの DELETE は実行されない
    const deleteTimeline = calls.find((c) =>
      c.sql.includes('DELETE FROM timeline_entries'),
    )
    expect(deleteTimeline).toBeUndefined()
  })

  it('通知の上限を超えたものを削除する', () => {
    const maxTimeline = 100
    const maxNotifications = 3

    const { db, calls } = createMockDb([
      // 1. timeline GROUP BY HAVING → タイムライングループなし
      [],
      // 2. notification GROUP BY HAVING → (local_account_id=1, cnt=10)
      [[1, 10]],
      // 3. notification DELETE changes() → 7 件削除
      [[7]],
      // 4. orphan DELETE changes() → 3 件削除
      [[3]],
    ])

    const result = handleEnforceMaxLength(db, maxTimeline, maxNotifications)

    expect(result.changedTables).toContain('notifications')
    expect(result.changedTables).toContain('posts')

    // notifications からの DELETE
    const deleteNotif = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('notifications'),
    )
    expect(deleteNotif).toBeDefined()
    // LIMIT = 10 - 3 = 7
    expect(deleteNotif?.opts?.bind).toContain(7)

    // 孤立 posts の削除クエリが実行される
    const deleteOrphan = calls.find(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('NOT EXISTS'),
    )
    expect(deleteOrphan).toBeDefined()
  })

  it('孤立投稿を削除する', () => {
    const maxTimeline = 2
    const maxNotifications = 2

    const { db, calls } = createMockDb([
      // 1. timeline GROUP BY HAVING → (1, 'home', 5)
      [[1, 'home', 5]],
      // 2. notification GROUP BY HAVING → (1, 4)
      [[1, 4]],
    ])

    handleEnforceMaxLength(db, maxTimeline, maxNotifications)

    // 孤立 posts の削除は少なくとも 1 回呼ばれる
    const deleteOrphanCalls = calls.filter(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('NOT EXISTS'),
    )
    expect(deleteOrphanCalls.length).toBeGreaterThanOrEqual(1)

    // timeline_entries と notifications の両方を NOT IN チェック
    const orphanSql = deleteOrphanCalls[0].sql
    expect(orphanSql).toContain('timeline_entries')
    expect(orphanSql).toContain('notifications')
  })

  it('複数のタイムライングループを個別に処理する', () => {
    const maxTimeline = 5
    const maxNotifications = 100

    const { db, calls } = createMockDb([
      // 1. timeline GROUP BY HAVING → 2 グループとも超過
      [
        [1, 'home', 10],
        [1, 'local', 8],
      ],
      // 2. notification GROUP BY HAVING → 空
      [],
    ])

    handleEnforceMaxLength(db, maxTimeline, maxNotifications)

    // timeline_entries からの DELETE は 2 回（home と local）
    const deleteTimelines = calls.filter((c) =>
      c.sql.includes('DELETE FROM timeline_entries'),
    )
    expect(deleteTimelines).toHaveLength(2)

    // home の超過分: 10 - 5 = 5
    expect(deleteTimelines[0].opts?.bind).toContain(5)
    // local の超過分: 8 - 5 = 3
    expect(deleteTimelines[1].opts?.bind).toContain(3)
  })

  it('エラー時にROLLBACKする', () => {
    const calls: ExecCall[] = []
    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        // 最初の resultRows クエリでエラーを投げる
        if (opts?.returnValue === 'resultRows') {
          throw new Error('DB error')
        }
        return undefined
      }),
    }

    expect(() => handleEnforceMaxLength(db, 100, 100)).toThrow('DB error')

    const rollback = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollback).toBeDefined()
  })

  it('デフォルトの maxNotifications が使用される', () => {
    const { db, calls } = createMockDb([
      // timeline GROUP BY HAVING → 空
      [],
      // notification GROUP BY HAVING → 空
      [],
    ])

    // maxNotifications を省略して呼び出し
    handleEnforceMaxLength(db, 100)

    // エラーなく完了する
    expect(calls[0].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')
  })
})
