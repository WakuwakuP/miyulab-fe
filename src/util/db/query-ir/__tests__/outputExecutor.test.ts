import { describe, expect, it, vi } from 'vitest'
import { executeOutput } from '../executor/outputExecutor'
import type { NodeOutput } from '../executor/types'
import type { OutputNodeV2 } from '../nodes'
import type { NodeOutputRow } from '../plan'

// --------------- ヘルパー ---------------

function mkNode(overrides: Partial<OutputNodeV2> = {}): OutputNodeV2 {
  return {
    kind: 'output-v2',
    pagination: { limit: 100, offset: 0 },
    sort: { direction: 'DESC', field: 'createdAtMs' },
    ...overrides,
  }
}

function mkRow(
  id: number,
  createdAtMs: number,
  table = 'posts',
): NodeOutputRow {
  return { createdAtMs, id, table }
}

function mkInput(rows: NodeOutputRow[], sourceTable = 'posts'): NodeOutput {
  return { hash: 'test', rows, sourceTable }
}

/** db.exec のモック — 呼ばれた回数と引数を記録し空行を返す */
function mockDb() {
  const calls: { sql: string; bind: unknown[] }[] = []
  return {
    calls,
    exec: vi.fn(
      (sql: string, opts: { bind?: unknown[]; returnValue?: string }) => {
        calls.push({ bind: opts.bind ?? [], sql })
        return [] as (string | number | null)[][]
      },
    ),
  }
}

