/**
 * handleEnforceMaxLength — バッチ化 / emergency モード / hasMore 応答のテスト
 */

import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { handleEnforceMaxLength } from 'util/db/sqlite/worker/workerCleanup'
import { describe, expect, it, vi } from 'vitest'

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * Mock DB. selectResults はクエリの登場順に返す。
 * GROUP BY HAVING クエリ (2 個)、その後 SELECT changes() のレスポンス (削除回数分) を順に返す。
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
        // timeline GROUP BY: 1 グループ、超過 3 件
        [[1, 'home', 8]],
        // timeline DELETE changes()
        [[3]],
        // notification GROUP BY: 空
        [],
        // orphan DELETE changes()
        [[2]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100, { batchLimit: 10000 })

      expect(result.hasMore).toBe(false)
      expect(result.deletedCounts.timeline_entries).toBe(3)
      expect(result.deletedCounts.posts).toBe(2)
    })

    it('timeline の超過が batchLimit を超えれば hasMore=true', () => {
      const { db } = createMockDb([
        // timeline GROUP BY: 1 グループ、超過 15000 件 (batchLimit=10000 超)
        [[1, 'home', 15005]],
        // timeline DELETE changes() — 10000 件削除
        [[10000]],
        // notification GROUP BY: budget=0 なので削除は発生しないが常に呼ばれる
      ])

      const result = handleEnforceMaxLength(db, 5, 100, { batchLimit: 10000 })

      expect(result.hasMore).toBe(true)
      expect(result.deletedCounts.timeline_entries).toBe(10000)
    })

    it('orphan 削除がバッチ上限に達したら hasMore=true', () => {
      const { db } = createMockDb([
        // timeline GROUP BY: 超過あり（orphan が動く条件）
        [[1, 'home', 6]],
        // timeline DELETE changes()
        [[1]],
        // notification GROUP BY: 空
        [],
        // orphan DELETE changes() — batchLimit ちょうど
        [[10000]],
      ])

      const result = handleEnforceMaxLength(db, 5, 100, { batchLimit: 10000 })

      expect(result.hasMore).toBe(true)
      expect(result.deletedCounts.posts).toBe(10000)
    })
  })

  describe('emergency mode', () => {
    it('mode=emergency はグループサイズが maxTimeline 以下でも発火する', () => {
      const { db, calls } = createMockDb([
        // maxTimeline=100000 だが emergency モードなので threshold=0 で拾う
        [[1, 'home', 1000]],
        [[500]],
        // notification GROUP BY: 空
        [],
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 100000, 100000, {
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
        // emergency モードでは threshold=0 になるため、
        // periodic 条件では超過しないグループも対象になる
        [[1, 'home', 1000]],
        // timeline DELETE changes()
        [[500]],
        // notification GROUP BY: 空
        [],
        // orphan DELETE changes()
        [[0]],
      ])

      const result = handleEnforceMaxLength(db, 0, 0, {
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
        // 巨大グループ: 50000 件、emergency で excess = 25000 件
        [[1, 'home', 50000]],
        // timeline DELETE changes() — batchLimit=10000 ぶん
        [[10000]],
        // notification GROUP BY (budget=0 なので削除は発生しないが hasRemainingExcess を確認)
      ])

      const result = handleEnforceMaxLength(db, 0, 0, {
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
  })

  describe('option デフォルト', () => {
    it('オプション未指定時は periodic モードとして動作する', () => {
      const { db, calls } = createMockDb([[[1, 'home', 8]], [[3]], [], [[0]]])

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
