import type { TimelineConfigV2 } from 'types/types'
import { type ConfigToNodesContext, configToQueryPlan } from '../configToNodes'

// ---------------------------------------------------------------------------
// Helper: minimal config factory
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<TimelineConfigV2>): TimelineConfigV2 {
  return {
    id: 'test',
    order: 0,
    type: 'home',
    visible: true,
    ...overrides,
  }
}

const defaultContext: ConfigToNodesContext = {
  localAccountIds: [1, 2],
  queryLimit: 50,
  serverIds: [10, 20],
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('configToQueryPlan', () => {
  // === ソースノード ===

  describe('ソースノード', () => {
    it('home タイムラインでは posts ソースを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'home' }),
        defaultContext,
      )
      expect(plan.source).toEqual({
        kind: 'source',
        orderBy: 'created_at_ms',
        orderDirection: 'DESC',
        table: 'posts',
      })
    })

    it('notification タイムラインでは notifications ソースを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'notification' }),
        defaultContext,
      )
      expect(plan.source.table).toBe('notifications')
    })

    it('tag タイムラインでは posts ソースを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ tagConfig: { mode: 'or', tags: ['photo'] }, type: 'tag' }),
        defaultContext,
      )
      expect(plan.source.table).toBe('posts')
    })
  })

  // === タイムラインスコープ ===

  describe('TimelineScope', () => {
    it('home タイムラインで timeline-scope を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'home' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      expect(scope).toBeDefined()
      if (scope?.kind === 'timeline-scope') {
        expect(scope.timelineKeys).toEqual(['home'])
        expect(scope.accountScope).toEqual([1, 2])
      }
    })

    it('local タイムラインでは accountScope を設定しない', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'local' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      expect(scope).toBeDefined()
      if (scope?.kind === 'timeline-scope') {
        expect(scope.timelineKeys).toEqual(['local'])
        expect(scope.accountScope).toBeUndefined()
      }
    })

    it('public タイムラインで timeline-scope を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'public' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      if (scope?.kind === 'timeline-scope') {
        expect(scope.timelineKeys).toEqual(['public'])
      }
    })

    it('timelineTypes 上書きが優先される', () => {
      const plan = configToQueryPlan(
        makeConfig({ timelineTypes: ['home', 'local'], type: 'home' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      if (scope?.kind === 'timeline-scope') {
        expect(scope.timelineKeys).toEqual(['home', 'local'])
        // home が含まれるので accountScope がある
        expect(scope.accountScope).toEqual([1, 2])
      }
    })

    it('notification ではタイムラインスコープを生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({ type: 'notification' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      expect(scope).toBeUndefined()
    })

    it('tag ではタイムラインスコープを生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({ tagConfig: { mode: 'or', tags: ['art'] }, type: 'tag' }),
        defaultContext,
      )
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      expect(scope).toBeUndefined()
    })
  })

  // === タグ ===

  describe('TagCombination', () => {
    it('タグ OR モードのコンポジットを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          tagConfig: { mode: 'or', tags: ['photo', 'art'] },
          type: 'tag',
        }),
        defaultContext,
      )
      expect(plan.composites).toHaveLength(1)
      const tag = plan.composites[0]
      if (tag.kind === 'tag-combination') {
        expect(tag.tags).toEqual(['photo', 'art'])
        expect(tag.mode).toBe('or')
      }
    })

    it('タグ AND モードのコンポジットを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          tagConfig: { mode: 'and', tags: ['photo', 'art'] },
          type: 'tag',
        }),
        defaultContext,
      )
      const tag = plan.composites[0]
      if (tag.kind === 'tag-combination') {
        expect(tag.mode).toBe('and')
      }
    })

    it('空タグ配列ではコンポジットを生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({ tagConfig: { mode: 'or', tags: [] }, type: 'tag' }),
        defaultContext,
      )
      expect(plan.composites).toHaveLength(0)
    })
  })

  // === BackendFilter ===

  describe('BackendFilter', () => {
    it('localAccountIds が存在する場合に backend-filter を生成する', () => {
      const plan = configToQueryPlan(makeConfig({}), defaultContext)
      const bf = plan.filters.find((f) => f.kind === 'backend-filter')
      expect(bf).toBeDefined()
      if (bf?.kind === 'backend-filter') {
        expect(bf.localAccountIds).toEqual([1, 2])
      }
    })

    it('localAccountIds が空の場合は backend-filter を生成しない', () => {
      const plan = configToQueryPlan(makeConfig({}), {
        ...defaultContext,
        localAccountIds: [],
      })
      const bf = plan.filters.find((f) => f.kind === 'backend-filter')
      expect(bf).toBeUndefined()
    })
  })

  // === コンテンツフィルタ ===

  describe('コンテンツフィルタ', () => {
    it('onlyMedia で exists-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ onlyMedia: true }),
        defaultContext,
      )
      const ef = plan.filters.find((f) => f.kind === 'exists-filter')
      expect(ef).toBeDefined()
      if (ef?.kind === 'exists-filter') {
        expect(ef.mode).toBe('exists')
        expect(ef.table).toBe('post_media')
      }
    })

    it('minMediaCount で count-gte exists-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ minMediaCount: 3 }),
        defaultContext,
      )
      const ef = plan.filters.find((f) => f.kind === 'exists-filter')
      if (ef?.kind === 'exists-filter') {
        expect(ef.mode).toBe('count-gte')
        expect(ef.countValue).toBe(3)
      }
    })

    it('minMediaCount が onlyMedia より優先される', () => {
      const plan = configToQueryPlan(
        makeConfig({ minMediaCount: 2, onlyMedia: true }),
        defaultContext,
      )
      const filters = plan.filters.filter((f) => f.kind === 'exists-filter')
      expect(filters).toHaveLength(1)
      if (filters[0]?.kind === 'exists-filter') {
        expect(filters[0].mode).toBe('count-gte')
      }
    })

    it('visibilityFilter で table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ visibilityFilter: ['public', 'unlisted'] }),
        defaultContext,
      )
      const vf = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'visibility_types',
      )
      expect(vf).toBeDefined()
      if (vf?.kind === 'table-filter') {
        expect(vf.op).toBe('IN')
        expect(vf.value).toEqual(['public', 'unlisted'])
      }
    })

    it('全4種の visibilityFilter は生成しない (全選択 = フィルタなし)', () => {
      const plan = configToQueryPlan(
        makeConfig({
          visibilityFilter: ['public', 'unlisted', 'private', 'direct'],
        }),
        defaultContext,
      )
      const vf = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'visibility_types',
      )
      expect(vf).toBeUndefined()
    })

    it('languageFilter で raw-sql-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ languageFilter: ['ja', 'en'] }),
        defaultContext,
      )
      const lf = plan.filters.find(
        (f) => f.kind === 'raw-sql-filter' && f.where.includes('p.language'),
      )
      expect(lf).toBeDefined()
      if (lf?.kind === 'raw-sql-filter') {
        expect(lf.where).toContain("'ja'")
        expect(lf.where).toContain("'en'")
        expect(lf.where).toContain('IS NULL')
      }
    })

    it('excludeReblogs で table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ excludeReblogs: true }),
        defaultContext,
      )
      const rf = plan.filters.find(
        (f) =>
          f.kind === 'table-filter' &&
          f.table === 'posts' &&
          f.column === 'is_reblog',
      )
      expect(rf).toBeDefined()
      if (rf?.kind === 'table-filter') {
        expect(rf.op).toBe('=')
        expect(rf.value).toBe(0)
      }
    })

    it('excludeReplies で IS NULL table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ excludeReplies: true }),
        defaultContext,
      )
      const rf = plan.filters.find(
        (f) =>
          f.kind === 'table-filter' &&
          f.table === 'posts' &&
          f.column === 'in_reply_to_uri',
      )
      expect(rf).toBeDefined()
      if (rf?.kind === 'table-filter') {
        expect(rf.op).toBe('IS NULL')
      }
    })

    it('excludeSpoiler で table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ excludeSpoiler: true }),
        defaultContext,
      )
      const sf = plan.filters.find(
        (f) =>
          f.kind === 'table-filter' &&
          f.table === 'posts' &&
          f.column === 'spoiler_text',
      )
      expect(sf).toBeDefined()
      if (sf?.kind === 'table-filter') {
        expect(sf.value).toBe('')
      }
    })

    it('excludeSensitive で table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({ excludeSensitive: true }),
        defaultContext,
      )
      const sf = plan.filters.find(
        (f) =>
          f.kind === 'table-filter' &&
          f.table === 'posts' &&
          f.column === 'is_sensitive',
      )
      expect(sf).toBeDefined()
      if (sf?.kind === 'table-filter') {
        expect(sf.value).toBe(0)
      }
    })
  })

  // === アカウントフィルタ ===

  describe('AccountFilter', () => {
    it('include モードで IN table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          accountFilter: { accts: ['user@example.com'], mode: 'include' },
        }),
        defaultContext,
      )
      const af = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'profiles',
      )
      expect(af).toBeDefined()
      if (af?.kind === 'table-filter') {
        expect(af.op).toBe('IN')
        expect(af.value).toEqual(['user@example.com'])
      }
    })

    it('exclude モードで NOT IN table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          accountFilter: { accts: ['spam@example.com'], mode: 'exclude' },
        }),
        defaultContext,
      )
      const af = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'profiles',
      )
      if (af?.kind === 'table-filter') {
        expect(af.op).toBe('NOT IN')
      }
    })

    it('空 accts ではフィルタを生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({
          accountFilter: { accts: [], mode: 'include' },
        }),
        defaultContext,
      )
      const af = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'profiles',
      )
      expect(af).toBeUndefined()
    })
  })

  // === モデレーションフィルタ ===

  describe('ModerationFilter', () => {
    it('デフォルトで mute + instance-block の両方を適用する', () => {
      const plan = configToQueryPlan(makeConfig({}), defaultContext)
      const mf = plan.filters.find((f) => f.kind === 'moderation-filter')
      expect(mf).toBeDefined()
      if (mf?.kind === 'moderation-filter') {
        expect(mf.apply).toEqual(['mute', 'instance-block'])
        expect(mf.serverIds).toEqual([10, 20])
      }
    })

    it('applyMuteFilter=false でミュートを除外する', () => {
      const plan = configToQueryPlan(
        makeConfig({ applyMuteFilter: false }),
        defaultContext,
      )
      const mf = plan.filters.find((f) => f.kind === 'moderation-filter')
      if (mf?.kind === 'moderation-filter') {
        expect(mf.apply).toEqual(['instance-block'])
      }
    })

    it('applyInstanceBlock=false でブロックを除外する', () => {
      const plan = configToQueryPlan(
        makeConfig({ applyInstanceBlock: false }),
        defaultContext,
      )
      const mf = plan.filters.find((f) => f.kind === 'moderation-filter')
      if (mf?.kind === 'moderation-filter') {
        expect(mf.apply).toEqual(['mute'])
      }
    })

    it('両方 false の場合は moderation-filter を生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({ applyInstanceBlock: false, applyMuteFilter: false }),
        defaultContext,
      )
      const mf = plan.filters.find((f) => f.kind === 'moderation-filter')
      expect(mf).toBeUndefined()
    })

    it('accountFilter.mode=include の場合はミュートを除外する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          accountFilter: { accts: ['user@example.com'], mode: 'include' },
        }),
        defaultContext,
      )
      const mf = plan.filters.find((f) => f.kind === 'moderation-filter')
      if (mf?.kind === 'moderation-filter') {
        expect(mf.apply).toEqual(['instance-block'])
      }
    })
  })

  // === 通知フィルタ ===

  describe('NotificationTypeFilter', () => {
    it('notificationFilter で notification_types の table-filter を生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          notificationFilter: ['mention', 'favourite'],
          type: 'notification',
        }),
        defaultContext,
      )
      const nf = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'notification_types',
      )
      expect(nf).toBeDefined()
      if (nf?.kind === 'table-filter') {
        expect(nf.op).toBe('IN')
        expect(nf.value).toEqual(['mention', 'favourite'])
      }
    })

    it('notification 以外の type では通知フィルタを生成しない', () => {
      const plan = configToQueryPlan(
        makeConfig({
          notificationFilter: ['mention'],
          type: 'home',
        }),
        defaultContext,
      )
      const nf = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'notification_types',
      )
      expect(nf).toBeUndefined()
    })
  })

  // === Sort & Pagination ===

  describe('Sort & Pagination', () => {
    it('デフォルトのソート (created_at_ms DESC) を設定する', () => {
      const plan = configToQueryPlan(makeConfig({}), defaultContext)
      expect(plan.sort).toEqual({
        direction: 'DESC',
        field: 'created_at_ms',
        kind: 'sort',
      })
    })

    it('queryLimit に基づいたページネーションを設定する', () => {
      const plan = configToQueryPlan(makeConfig({}), {
        ...defaultContext,
        queryLimit: 100,
      })
      expect(plan.pagination).toEqual({
        kind: 'pagination',
        limit: 100,
      })
    })
  })

  // === 複合テスト ===

  describe('複合テスト', () => {
    it('全フィルタ有効の home 設定から正しいプランを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          accountFilter: { accts: ['user@mastodon.social'], mode: 'exclude' },
          excludeReblogs: true,
          excludeReplies: true,
          excludeSensitive: true,
          excludeSpoiler: true,
          languageFilter: ['ja'],
          minMediaCount: 2,
          type: 'home',
          visibilityFilter: ['public'],
        }),
        defaultContext,
      )

      expect(plan.source.table).toBe('posts')
      expect(plan.filters.length).toBeGreaterThanOrEqual(8)

      const kinds = plan.filters.map((f) => f.kind)
      expect(kinds).toContain('timeline-scope')
      expect(kinds).toContain('backend-filter')
      expect(kinds).toContain('exists-filter')
      expect(kinds).toContain('moderation-filter')
      expect(kinds).toContain('raw-sql-filter') // language
    })

    it('通知 + 通知タイプフィルタの設定から正しいプランを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          notificationFilter: ['mention', 'reblog'],
          type: 'notification',
        }),
        defaultContext,
      )

      expect(plan.source.table).toBe('notifications')
      const scope = plan.filters.find((f) => f.kind === 'timeline-scope')
      expect(scope).toBeUndefined()
      const ntf = plan.filters.find(
        (f) => f.kind === 'table-filter' && f.table === 'notification_types',
      )
      expect(ntf).toBeDefined()
    })

    it('タグ AND + メディアフィルタの設定から正しいプランを生成する', () => {
      const plan = configToQueryPlan(
        makeConfig({
          onlyMedia: true,
          tagConfig: { mode: 'and', tags: ['photo', 'art'] },
          type: 'tag',
        }),
        defaultContext,
      )

      expect(plan.composites).toHaveLength(1)
      if (plan.composites[0].kind === 'tag-combination') {
        expect(plan.composites[0].mode).toBe('and')
      }
      const ef = plan.filters.find((f) => f.kind === 'exists-filter')
      expect(ef).toBeDefined()
    })
  })
})
