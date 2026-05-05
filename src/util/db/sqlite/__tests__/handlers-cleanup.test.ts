import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { handleEnforceMaxLength } from 'util/db/sqlite/worker/workerCleanup'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * returnValue === 'resultRows' の呼び出しに対して、
 * selectResults を順番に返す Mock DB を作成する。
 *
 * クエリ順 (v2.0.x — 全体合計判定):
 *
 * Phase 1 (timeline + notifications):
 *   - SELECT COUNT(*) FROM timeline_entries
 *   - (超過していれば) SELECT changes()
 *   - SELECT COUNT(*) FROM notifications
 *   - (超過していれば) SELECT changes()
 *
 * Phase 2 (posts):
 *   - SELECT COUNT(*) FROM posts
 *   - (削除を発行すれば) SELECT changes()
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
  it('タイムライン全体の上限を超えたエントリを削除する', () => {
    const maxTimeline = 5
    const maxNotifications = 100
    const maxPosts = 100000

    const { db, calls } = createMockDb([
      // 1. timeline COUNT — 8 件 (上限 5 を 3 件超過)
      [[8]],
      // 2. timeline DELETE changes()
      [[3]],
      // 3. notifications COUNT — 上限以内
      [[10]],
      // 4. posts COUNT (上限以下、followup で発火)
      [[100]],
      // 5. posts DELETE changes()
      [[0]],
    ])

    const result = handleEnforceMaxLength(
      db,
      maxTimeline,
      maxNotifications,
      maxPosts,
    )

    expect(result.changedTables).toContain('timeline_entries')
    expect(result.changedTables).toContain('posts')
    expect(result.deletedCounts.timeline_entries).toBe(3)

    // Phase 1 BEGIN + COMMIT、Phase 2 BEGIN + COMMIT が両方走る
    const beginCount = calls.filter((c) => c.sql === 'BEGIN;').length
    const commitCount = calls.filter((c) => c.sql === 'COMMIT;').length
    expect(beginCount).toBe(2)
    expect(commitCount).toBe(2)

    // timeline_entries から古いエントリが削除される (全体古い順、グループ条件なし)
    const deleteTimeline = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
    )
    expect(deleteTimeline).toBeDefined()
    // LIMIT = count - maxTimeline = 8 - 5 = 3
    expect(deleteTimeline?.opts?.bind).toContain(3)
    // local_account_id / timeline_key の WHERE 条件は付かない
    expect(deleteTimeline?.sql).not.toContain('local_account_id')
    expect(deleteTimeline?.sql).not.toContain('timeline_key')

    // 孤立 posts の削除クエリが実行される (LEFT JOIN + ORDER BY 古い順)
    const deleteOrphan = calls.find(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('LEFT JOIN') &&
        c.sql.includes('ORDER BY p.created_at_ms ASC'),
    )
    expect(deleteOrphan).toBeDefined()
  })

  it('タイムラインが上限以内なら timeline_entries は削除しない', () => {
    const maxTimeline = 100
    const maxNotifications = 100
    const maxPosts = 100000

    const { db, calls } = createMockDb([
      // 1. timeline COUNT — 上限以内
      [[50]],
      // 2. notifications COUNT — 上限以内
      [[10]],
      // 3. posts COUNT (上限以下)
      [[100]],
    ])

    const result = handleEnforceMaxLength(
      db,
      maxTimeline,
      maxNotifications,
      maxPosts,
    )

    // timeline / notif で削除がなく posts も上限以下なので何も削除されない
    expect(result.changedTables).toEqual([])

    // timeline_entries からの DELETE は実行されない
    const deleteTimeline = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
    )
    expect(deleteTimeline).toBeUndefined()

    // posts DELETE も発行されない (followup なし & 上限以下)
    const deletePosts = calls.find((c) => c.sql.includes('DELETE FROM posts'))
    expect(deletePosts).toBeUndefined()
  })

  it('通知の上限を超えたものを削除する', () => {
    const maxTimeline = 100
    const maxNotifications = 3
    const maxPosts = 100000

    const { db, calls } = createMockDb([
      // 1. timeline COUNT — 上限以内
      [[10]],
      // 2. notifications COUNT — 10 件 (上限 3 を 7 件超過)
      [[10]],
      // 3. notifications DELETE changes()
      [[7]],
      // 4. posts COUNT (上限以下、followup で発火)
      [[100]],
      // 5. posts DELETE changes()
      [[0]],
    ])

    const result = handleEnforceMaxLength(
      db,
      maxTimeline,
      maxNotifications,
      maxPosts,
    )

    expect(result.changedTables).toContain('notifications')
    expect(result.changedTables).toContain('posts')

    // notifications からの DELETE
    const deleteNotif = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('FROM notifications'),
    )
    expect(deleteNotif).toBeDefined()
    // LIMIT = 10 - 3 = 7
    expect(deleteNotif?.opts?.bind).toContain(7)
    // local_account_id の WHERE 条件は付かない (全体合計判定)
    expect(deleteNotif?.sql).not.toContain('local_account_id')

    // 孤立 posts の削除クエリが実行される
    const deleteOrphan = calls.find(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('LEFT JOIN'),
    )
    expect(deleteOrphan).toBeDefined()
  })

  it('孤立投稿を削除する (timeline+notif 削除に追従)', () => {
    const maxTimeline = 2
    const maxNotifications = 2
    const maxPosts = 100000

    const { db, calls } = createMockDb([
      // 1. timeline COUNT — 5 件 (3 件超過)
      [[5]],
      // 2. timeline DELETE changes()
      [[3]],
      // 3. notifications COUNT — 4 件 (2 件超過)
      [[4]],
      // 4. notifications DELETE changes()
      [[2]],
      // 5. posts COUNT
      [[100]],
      // 6. posts DELETE changes()
      [[5]],
    ])

    handleEnforceMaxLength(db, maxTimeline, maxNotifications, maxPosts)

    // 孤立 posts の削除は少なくとも 1 回呼ばれる
    const deleteOrphanCalls = calls.filter(
      (c) =>
        c.sql.includes('DELETE') &&
        c.sql.includes('posts') &&
        c.sql.includes('LEFT JOIN'),
    )
    expect(deleteOrphanCalls.length).toBeGreaterThanOrEqual(1)

    // timeline_entries と notifications の両方を LEFT JOIN でチェック
    const orphanSql = deleteOrphanCalls[0].sql
    expect(orphanSql).toContain('timeline_entries')
    expect(orphanSql).toContain('notifications')
    expect(orphanSql).toContain('IS NULL')

    // posts 自己参照 (reblog_of_post_id / quote_of_post_id) も除外されること。
    // これらは ON DELETE 指定がない FK のため、参照元がある行を削除すると
    // SQLITE_CONSTRAINT_FOREIGNKEY が発生する。
    expect(orphanSql).toContain('reblog_of_post_id')
    expect(orphanSql).toContain('quote_of_post_id')

    // 古い順で削除する
    expect(orphanSql).toContain('ORDER BY p.created_at_ms ASC')
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

    expect(() => handleEnforceMaxLength(db, 100, 100, 100000)).toThrow(
      'DB error',
    )

    const rollback = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollback).toBeDefined()
  })

  it('デフォルトの maxNotifications / maxPosts が使用される', () => {
    const { db, calls } = createMockDb([
      // timeline COUNT — 上限以内
      [[100]],
      // notifications COUNT — 上限以内
      [[100]],
      // posts COUNT (デフォルト 100000 以下)
      [[1000]],
    ])

    // maxNotifications / maxPosts を省略して呼び出し
    handleEnforceMaxLength(db, 100)

    // エラーなく完了する: 2 つのトランザクションが完了
    const beginCount = calls.filter((c) => c.sql === 'BEGIN;').length
    const commitCount = calls.filter((c) => c.sql === 'COMMIT;').length
    expect(beginCount).toBe(2)
    expect(commitCount).toBe(2)
  })

  it('posts 上限超過のみで timeline/notif 削除がなくても posts を削減する', () => {
    const { db, calls } = createMockDb([
      // 1. timeline COUNT — 上限以内
      [[100]],
      // 2. notifications COUNT — 上限以内
      [[100]],
      // 3. posts COUNT: 上限超過
      [[101000]],
      // 4. posts DELETE changes()
      [[1000]],
    ])

    const result = handleEnforceMaxLength(db, 100000, 100000, 100000)

    // posts DELETE が発行される
    const deletePosts = calls.find(
      (c) =>
        c.sql.includes('DELETE FROM posts') &&
        c.sql.includes('LEFT JOIN') &&
        c.sql.includes('ORDER BY p.created_at_ms ASC'),
    )
    expect(deletePosts).toBeDefined()
    expect(result.deletedCounts.posts).toBe(1000)
    expect(result.changedTables).toContain('posts')
  })
})
