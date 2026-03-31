import {
  detectQueryMode,
  parseMixedQuery,
  parseWhereToNodes,
  splitByTopLevelAnd,
  splitByTopLevelOr,
  whereToQueryPlan,
} from '../whereToNodes'

// ---------------------------------------------------------------------------
// splitByTopLevelAnd
// ---------------------------------------------------------------------------

describe('splitByTopLevelAnd', () => {
  it('単純な AND 分割', () => {
    expect(splitByTopLevelAnd('a = 1 AND b = 2')).toEqual(['a = 1', 'b = 2'])
  })

  it('ネストされた括弧内の AND を無視', () => {
    expect(splitByTopLevelAnd('(a AND b) AND c = 1')).toEqual([
      '(a AND b)',
      'c = 1',
    ])
  })

  it('文字列内の AND を無視', () => {
    expect(splitByTopLevelAnd("p.name = 'AND test'")).toEqual([
      "p.name = 'AND test'",
    ])
  })
})

// ---------------------------------------------------------------------------
// splitByTopLevelOr
// ---------------------------------------------------------------------------

describe('splitByTopLevelOr', () => {
  it('単純な OR 分割', () => {
    expect(splitByTopLevelOr('a = 1 OR b = 2')).toEqual(['a = 1', 'b = 2'])
  })

  it('ネストされた括弧内の OR を無視', () => {
    expect(splitByTopLevelOr('(a OR b) OR c = 1')).toEqual([
      '(a OR b)',
      'c = 1',
    ])
  })
})

// ---------------------------------------------------------------------------
// detectQueryMode
// ---------------------------------------------------------------------------

describe('detectQueryMode', () => {
  it('status エイリアスのみ → status', () => {
    expect(detectQueryMode("ptt.timelineType = 'home'")).toBe('status')
  })

  it('notification エイリアスのみ → notification', () => {
    expect(detectQueryMode("nt.name = 'follow'")).toBe('notification')
  })

  it('両方参照 → mixed', () => {
    expect(
      detectQueryMode("ptt.timelineType = 'home' OR nt.name = 'follow'"),
    ).toBe('mixed')
  })

  it('どちらもない → status (デフォルト)', () => {
    expect(detectQueryMode('unknown_column = 1')).toBe('status')
  })
})

// ---------------------------------------------------------------------------
// parseWhereToNodes — 認識パターン
// ---------------------------------------------------------------------------

