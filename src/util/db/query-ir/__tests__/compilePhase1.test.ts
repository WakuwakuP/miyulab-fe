import { compilePhase1ForTimeline } from '../compat/compilePhase1'
import type { QueryPlan } from '../nodes'

function makePlan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    composites: [],
    filters: [],
    pagination: { kind: 'pagination', limit: 50 },
    sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
    source: { kind: 'source', table: 'posts' },
    ...overrides,
  }
}

describe('compilePhase1ForTimeline', () => {
  describe('単一ソース (merge なし)', () => {
    it('フィルタなしで正しい Phase1 SQL を生成する', () => {
      const plan = makePlan()
      const result = compilePhase1ForTimeline(plan)

      expect(result.sql).toContain('SELECT p.id')
      expect(result.sql).toContain('FROM timeline_entries te')
      expect(result.sql).toContain('ORDER BY p.created_at_ms DESC')
      expect(result.sql).toContain('LIMIT ?')
      expect(result.binds).toContain(50)
    })

    it('timeline-scope フィルタを WHERE に含める', () => {
      const plan = makePlan({
        filters: [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
      })
      const result = compilePhase1ForTimeline(plan)

      expect(result.sql).toContain('te.timeline_key = ?')
      expect(result.sql).toContain('te.local_account_id = ?')
      expect(result.binds).toContain('home')
      expect(result.binds).toContain(1)
    })
  })

  describe('Merge composite', () => {
    it('2つのソースを OR 結合した SQL を生成する', () => {
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 50,
            sources: [
              makePlan({
                filters: [
                  {
                    accountScope: [2],
                    kind: 'timeline-scope',
                    timelineKeys: ['home'],
                  },
                ],
              }),
              makePlan({
                filters: [
                  {
                    accountScope: [1],
                    kind: 'timeline-scope',
                    timelineKeys: ['home', 'local'],
                  },
                ],
              }),
            ],
            strategy: 'interleave-by-time',
          },
        ],
      })
      const result = compilePhase1ForTimeline(plan)

      // OR 結合を含む
      expect(result.sql).toContain('OR')

      // Source 1: home + account 2
      expect(result.binds).toContain('home')
      expect(result.binds).toContain(2)

      // Source 2: home, local + account 1
      expect(result.binds).toContain(1)

      // 基本構造
      expect(result.sql).toContain('FROM timeline_entries te')
      expect(result.sql).toContain('GROUP BY p.id')
      expect(result.sql).toContain('ORDER BY p.created_at_ms DESC')
      expect(result.sql).toContain('LIMIT ?')
    })

    it('merge ソースのフィルタとトップレベルフィルタを AND 結合する', () => {
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 50,
            sources: [
              makePlan({
                filters: [
                  {
                    accountScope: [1],
                    kind: 'timeline-scope',
                    timelineKeys: ['home'],
                  },
                ],
              }),
              makePlan({
                filters: [
                  {
                    accountScope: [2],
                    kind: 'timeline-scope',
                    timelineKeys: ['local'],
                  },
                ],
              }),
            ],
            strategy: 'interleave-by-time',
          },
        ],
        filters: [{ kind: 'backend-filter', localAccountIds: [1, 2] }],
      })
      const result = compilePhase1ForTimeline(plan)

      // OR 部分 + AND backend-filter
      expect(result.sql).toContain('OR')
      expect(result.sql).toContain('AND')
      expect(result.sql).toContain('EXISTS (SELECT 1 FROM post_backend_ids')
    })

    it('単一ソースの merge は OR なしで生成する', () => {
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 50,
            sources: [
              makePlan({
                filters: [
                  {
                    accountScope: [1],
                    kind: 'timeline-scope',
                    timelineKeys: ['home'],
                  },
                ],
              }),
            ],
            strategy: 'interleave-by-time',
          },
        ],
      })
      const result = compilePhase1ForTimeline(plan)

      expect(result.sql).not.toMatch(/\bOR\b/)
      expect(result.sql).toContain('te.timeline_key = ?')
      expect(result.sql).toContain('te.local_account_id = ?')
    })

    it('merge ソースに moderation-filter を含む場合も正しく生成する', () => {
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 50,
            sources: [
              makePlan({
                filters: [
                  {
                    accountScope: [2],
                    kind: 'timeline-scope',
                    timelineKeys: ['home'],
                  },
                  {
                    apply: ['mute', 'instance-block'],
                    kind: 'moderation-filter',
                    serverIds: [1],
                  },
                ],
              }),
              makePlan({
                filters: [
                  {
                    accountScope: [1],
                    kind: 'timeline-scope',
                    timelineKeys: ['home', 'local'],
                  },
                  {
                    apply: ['mute', 'instance-block'],
                    kind: 'moderation-filter',
                    serverIds: [2],
                  },
                ],
              }),
            ],
            strategy: 'interleave-by-time',
          },
        ],
      })
      const result = compilePhase1ForTimeline(plan)

      expect(result.sql).toContain('OR')
      expect(result.sql).toContain('NOT IN')
    })
  })
})
