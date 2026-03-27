import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  handleDeleteEvent,
  handleRemoveFromTimeline,
} from 'util/db/sqlite/worker/handlers/timelineHandlers'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * SQL パターンに基づいて異なる結果を返す Mock DB を作成する。
 * queryMap: SQL の部分文字列 → 返すべき resultRows のリスト（呼び出し順）
 */
function createMockDb(queryMap: Record<string, unknown[][][]> = {}): {
  db: DbExecCompat
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  const counters: Record<string, number> = {}

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })

      if (opts?.returnValue === 'resultRows') {
        // queryMap のキーを順番に走査し、SQL に含まれるキーを探す
        for (const pattern of Object.keys(queryMap)) {
          if (sql.includes(pattern)) {
            const idx = counters[pattern] ?? 0
            counters[pattern] = idx + 1
            const results = queryMap[pattern]
            return results[idx] ?? []
          }
        }
        return []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── handleRemoveFromTimeline ───────────────────────────────────

describe('handleRemoveFromTimeline', () => {
  it('タイムラインから投稿を削除する', () => {
    const { db, calls } = createMockDb({
      // 孤立チェック: notifications に残っている → 0件
      notifications: [[[0]]],
      // 孤立チェック: timeline_entries に残っている → 0件
      timeline_entries: [[[0]]],
    })

    const result = handleRemoveFromTimeline(db, 1, 'home', 42)

    expect(result).toEqual({ changedTables: ['posts'] })

    // BEGIN + COMMIT
    expect(calls[0].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')

    // DELETE FROM timeline_entries
    const deleteEntry = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
    )
    expect(deleteEntry).toBeDefined()
    expect(deleteEntry!.opts?.bind).toContain(1) // local_account_id
    expect(deleteEntry!.opts?.bind).toContain('home') // timeline_key
    expect(deleteEntry!.opts?.bind).toContain(42) // post_id

    // 孤立投稿が削除される（timeline_entries=0, notifications=0 なので）
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeDefined()
    expect(deletePost!.opts?.bind).toContain(42)
  })

  it('孤立した投稿をクリーンアップする', () => {
    const { db, calls } = createMockDb({
      notifications: [[[0]]],
      // 孤立チェック: timeline_entries = 0, notifications = 0
      timeline_entries: [[[0]]],
    })

    handleRemoveFromTimeline(db, 1, 'public', 100)

    // posts から DELETE される
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeDefined()
    expect(deletePost!.opts?.bind).toContain(100)
  })

  it('投稿が他のタイムラインにある場合は削除しない', () => {
    const { db, calls } = createMockDb({
      // 孤立チェック: timeline_entries にまだ 2 件残っている
      timeline_entries: [[[2]]],
    })

    const result = handleRemoveFromTimeline(db, 1, 'home', 42)

    expect(result).toEqual({ changedTables: ['posts'] })

    // timeline_entries からの DELETE は実行される
    const deleteEntry = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
    )
    expect(deleteEntry).toBeDefined()

    // posts からの DELETE は実行されない
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeUndefined()
  })

  it('投稿が通知から参照されている場合は削除しない', () => {
    const { db, calls } = createMockDb({
      // しかし notifications に 1 件残っている
      notifications: [[[1]]],
      // timeline_entries には残っていない
      timeline_entries: [[[0]]],
    })

    handleRemoveFromTimeline(db, 1, 'home', 42)

    // posts からの DELETE は実行されない
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeUndefined()
  })

  it('エラー時にROLLBACKする', () => {
    const calls: ExecCall[] = []
    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        // DELETE 時にエラーを投げる
        if (sql.includes('DELETE') && sql.includes('timeline_entries')) {
          throw new Error('DB error')
        }
        return undefined
      }),
    }

    expect(() => handleRemoveFromTimeline(db, 1, 'home', 42)).toThrow(
      'DB error',
    )

    const rollback = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollback).toBeDefined()
  })
})

// ─── handleDeleteEvent ──────────────────────────────────────────

describe('handleDeleteEvent', () => {
  it('post_backend_ids からエントリを削除する', () => {
    const { db, calls } = createMockDb({
      // 2. 他のアカウントの参照チェック → 0 件（参照なし）
      COUNT: [[[0]]],
      // 1. post_backend_ids から post_id を取得 → post_id=10
      post_backend_ids: [[[10]]],
    })

    const result = handleDeleteEvent(db, 1, 'status-abc-123')

    expect(result).toEqual({ changedTables: ['posts'] })

    // post_backend_ids からの SELECT（BEGIN の前に実行される）
    expect(calls[0].sql).toContain('SELECT post_id FROM post_backend_ids')
    expect(calls[0].opts?.bind).toContain(1) // local_account_id
    expect(calls[0].opts?.bind).toContain('status-abc-123') // local_id

    // BEGIN + COMMIT
    expect(calls[1].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')

    // post_backend_ids からの DELETE
    const deleteBackend = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_backend_ids'),
    )
    expect(deleteBackend).toBeDefined()
    expect(deleteBackend!.opts?.bind).toContain(1)
    expect(deleteBackend!.opts?.bind).toContain('status-abc-123')
  })

  it('他のアカウントがまだ参照している場合、投稿は保持する', () => {
    const { db, calls } = createMockDb({
      // 他アカウントの参照 → 1 件残っている
      COUNT: [[[1]]],
      // post_id 取得 → 10
      post_backend_ids: [[[10]]],
    })

    const result = handleDeleteEvent(db, 1, 'status-abc-123')

    expect(result).toEqual({ changedTables: ['posts'] })

    // post_backend_ids からの DELETE は実行される
    const deleteBackend = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_backend_ids'),
    )
    expect(deleteBackend).toBeDefined()

    // posts からの DELETE は実行されない
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeUndefined()
  })

  it('全参照が消えた場合、投稿を削除する', () => {
    const { db, calls } = createMockDb({
      // 他アカウントの参照 → 0（なし）
      COUNT: [[[0]]],
      // post_id 取得 → 10
      post_backend_ids: [[[10]]],
    })

    handleDeleteEvent(db, 1, 'status-abc-123')

    // posts から DELETE される
    const deletePost = calls.find(
      (c) => c.sql.includes('DELETE') && c.sql.includes('posts'),
    )
    expect(deletePost).toBeDefined()
    expect(deletePost!.opts?.bind).toContain(10) // post_id
  })

  it('post_backend_ids にエントリが見つからない場合は何もしない', () => {
    const { db, calls } = createMockDb({
      // post_id 取得 → 結果なし
      post_backend_ids: [[]],
    })

    const result = handleDeleteEvent(db, 1, 'non-existent')

    expect(result).toEqual({ changedTables: [] })

    // DELETE は一切実行されない
    const deleteCalls = calls.filter((c) => c.sql.includes('DELETE'))
    expect(deleteCalls).toHaveLength(0)
  })

  it('エラー時にROLLBACKする', () => {
    const calls: ExecCall[] = []
    let selectCount = 0
    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        if (opts?.returnValue === 'resultRows') {
          selectCount++
          // 最初の SELECT (post_id 取得) は成功
          if (selectCount === 1) return [[10]]
          return []
        }
        // DELETE 時にエラー
        if (sql.includes('DELETE') && sql.includes('post_backend_ids')) {
          throw new Error('DB error')
        }
        return undefined
      }),
    }

    expect(() => handleDeleteEvent(db, 1, 'status-abc')).toThrow('DB error')

    const rollback = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollback).toBeDefined()
  })
})