describe('parseWhereToNodes', () => {
  describe('タイムラインスコープ', () => {
    it("ptt.timelineType = 'home' → timeline-scope", () => {
      const result = parseWhereToNodes("ptt.timelineType = 'home'")
      expect(result.nodes).toHaveLength(1)
      const node = result.nodes[0]
      expect(node.kind).toBe('timeline-scope')
      if (node.kind === 'timeline-scope') {
        expect(node.timelineKeys).toEqual(['home'])
      }
      expect(result.remainingWhere).toBeNull()
    })

    it("ptt.timelineType IN ('home', 'local') → timeline-scope with 2 keys", () => {
      const result = parseWhereToNodes("ptt.timelineType IN ('home', 'local')")
      expect(result.nodes).toHaveLength(1)
      const node = result.nodes[0]
      if (node.kind === 'timeline-scope') {
        expect(node.timelineKeys).toEqual(['home', 'local'])
      }
    })
  })

  describe('notification_types フィルタ', () => {
    it("nt.name = 'follow' → table-filter notification_types", () => {
      const result = parseWhereToNodes("nt.name = 'follow'")
      expect(result.nodes).toHaveLength(1)
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('notification_types')
        expect(node.column).toBe('name')
        expect(node.op).toBe('IN')
        expect(node.value).toEqual(['follow'])
      }
    })

    it("nt.name IN ('favourite', 'reblog') → table-filter notification_types", () => {
      const result = parseWhereToNodes("nt.name IN ('favourite', 'reblog')")
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('notification_types')
        expect(node.value).toEqual(['favourite', 'reblog'])
      }
    })
  })

  describe('profiles フィルタ', () => {
    it("pr.acct = 'user@example.com' → table-filter profiles", () => {
      const result = parseWhereToNodes("pr.acct = 'user@example.com'")
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('profiles')
        expect(node.column).toBe('acct')
        expect(node.value).toEqual(['user@example.com'])
      }
    })

    it("ap.acct = 'user@example.com' → table-filter profiles", () => {
      const result = parseWhereToNodes("ap.acct = 'user@example.com'")
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('profiles')
        expect(node.column).toBe('acct')
        expect(node.value).toEqual(['user@example.com'])
      }
    })
  })

  describe('posts フィルタ', () => {
    it('p.is_reblog = 0 → table-filter posts', () => {
      const result = parseWhereToNodes('p.is_reblog = 0')
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('posts')
        expect(node.column).toBe('is_reblog')
        expect(node.op).toBe('=')
        expect(node.value).toBe(0)
      }
    })

    it('p.is_reblog = 1 → table-filter posts', () => {
      const result = parseWhereToNodes('p.is_reblog = 1')
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('posts')
        expect(node.value).toBe(1)
      }
    })

    it("p.spoiler_text != '' → table-filter posts", () => {
      const result = parseWhereToNodes("p.spoiler_text != ''")
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('posts')
        expect(node.column).toBe('spoiler_text')
        expect(node.op).toBe('!=')
        expect(node.value).toBe('')
      }
    })

    it('p.in_reply_to_uri IS NULL → table-filter posts IS NULL', () => {
      const result = parseWhereToNodes('p.in_reply_to_uri IS NULL')
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('posts')
        expect(node.column).toBe('in_reply_to_uri')
        expect(node.op).toBe('IS NULL')
      }
    })

    it("p.language = 'ja' → table-filter posts", () => {
      const result = parseWhereToNodes("p.language = 'ja'")
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('posts')
        expect(node.column).toBe('language')
        expect(node.value).toBe('ja')
      }
    })
  })

  describe('visibility_types フィルタ', () => {
    it("vt.name = 'public' → table-filter visibility_types", () => {
      const result = parseWhereToNodes("vt.name = 'public'")
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('visibility_types')
        expect(node.column).toBe('name')
        expect(node.value).toEqual(['public'])
      }
    })

    it("vt.name IN ('public', 'unlisted') → table-filter visibility_types", () => {
      const result = parseWhereToNodes("vt.name IN ('public', 'unlisted')")
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('visibility_types')
        expect(node.value).toEqual(['public', 'unlisted'])
      }
    })
  })

  describe('post_stats フィルタ', () => {
    it('ps.favourites_count >= 10 → table-filter post_stats', () => {
      const result = parseWhereToNodes('ps.favourites_count >= 10')
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('post_stats')
        expect(node.column).toBe('favourites_count')
        expect(node.op).toBe('>=')
        expect(node.value).toBe(10)
      }
    })
  })

  describe('hashtags フィルタ', () => {
    it("ht.name = 'photo' → table-filter hashtags", () => {
      const result = parseWhereToNodes("ht.name = 'photo'")
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('hashtags')
        expect(node.column).toBe('name')
        expect(node.value).toEqual(['photo'])
      }
    })
  })

  describe('exists-filter', () => {
    it('EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id) → exists-filter', () => {
      const result = parseWhereToNodes(
        'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
      const node = result.nodes[0]
      expect(node.kind).toBe('exists-filter')
      if (node.kind === 'exists-filter') {
        expect(node.mode).toBe('exists')
        expect(node.table).toBe('post_media')
      }
    })

    it('(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 2 → exists-filter count-gte', () => {
      const result = parseWhereToNodes(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 2',
      )
      const node = result.nodes[0]
      expect(node.kind).toBe('exists-filter')
      if (node.kind === 'exists-filter') {
        expect(node.mode).toBe('count-gte')
        expect(node.countValue).toBe(2)
        expect(node.table).toBe('post_media')
      }
    })
  })

  describe('post_mentions フィルタ', () => {
    it("pme.acct = 'user@example.com' → table-filter post_mentions", () => {
      const result = parseWhereToNodes("pme.acct = 'user@example.com'")
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('post_mentions')
        expect(node.column).toBe('acct')
        expect(node.value).toEqual(['user@example.com'])
      }
    })
  })

  describe('post_interactions フィルタ', () => {
    it('pe.is_bookmarked = 1 → table-filter post_interactions', () => {
      const result = parseWhereToNodes('pe.is_bookmarked = 1')
      const node = result.nodes[0]
      expect(node.kind).toBe('table-filter')
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('post_interactions')
        expect(node.column).toBe('is_bookmarked')
        expect(node.value).toBe(1)
      }
    })
  })

  // === 複合・フォールバック ===

  describe('複合・フォールバック', () => {
    it('AND で結合された複数の認識可能パターン → 2 nodes, no remainder', () => {
      const result = parseWhereToNodes(
        "ptt.timelineType = 'home' AND p.is_reblog = 0",
      )
      expect(result.nodes).toHaveLength(2)
      expect(result.remainingWhere).toBeNull()
      expect(result.nodes[0].kind).toBe('timeline-scope')
      expect(result.nodes[1].kind).toBe('table-filter')
    })

    it('認識不能なパターンは remainingWhere に入る', () => {
      const result = parseWhereToNodes(
        "ptt.timelineType = 'home' AND some_unknown_func(x) > 5",
      )
      expect(result.nodes).toHaveLength(1)
      expect(result.remainingWhere).toBe('some_unknown_func(x) > 5')
    })

    it('全て認識不能な場合は nodes が空で remainingWhere に全文', () => {
      const result = parseWhereToNodes('custom_func(a, b) = 1')
      expect(result.nodes).toHaveLength(0)
      expect(result.remainingWhere).toBe('custom_func(a, b) = 1')
    })

    it("v1 カラム名が自動書き換えされる: p.account_acct = 'user' → pr.acct として認識", () => {
      const result = parseWhereToNodes("p.account_acct = 'user'")
      expect(result.nodes).toHaveLength(1)
      const node = result.nodes[0]
      if (node.kind === 'table-filter') {
        expect(node.table).toBe('profiles')
        expect(node.column).toBe('acct')
        expect(node.value).toEqual(['user'])
      }
    })
  })
})

