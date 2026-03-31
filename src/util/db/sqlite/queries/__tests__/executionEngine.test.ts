import type { SerializedExecutionPlan } from '../../protocol'
import type { DbExec } from '../executionEngine'
import { executeQueryPlan } from '../executionEngine'

function createMockDb(
  responses: Map<string, (string | number | null)[][]>,
): DbExec {
  return {
    exec: (
      sql: string,
      _opts: {
        bind?: (string | number | null)[]
        returnValue: 'resultRows'
      },
    ) => {
      for (const [key, value] of responses) {
        if (sql.startsWith(key) || sql === key) {
          return value
        }
      }
      return []
    },
  }
}

describe('executeQueryPlan', () => {
  describe('IdCollectStep', () => {
    it('Phase1 クエリを実行して行データを返す', () => {
      const mockRows: (string | number | null)[][] = [
        [1, 1000],
        [2, 2000],
        [3, 3000],
      ]
      const db = createMockDb(new Map([['SELECT', mockRows]]))
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts p LIMIT 50',
            type: 'id-collect',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(result.stepResults).toHaveLength(1)
      expect(result.stepResults[0].type).toBe('id-collect')
      const step0 = result.stepResults[0]
      if (step0.type === 'id-collect') {
        expect(step0.rows).toEqual(mockRows)
      }
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('バインドパラメータ付きクエリを実行する', () => {
      let capturedBinds: (string | number | null)[] | undefined
      const db: DbExec = {
        exec: (_sql, opts) => {
          capturedBinds = opts.bind ?? undefined
          return [[1, 1000]]
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [0],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id FROM posts p WHERE p.is_sensitive = ?',
            type: 'id-collect',
          },
        ],
      }

      executeQueryPlan(db, plan)
      expect(capturedBinds).toEqual([0])
    })
  })

  describe('MergeStep', () => {
    it('複数の IdCollectStep 結果を時間順にマージする', () => {
      const db = createMockDb(
        new Map([
          [
            'SELECT n.id',
            [
              [10, 3000],
              [11, 1000],
            ],
          ],
          [
            'SELECT p.id',
            [
              [20, 2500],
              [21, 500],
            ],
          ],
        ]),
      )
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'mixed' },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'notifications',
            sql: 'SELECT n.id, n.created_at_ms FROM notifications n',
            type: 'id-collect',
          },
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts p',
            type: 'id-collect',
          },
          {
            limit: 3,
            sourceStepIndices: [0, 1],
            strategy: 'interleave-by-time',
            type: 'merge',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(result.stepResults).toHaveLength(3)
      const mergeResult = result.stepResults[2]
      expect(mergeResult.type).toBe('merge')
      if (mergeResult.type === 'merge') {
        expect(mergeResult.mergedIds).toHaveLength(3)
        // Should be sorted by time DESC: 3000, 2500, 1000
        expect(mergeResult.mergedIds[0].createdAtMs).toBe(3000)
        expect(mergeResult.mergedIds[0].type).toBe('notifications')
        expect(mergeResult.mergedIds[1].createdAtMs).toBe(2500)
        expect(mergeResult.mergedIds[1].type).toBe('posts')
        expect(mergeResult.mergedIds[2].createdAtMs).toBe(1000)
      }
    })

    it('limit でマージ結果を制限する', () => {
      const db = createMockDb(
        new Map([
          [
            'SELECT n',
            [
              [10, 3000],
              [11, 2000],
              [12, 1000],
            ],
          ],
          [
            'SELECT p',
            [
              [20, 2500],
              [21, 1500],
            ],
          ],
        ]),
      )
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'mixed' },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'notifications',
            sql: 'SELECT n',
            type: 'id-collect',
          },
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'posts',
            sql: 'SELECT p',
            type: 'id-collect',
          },
          {
            limit: 2,
            sourceStepIndices: [0, 1],
            strategy: 'interleave-by-time',
            type: 'merge',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      const mergeResult = result.stepResults[2]
      if (mergeResult.type === 'merge') {
        expect(mergeResult.mergedIds).toHaveLength(2)
      }
    })
  })

  describe('DetailFetchStep', () => {
    it('収集した投稿IDに対して詳細クエリを実行する', () => {
      let capturedSql = ''
      const db: DbExec = {
        exec: (sql, _opts) => {
          capturedSql = sql
          if (sql.includes('SELECT p.id'))
            return [
              [1, 1000],
              [2, 2000],
            ]
          return [
            [1, 'content1'],
            [2, 'content2'],
          ]
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts',
            type: 'id-collect',
          },
          {
            sqlTemplate: 'SELECT * FROM posts WHERE id IN ({IDS})',
            target: 'posts',
            type: 'detail-fetch',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(capturedSql).toContain('IN (?,?)')
      expect(result.stepResults[1].type).toBe('detail-fetch')
    })

    it('IDが空の場合は空の結果を返す', () => {
      const db: DbExec = {
        exec: () => [],
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id FROM posts WHERE 1=0',
            type: 'id-collect',
          },
          {
            sqlTemplate: 'SELECT * FROM posts WHERE id IN ({IDS})',
            target: 'posts',
            type: 'detail-fetch',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      if (result.stepResults[1].type === 'detail-fetch') {
        expect(result.stepResults[1].rows).toEqual([])
      }
    })

    it('reblog 展開でリブログ投稿IDを追加する', () => {
      const calls: string[] = []
      const db: DbExec = {
        exec: (sql, _opts) => {
          calls.push(sql)
          if (sql.includes('SELECT p.id')) return [[1, 1000]]
          if (sql.includes('SELECT * FROM posts')) return [[1, 'content', 99]]
          return []
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: true, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts',
            type: 'id-collect',
          },
          {
            reblogColumnIndex: 2,
            sqlTemplate: 'SELECT * FROM posts WHERE id IN ({IDS})',
            target: 'posts',
            type: 'detail-fetch',
          },
          {
            queries: {
              media: 'SELECT * FROM media WHERE post_id IN ({IDS})',
            },
            type: 'batch-enrich',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      // The batch query should have placeholders for 2 IDs (1 + reblog 99)
      const batchSql = calls.find((s) => s.includes('media'))
      expect(batchSql).toContain('?,?')
      expect(result.stepResults).toHaveLength(3)
    })
  })

  describe('BatchEnrichStep', () => {
    it('複数のバッチクエリを実行する', () => {
      const executedQueries: string[] = []
      const db: DbExec = {
        exec: (sql, _opts) => {
          executedQueries.push(sql)
          if (sql.includes('SELECT p.id'))
            return [
              [1, 1000],
              [2, 2000],
            ]
          return [[1, 'data']]
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts',
            type: 'id-collect',
          },
          {
            queries: {
              media: 'SELECT * FROM media WHERE post_id IN ({IDS})',
              mentions: 'SELECT * FROM mentions WHERE post_id IN ({IDS})',
            },
            type: 'batch-enrich',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      const batchResult = result.stepResults[1]
      expect(batchResult.type).toBe('batch-enrich')
      if (batchResult.type === 'batch-enrich') {
        expect(Object.keys(batchResult.results)).toContain('media')
        expect(Object.keys(batchResult.results)).toContain('mentions')
      }
    })

    it('IDが空の場合はすべて空の結果を返す', () => {
      const db: DbExec = { exec: () => [] }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { id: 0 },
            source: 'posts',
            sql: 'SELECT p.id FROM posts WHERE 1=0',
            type: 'id-collect',
          },
          {
            queries: { media: 'Q1', mentions: 'Q2' },
            type: 'batch-enrich',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      if (result.stepResults[1].type === 'batch-enrich') {
        expect(result.stepResults[1].results.media).toEqual([])
        expect(result.stepResults[1].results.mentions).toEqual([])
      }
    })
  })

  describe('完全なパイプライン', () => {
    it('IdCollect → DetailFetch → BatchEnrich の3ステップを正しく実行する', () => {
      const db: DbExec = {
        exec: (sql, _opts) => {
          if (sql.includes('SELECT p.id'))
            return [
              [1, 1000],
              [2, 2000],
            ]
          if (sql.includes('SELECT * FROM posts'))
            return [
              [1, 'c1'],
              [2, 'c2'],
            ]
          return [[1, 'batch_data']]
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'post' },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts p',
            type: 'id-collect',
          },
          {
            sqlTemplate: 'SELECT * FROM posts WHERE id IN ({IDS})',
            target: 'posts',
            type: 'detail-fetch',
          },
          {
            queries: {
              media: 'SELECT * FROM media WHERE post_id IN ({IDS})',
            },
            type: 'batch-enrich',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(result.stepResults).toHaveLength(3)
      expect(result.stepResults[0].type).toBe('id-collect')
      expect(result.stepResults[1].type).toBe('detail-fetch')
      expect(result.stepResults[2].type).toBe('batch-enrich')
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0)
    })

    it('通知クエリのパイプラインを正しく実行する', () => {
      const db: DbExec = {
        exec: (sql, _opts) => {
          if (sql.includes('SELECT n.id')) return [[10, 5000]]
          if (sql.includes('SELECT * FROM notifications'))
            return [[10, 'notif_data']]
          return []
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: {
          requiresReblogExpansion: false,
          sourceType: 'notification',
        },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'notifications',
            sql: 'SELECT n.id, n.created_at_ms FROM notifications n',
            type: 'id-collect',
          },
          {
            sqlTemplate: 'SELECT * FROM notifications WHERE id IN ({IDS})',
            target: 'notifications',
            type: 'detail-fetch',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(result.stepResults).toHaveLength(2)
      expect(result.stepResults[0].type).toBe('id-collect')
      if (result.stepResults[0].type === 'id-collect') {
        expect(result.stepResults[0].rows).toHaveLength(1)
      }
    })
  })

  describe('混合クエリ (MergeNode)', () => {
    it('通知+投稿のマージパイプラインを正しく実行する', () => {
      const db: DbExec = {
        exec: (sql, _opts) => {
          if (sql.includes('SELECT n.id'))
            return [
              [10, 3000],
              [11, 1000],
            ]
          if (sql.includes('SELECT p.id')) return [[20, 2500]]
          if (sql.includes('SELECT * FROM posts')) return [[20, 'content']]
          if (sql.includes('SELECT * FROM notifications'))
            return [[10, 'notif']]
          return []
        },
      }
      const plan: SerializedExecutionPlan = {
        meta: { requiresReblogExpansion: false, sourceType: 'mixed' },
        steps: [
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'notifications',
            sql: 'SELECT n.id, n.created_at_ms FROM notifications n',
            type: 'id-collect',
          },
          {
            binds: [],
            columns: { createdAtMs: 1, id: 0 },
            source: 'posts',
            sql: 'SELECT p.id, p.created_at_ms FROM posts p',
            type: 'id-collect',
          },
          {
            limit: 50,
            sourceStepIndices: [0, 1],
            strategy: 'interleave-by-time',
            type: 'merge',
          },
          {
            sqlTemplate: 'SELECT * FROM posts WHERE id IN ({IDS})',
            target: 'posts',
            type: 'detail-fetch',
          },
          {
            sqlTemplate: 'SELECT * FROM notifications WHERE id IN ({IDS})',
            target: 'notifications',
            type: 'detail-fetch',
          },
        ],
      }

      const result = executeQueryPlan(db, plan)
      expect(result.stepResults).toHaveLength(5)
      // After merge, context should split IDs correctly
      const mergeResult = result.stepResults[2]
      if (mergeResult.type === 'merge') {
        expect(mergeResult.mergedIds).toHaveLength(3)
      }
    })
  })
})