describe('executeOutput', () => {
  // =============================================================
  // --- 空入力 ---
  // =============================================================
  it('ID順が時刻順と異なる場合もIDで並べ、通知の詳細取得には通知IDだけを渡す', () => {
    const db = mockDb()
    const result = executeOutput(
      db,
      mkNode({ sort: { direction: 'ASC', field: 'id' } }),
      mkInput([mkRow(3, 10), mkRow(1, 90, 'notifications'), mkRow(2, 60)]),
      [],
    )
    expect(result.displayOrder.map((row) => row.id)).toEqual([1, 2, 3])
    expect(
      db.calls.find((call) => call.sql.includes('FROM notifications n'))?.bind,
    ).toEqual([1])
  })

  it('投稿だけなら通知の詳細取得を省略する', () => {
    const db = mockDb()
    executeOutput(db, mkNode(), mkInput([mkRow(1, 100)]), [])
    expect(
      db.calls.some((call) => call.sql.includes('FROM notifications n')),
    ).toBe(false)
  })

  it('未対応テーブルは重複を除いてエラーに列挙する', () => {
    expect(() =>
      executeOutput(
        mockDb(),
        mkNode(),
        mkInput([
          mkRow(1, 30, 'profiles'),
          mkRow(2, 20, 'hashtags'),
          mkRow(3, 10, 'profiles'),
        ]),
        [],
      ),
    ).toThrow(/未対応テーブル: profiles, hashtags$/)
  })

  it.each(['ASC', 'DESC'] as const)(
    '同一IDの投稿と通知は入力順を維持する (%s)',
    (direction) => {
      const rows = [mkRow(2, 100, 'notifications'), mkRow(2, 1, 'posts')]
      const result = executeOutput(
        mockDb(),
        mkNode({ sort: { direction, field: 'id' } }),
        mkInput(rows),
        [],
      )
      expect(result.displayOrder).toEqual([
        { id: 2, table: 'notifications' },
        { id: 2, table: 'posts' },
      ])
    },
  )

  describe('空入力', () => {
    it('rows が空の場合、空の結果とsourceType="post"が返る', () => {
      const db = mockDb()
      const result = executeOutput(db, mkNode(), mkInput([]), [])

      expect(result.displayOrder).toEqual([])
      expect(result.posts.detailRows).toEqual([])
      expect(result.notifications.detailRows).toEqual([])
      expect(result.sourceType).toBe('post')
      expect(db.exec).not.toHaveBeenCalled()
    })
  })

  // =============================================================
  // --- posts のみ ---
  // =============================================================
  describe('posts のみ', () => {
    it('複数のブーストが共有する親投稿も一度だけバッチ取得する', () => {
      const db = mockDb()
      const detail = Array<string | number | null>(26).fill(null)
      detail[25] = 77
      db.exec.mockReturnValueOnce([detail, [...detail]])
      executeOutput(db, mkNode(), mkInput([mkRow(1, 300), mkRow(2, 200)]), [])
      expect(db.exec.mock.calls[0][1].bind).toEqual([1, 2])
      const mediaQuery = db.calls.find(({ sql }) =>
        sql.includes('FROM post_media'),
      )
      expect(mediaQuery?.bind).toEqual([1, 2, 77])
    })

    it('sourceType が "post" になる', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 300, 'posts'), mkRow(2, 200, 'posts')])
      const result = executeOutput(db, mkNode(), input, ['https://example.com'])

      expect(result.sourceType).toBe('post')
    })

    it('displayOrder に posts エントリが含まれる', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 300, 'posts'), mkRow(2, 200, 'posts')])
      const result = executeOutput(db, mkNode(), input, ['https://example.com'])

      expect(result.displayOrder).toEqual([
        { id: 1, table: 'posts' },
        { id: 2, table: 'posts' },
      ])
    })

    it('Phase2 + Phase3 のクエリが実行される (db.exec が呼ばれる)', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 100, 'posts')], 'posts')
      executeOutput(db, mkNode(), input, ['https://example.com'])

      // Phase2 (detail) + Phase3 (batch queries)
      expect(db.exec).toHaveBeenCalled()
      const sqlCalls = db.calls.map((c) => c.sql)
      // Phase2 query contains post ID placeholder
      expect(sqlCalls.some((s) => s.includes('?'))).toBe(true)
    })

    it('notification の detailRows は空', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 100, 'posts')])
      const result = executeOutput(db, mkNode(), input, [])

      expect(result.notifications.detailRows).toEqual([])
    })
  })

  // =============================================================
  // --- notifications のみ ---
  // =============================================================
  describe('notifications のみ', () => {
    it('sourceType が "notification" になる', () => {
      const db = mockDb()
      const input = mkInput(
        [mkRow(10, 500, 'notifications'), mkRow(20, 400, 'notifications')],
        'notifications',
      )
      const result = executeOutput(db, mkNode(), input, [])

      expect(result.sourceType).toBe('notification')
    })

    it('displayOrder に notifications エントリが含まれる', () => {
      const db = mockDb()
      const input = mkInput(
        [mkRow(10, 500, 'notifications'), mkRow(20, 400, 'notifications')],
        'notifications',
      )
      const result = executeOutput(db, mkNode(), input, [])

      expect(result.displayOrder).toEqual([
        { id: 10, table: 'notifications' },
        { id: 20, table: 'notifications' },
      ])
    })

    it('posts の結果は空', () => {
      const db = mockDb()
      const input = mkInput([mkRow(10, 500, 'notifications')], 'notifications')
      const result = executeOutput(db, mkNode(), input, [])

      expect(result.posts.detailRows).toEqual([])
      expect(result.posts.batchResults).toEqual({})
    })

    it('通知クエリが実行される', () => {
      const db = mockDb()
      const input = mkInput([mkRow(10, 500, 'notifications')], 'notifications')
      executeOutput(db, mkNode(), input, [])

      expect(db.exec).toHaveBeenCalled()
      // 通知クエリには notifications テーブルへの参照が含まれる
      const sqlCalls = db.calls.map((c) => c.sql)
      expect(sqlCalls.some((s) => s.includes('notifications'))).toBe(true)
    })
  })

  // =============================================================
  // --- mixed (posts + notifications) ---
  // =============================================================
  describe('mixed mode', () => {
    it('sourceType が "mixed" になる', () => {
      const db = mockDb()
      const input = mkInput(
        [
          mkRow(1, 300, 'posts'),
          mkRow(10, 250, 'notifications'),
          mkRow(2, 200, 'posts'),
        ],
        'mixed',
      )
      const result = executeOutput(db, mkNode(), input, ['https://example.com'])

      expect(result.sourceType).toBe('mixed')
    })

    it('displayOrder が sort 順序を保持する (DESC)', () => {
      const db = mockDb()
      const input = mkInput(
        [
          mkRow(1, 300, 'posts'),
          mkRow(10, 250, 'notifications'),
          mkRow(2, 200, 'posts'),
        ],
        'mixed',
      )
      const result = executeOutput(db, mkNode(), input, ['https://example.com'])

      expect(result.displayOrder).toEqual([
        { id: 1, table: 'posts' },
        { id: 10, table: 'notifications' },
        { id: 2, table: 'posts' },
      ])
    })

    it('posts と notifications の両方のクエリが実行される', () => {
      const db = mockDb()
      const input = mkInput(
        [mkRow(1, 300, 'posts'), mkRow(10, 250, 'notifications')],
        'mixed',
      )
      executeOutput(db, mkNode(), input, ['https://example.com'])

      const sqlCalls = db.calls.map((c) => c.sql)
      // 通知クエリと投稿クエリの両方が呼ばれる
      expect(sqlCalls.some((s) => s.includes('notifications'))).toBe(true)
      expect(db.calls.length).toBeGreaterThanOrEqual(2)
    })
  })

  // =============================================================
  // --- ソート & ページネーション ---
  // =============================================================
  describe('ソート & ページネーション', () => {
    it.each([
      ['id', 'before', 2, [1]],
      ['id', 'after', 2, [3]],
      ['created_at_ms', 'before', 200, [3]],
      ['created_at_ms', 'after', 200, [2]],
    ] as const)(
      '%s の %s カーソルは境界を含まない',
      (field, direction, value, ids) => {
        const node = mkNode({
          pagination: { cursor: { direction, field, value }, limit: 10 },
        })
        const input = mkInput([mkRow(1, 200), mkRow(2, 300), mkRow(3, 100)])
        const result = executeOutput(mockDb(), node, input, [])
        expect(result.displayOrder.map((row) => row.id)).toEqual(ids)
      },
    )

    it('ASC ソートで displayOrder が昇順になる', () => {
      const db = mockDb()
      const node = mkNode({
        sort: { direction: 'ASC', field: 'createdAtMs' },
      })
      const input = mkInput([
        mkRow(1, 300, 'posts'),
        mkRow(2, 100, 'posts'),
        mkRow(3, 200, 'posts'),
      ])
      const result = executeOutput(db, node, input, [])

      expect(result.displayOrder.map((e) => e.id)).toEqual([2, 3, 1])
    })

    it('limit で結果が制限される', () => {
      const db = mockDb()
      const node = mkNode({
        pagination: { limit: 2, offset: 0 },
      })
      const input = mkInput([
        mkRow(1, 300, 'posts'),
        mkRow(2, 200, 'posts'),
        mkRow(3, 100, 'posts'),
      ])
      const result = executeOutput(db, node, input, [])

      expect(result.displayOrder).toHaveLength(2)
    })

    it('offset でスキップされる', () => {
      const db = mockDb()
      const node = mkNode({
        pagination: { limit: 100, offset: 1 },
      })
      const input = mkInput([
        mkRow(1, 300, 'posts'),
        mkRow(2, 200, 'posts'),
        mkRow(3, 100, 'posts'),
      ])
      const result = executeOutput(db, node, input, [])

      // DESC ソート後: [1, 2, 3] → offset 1 → [2, 3]
      expect(result.displayOrder).toHaveLength(2)
      expect(result.displayOrder[0].id).toBe(2)
    })
  })

  // =============================================================
  // --- 未対応テーブルガード ---
  // =============================================================
  describe('未対応テーブルガード', () => {
    it('posts/notifications 以外のテーブルがあるとエラーをスローする', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 100, 'profiles')])

      expect(() => executeOutput(db, mkNode(), input, [])).toThrow(
        '未対応テーブル',
      )
    })

    it('エラーメッセージに未対応テーブル名が含まれる', () => {
      const db = mockDb()
      const input = mkInput([mkRow(1, 100, 'posts'), mkRow(2, 200, 'servers')])

      expect(() => executeOutput(db, mkNode(), input, [])).toThrow('servers')
    })
  })
})