// ---------------------------------------------------------------------------
// parseMixedQuery
// ---------------------------------------------------------------------------

describe('parseMixedQuery', () => {
  it('status OR notification を分割してパースする', () => {
    const result = parseMixedQuery(
      "ptt.timelineType = 'home' OR nt.name IN ('favourite', 'reblog')",
    )

    expect(result.statusNodes.nodes).toHaveLength(1)
    expect(result.statusNodes.nodes[0].kind).toBe('timeline-scope')

    expect(result.notificationNodes.nodes).toHaveLength(1)
    const notifNode = result.notificationNodes.nodes[0]
    if (notifNode.kind === 'table-filter') {
      expect(notifNode.table).toBe('notification_types')
      expect(notifNode.value).toEqual(['favourite', 'reblog'])
    }
  })
})

// ---------------------------------------------------------------------------
// whereToQueryPlan
// ---------------------------------------------------------------------------

describe('whereToQueryPlan', () => {
  const context = { queryLimit: 50 }

  it('status-only クエリから posts ソースの QueryPlan を生成', () => {
    const plan = whereToQueryPlan("ptt.timelineType = 'home'", context)
    expect(plan.source.table).toBe('posts')
    expect(plan.filters.some((f) => f.kind === 'timeline-scope')).toBe(true)
    expect(plan.pagination.limit).toBe(50)
    expect(plan.sort.direction).toBe('DESC')
  })

  it('notification-only クエリから notifications ソースの QueryPlan を生成', () => {
    const plan = whereToQueryPlan("nt.name = 'follow'", context)
    expect(plan.source.table).toBe('notifications')
    expect(plan.filters.some((f) => f.kind === 'table-filter')).toBe(true)
  })

  it('mixed クエリから MergeNode を含む QueryPlan を生成', () => {
    const plan = whereToQueryPlan(
      "ptt.timelineType = 'home' OR nt.name = 'follow'",
      context,
    )
    expect(plan.composites).toHaveLength(1)
    const merge = plan.composites[0]
    expect(merge.kind).toBe('merge')
    if (merge.kind === 'merge') {
      expect(merge.strategy).toBe('interleave-by-time')
      expect(merge.sources).toHaveLength(2)
      expect(merge.sources[0].source.table).toBe('posts')
      expect(merge.sources[1].source.table).toBe('notifications')
    }
  })

  it('認識不能部分が raw-sql-filter として filters に含まれる', () => {
    const plan = whereToQueryPlan(
      "ptt.timelineType = 'home' AND custom_func(x) > 5",
      context,
    )
    const rawFilter = plan.filters.find((f) => f.kind === 'raw-sql-filter')
    expect(rawFilter).toBeDefined()
    if (rawFilter?.kind === 'raw-sql-filter') {
      expect(rawFilter.where).toBe('custom_func(x) > 5')
    }
  })
})
