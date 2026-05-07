/**
 * handleEnforceMaxLength — バッチ化 / emergency モード / hasMore 応答のテスト
 */

import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { handleEnforceMaxLength } from 'util/db/sqlite/worker/workerCleanup'
import { describe, expect, it, vi } from 'vitest'

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * Mock DB. selectResults はクエリの登場順に返す。
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

describe('handleEnforceMaxLength — batching & modes', () => {
  describe('hasMore レスポンス', () => {
    it('batchLimit を超えない削除なら hasMore=false', () => {
      const { db } = createMockDb([
        // timeline COUNT — 8 件 (上限 5 を 3 件超過)
        [[8]],
        // timeline DELETE changes()
        [[3]],
        // notifications COUNT — 上限以内
        [[10]],
        // posts COUNT — 上限以下 (forceCleanup=true で発火)
        [[100]],
        // posts DELETE changes()
        [[2]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100, 100000, {
        batchLimit: 10000,
      })

      expect(result.hasMore).toBe(false)
      expect(result.deletedCounts.timeline_entries).toBe(3)
      expect(result.deletedCounts.posts).toBe(2)
    })

    it('timeline の超過が batchLimit を超えれば hasMore=true', () => {
      const { db } = createMockDb([
        // timeline COUNT — 15005 件 (超過 15000、batchLimit=10000 超)
        [[15005]],
        // timeline DELETE changes() — 10000 件削除
        [[10000]],
        // (notifications は予算枯渇で skip)
        // Phase 2: posts COUNT — needPostsFollowup=true で発火
        [[100]],
        // posts DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100, 100000, {
        batchLimit: 10000,
      })

      expect(result.hasMore).toBe(true)
      expect(result.deletedCounts.timeline_entries).toBe(10000)
    })

    it('posts 削除がバッチ上限に達したら hasMore=true', () => {
      const { db } = createMockDb([
        // timeline COUNT — 6 件 (1 件超過 → followup を発火させる)
        [[6]],
        // timeline DELETE changes()
        [[1]],
        // notifications COUNT — 上限以内
        [[10]],
        // posts COUNT — 上限以下
        [[100]],
        // posts DELETE changes() — batchLimit ちょうど
        [[10000]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100, 100000, {
        batchLimit: 10000,
      })

      expect(result.hasMore).toBe(true)
      expect(result.deletedCounts.posts).toBe(10000)
    })

    it('posts 総件数が maxPosts を超えていれば timeline 削除なしでも posts を削減する', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT — 上限以内
        [[100]],
        // notifications COUNT — 上限以内
        [[100]],
        // posts COUNT — 上限超過 (101000 - 100000 = 1000 件超過)
        [[101000]],
        // posts DELETE changes() — 1000 件削除
        [[1000]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
      })

      // posts DELETE が呼ばれており、孤立かつ古い順条件付き
      const deletePosts = calls.find(
        (c) =>
          c.sql.includes('DELETE FROM posts') &&
          c.sql.includes('LEFT JOIN') &&
          c.sql.includes('ORDER BY p.created_at_ms ASC'),
      )
      expect(deletePosts).toBeDefined()
      // limit = min(excess=1000, budget=10000) = 1000
      expect(deletePosts?.opts?.bind).toContain(1000)
      expect(result.deletedCounts.posts).toBe(1000)
      // excess (1000) === deleted (1000) なので hasRemainingExcess=false
      expect(result.hasMore).toBe(false)
    })

    it('posts 上限超過分が batchLimit を超えれば hasMore=true', () => {
      const { db } = createMockDb([
        // timeline COUNT — 上限以内
        [[100]],
        // notifications COUNT — 上限以内
        [[100]],
        // posts COUNT — 大幅超過
        [[150000]],
        // posts DELETE changes() — batchLimit ぶん
        [[10000]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
      })

      // excess = 150000 - 100000 = 50000、deleted = 10000、まだ残っている
      expect(result.hasMore).toBe(true)
      expect(result.deletedCounts.posts).toBe(10000)
    })

    it('posts 上限以内かつ followup なしなら posts 削除はスキップされる', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT — 上限以内
        [[100]],
        // notifications COUNT — 上限以内
        [[100]],
        // posts COUNT — 上限以下
        [[5000]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
      })

      // posts DELETE は呼ばれない
      const deletePosts = calls.find((c) => c.sql.includes('DELETE FROM posts'))
      expect(deletePosts).toBeUndefined()
      expect(result.deletedCounts.posts).toBe(0)
      expect(result.hasMore).toBe(false)
    })

    it('posts が全件参照されていて削除ゼロなら hasRemainingExcess=false でループを抜ける', () => {
      const { db } = createMockDb([
        // timeline COUNT — 上限以内
        [[100]],
        // notifications COUNT — 上限以内
        [[100]],
        // posts COUNT — 大幅超過だが…
        [[200000]],
        // posts DELETE changes() — 全件参照されていて 0 件削除
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
      })

      // deleted === 0 のとき hasRemainingExcess は false (無限ループ防止)
      expect(result.hasMore).toBe(false)
      expect(result.deletedCounts.posts).toBe(0)
    })
  })

  describe('emergency mode', () => {
    it('mode=emergency は cnt が maxTimeline 以下でも発火する', () => {
      const { db, calls } = createMockDb([
        // maxTimeline=100000 だが emergency モードなので targetRatio=0.5 で発火
        // timeline COUNT
        [[1000]],
        // timeline DELETE changes()
        [[500]],
        // notifications COUNT — 0 件
        [[0]],
        // posts COUNT
        [[100]],
        // posts DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
        mode: 'emergency',
        targetRatio: 0.5,
      })

      const deleteTimeline = calls.find(
        (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
      )
      // excess = 1000 - floor(1000*0.5) = 500
      expect(deleteTimeline?.opts?.bind).toContain(500)
      expect(result.deletedCounts.timeline_entries).toBe(500)
    })

    it('mode=emergency, targetRatio=0.5 で cnt の半分を残す (1000 → 500 削除)', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT
        [[1000]],
        // timeline DELETE changes()
        [[500]],
        // notifications COUNT — 0 件
        [[0]],
        // posts COUNT
        [[100]],
        // posts DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 0, 0, 0, {
        batchLimit: 10000,
        mode: 'emergency',
        targetRatio: 0.5,
      })

      // emergency モード: excess = cnt - floor(cnt * 0.5) = 1000 - 500 = 500
      const deleteTimeline = calls.find(
        (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
      )
      expect(deleteTimeline?.opts?.bind).toContain(500)
      expect(result.deletedCounts.timeline_entries).toBe(500)
    })

    it('mode=emergency で batchLimit を超える場合、バッチぶんだけ削除し hasMore=true', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT — 50000 件、emergency で excess = 25000 件
        [[50000]],
        // timeline DELETE changes() — batchLimit=10000 ぶん
        [[10000]],
        // (notif は予算枯渇で skip)
        // posts COUNT
        [[100]],
        // posts DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 0, 0, 0, {
        batchLimit: 10000,
        mode: 'emergency',
        targetRatio: 0.5,
      })

      const deleteTimeline = calls.find(
        (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
      )
      // 最初のバッチ: min(excess=25000, budget=10000) = 10000
      expect(deleteTimeline?.opts?.bind).toContain(10000)
      expect(result.hasMore).toBe(true)
    })

    it('mode=emergency は posts 総件数の cnt * targetRatio まで削減する', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT — 0 件
        [[0]],
        // notifications COUNT — 0 件
        [[0]],
        // posts COUNT — 1000 件
        [[1000]],
        // posts DELETE changes() — 500 件
        [[500]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, 100000, {
        batchLimit: 10000,
        mode: 'emergency',
        targetRatio: 0.5,
      })

      // emergency: target = floor(1000 * 0.5) = 500、excess = 500
      const deletePosts = calls.find((c) => c.sql.includes('DELETE FROM posts'))
      expect(deletePosts?.opts?.bind).toContain(500)
      expect(result.deletedCounts.posts).toBe(500)
    })
  })

  describe('option デフォルト', () => {
    it('オプション未指定時は periodic モードとして動作する', () => {
      const { db, calls } = createMockDb([
        // timeline COUNT — 8 件 (3 件超過)
        [[8]],
        // timeline DELETE changes()
        [[3]],
        // notifications COUNT — 上限以内
        [[10]],
        // posts COUNT
        [[100]],
        // posts DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100)

      const deleteTimeline = calls.find(
        (c) => c.sql.includes('DELETE') && c.sql.includes('timeline_entries'),
      )
      // periodic: excess = 8 - 5 = 3
      expect(deleteTimeline?.opts?.bind).toContain(3)
      expect(result.hasMore).toBe(false)
    })
  })
})
