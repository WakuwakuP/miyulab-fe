import { compileQueryPlan, compileTagCombination } from '../compile'
import type { QueryPlan } from '../nodes'
import type { IdCollectStep, MergeStep } from '../plan'

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

describe('compileQueryPlan', () => {
  describe('基本的な投稿クエリ', () => {
    it('フィルタなしの投稿クエリで正しい ExecutionPlan を生成する', () => {
      const plan = makePlan()
      const result = compileQueryPlan(plan)

      expect(result.meta.sourceType).toBe('post')
      expect(result.meta.requiresReblogExpansion).toBe(true)
      expect(result.steps.length).toBeGreaterThanOrEqual(3)

      const firstStep = result.steps[0] as IdCollectStep
      expect(firstStep.type).toBe('id-collect')
      expect(firstStep.sql).toContain('SELECT p.id, p.created_at_ms')
      expect(firstStep.sql).toContain('FROM posts p')
      expect(firstStep.sql).toContain('ORDER BY p.created_at_ms DESC')
      expect(firstStep.sql).toContain('LIMIT 50')
    })

    it('通知クエリで sourceType が notification になる', () => {
      const plan = makePlan({
        source: { kind: 'source', table: 'notifications' },
      })
      const result = compileQueryPlan(plan)

      expect(result.meta.sourceType).toBe('notification')
      expect(result.meta.requiresReblogExpansion).toBe(false)
      expect(result.meta.batchKeys).toEqual([])
      expect(result.steps.every((s) => s.type !== 'batch-enrich')).toBe(true)
    })

    it('offset 付きのページネーションを反映する', () => {
      const plan = makePlan({
        pagination: { kind: 'pagination', limit: 20, offset: 100 },
      })
      const result = compileQueryPlan(plan)

      const idStep = result.steps[0] as IdCollectStep
      expect(idStep.sql).toContain('LIMIT 20')
      expect(idStep.sql).toContain('OFFSET 100')
    })
  })

  describe('フィルタ付きクエリ', () => {
    it('直接フィルタを WHERE に含める', () => {
      const plan = makePlan({
        filters: [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('WHERE')
      expect(idStep.sql).toContain('p.is_sensitive = ?')
      expect(idStep.binds).toContain(0)
    })

    it('複数フィルタを AND で結合する', () => {
      const plan = makePlan({
        filters: [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
          {
            column: 'is_reblog',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('AND')
    })

    it('BackendFilter を EXISTS サブクエリとして含める', () => {
      const plan = makePlan({
        filters: [{ kind: 'backend-filter', localAccountIds: [1, 2] }],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('EXISTS (SELECT 1 FROM post_backend_ids')
    })

    it('TimelineScope で INNER JOIN と GROUP BY を生成する', () => {
      const plan = makePlan({
        filters: [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('INNER JOIN timeline_entries te')
      expect(idStep.sql).toContain('GROUP BY p.id')
      expect(idStep.sql).toContain('te.timeline_key = ?')
    })

    it('RawSQLFilter をそのまま WHERE に含める', () => {
      const plan = makePlan({
        filters: [{ kind: 'raw-sql-filter', where: 'p.id > 100' }],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('p.id > 100')
    })
  })

  describe('TagCombination', () => {
    it('OR モードのタグでINNER JOINとGROUP BYを生成する', () => {
      const plan = makePlan({
        composites: [
          { kind: 'tag-combination', mode: 'or', tags: ['cat', 'dog'] },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('INNER JOIN post_hashtags pht')
      expect(idStep.sql).toContain('INNER JOIN hashtags ht')
      expect(idStep.sql).toContain('ht.name IN (?, ?)')
      expect(idStep.sql).toContain('GROUP BY p.id')
      expect(idStep.sql).not.toContain('HAVING')
    })

    it('AND モードのタグで HAVING COUNT を生成する', () => {
      const plan = makePlan({
        composites: [
          {
            kind: 'tag-combination',
            mode: 'and',
            tags: ['cat', 'dog', 'bird'],
          },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).toContain('HAVING COUNT(DISTINCT ht.name) >= 3')
    })
  })

  describe('compileTagCombination', () => {
    it('空のタグ配列で空の結果を返す', () => {
      const result = compileTagCombination(
        { kind: 'tag-combination', mode: 'or', tags: [] },
        'p',
      )

      expect(result.sql).toBe('')
      expect(result.binds).toEqual([])
      expect(result.joins).toEqual([])
      expect(result.having).toBeUndefined()
    })

    it('OR モードで having が undefined', () => {
      const result = compileTagCombination(
        { kind: 'tag-combination', mode: 'or', tags: ['cat'] },
        'p',
      )

      expect(result.having).toBeUndefined()
    })

    it('AND モードで HAVING COUNT を返す', () => {
      const result = compileTagCombination(
        { kind: 'tag-combination', mode: 'and', tags: ['cat', 'dog'] },
        'p',
      )

      expect(result.having).toContain('COUNT(DISTINCT ht.name)')
    })
  })

  describe('MergeNode (混合クエリ)', () => {
    it('2つのソースを持つ MergeNode で正しいステップ順を生成する', () => {
      const notificationPlan = makePlan({
        source: { kind: 'source', table: 'notifications' },
      })
      const postPlan = makePlan()
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 50,
            sources: [notificationPlan, postPlan],
            strategy: 'interleave-by-time',
          },
        ],
      })
      const result = compileQueryPlan(plan)

      expect(result.meta.sourceType).toBe('mixed')
      expect(result.steps[0].type).toBe('id-collect')
      expect(result.steps[1].type).toBe('id-collect')

      const secondIdStep = result.steps[1] as IdCollectStep
      expect(secondIdStep.timeLowerBound).toEqual({
        column: 'createdAtMs',
        fromStep: 0,
      })

      const mergeStep = result.steps.find(
        (s) => s.type === 'merge',
      ) as MergeStep
      expect(mergeStep.sourceStepIndices).toEqual([0, 1])

      const detailSteps = result.steps.filter((s) => s.type === 'detail-fetch')
      expect(detailSteps.length).toBe(2)
    })

    it('MergeNode の limit を MergeStep に反映する', () => {
      const notificationPlan = makePlan({
        source: { kind: 'source', table: 'notifications' },
      })
      const postPlan = makePlan()
      const plan = makePlan({
        composites: [
          {
            kind: 'merge',
            limit: 30,
            sources: [notificationPlan, postPlan],
            strategy: 'interleave-by-time',
          },
        ],
      })
      const result = compileQueryPlan(plan)

      const mergeStep = result.steps.find(
        (s) => s.type === 'merge',
      ) as MergeStep
      expect(mergeStep.limit).toBe(30)
    })
  })

  describe('GROUP BY の制御', () => {
    it('INNER JOIN がない場合は GROUP BY を生成しない', () => {
      const plan = makePlan({
        filters: [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).not.toContain('GROUP BY')
    })

    it('EXISTS フィルタのみでも GROUP BY を生成しない', () => {
      const plan = makePlan({
        filters: [
          { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
        ],
      })
      const result = compileQueryPlan(plan)
      const idStep = result.steps[0] as IdCollectStep

      expect(idStep.sql).not.toContain('GROUP BY')
      expect(idStep.sql).toContain('EXISTS')
    })
  })

  describe('meta データ', () => {
    it('投稿クエリのバッチキーにすべてのエンリッチメントを含む', () => {
      const plan = makePlan()
      const result = compileQueryPlan(plan)

      expect(result.meta.batchKeys).toContain('media')
      expect(result.meta.batchKeys).toContain('mentions')
      expect(result.meta.batchKeys).toContain('customEmojis')
      expect(result.meta.batchKeys).toContain('profileEmojis')
      expect(result.meta.batchKeys).toContain('timelineTypes')
      expect(result.meta.batchKeys).toContain('belongingTags')
      expect(result.meta.batchKeys).toContain('polls')
      expect(result.meta.batchKeys).toContain('interactions')
    })

    it('通知クエリのバッチキーは空', () => {
      const plan = makePlan({
        source: { kind: 'source', table: 'notifications' },
      })
      const result = compileQueryPlan(plan)

      expect(result.meta.batchKeys).toEqual([])
    })
  })
})
