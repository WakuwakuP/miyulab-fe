import { compileQueryPlan } from 'util/db/query-ir/compile'
import type { OrGroup, QueryPlan } from 'util/db/query-ir/nodes'
import type { IdCollectStep } from 'util/db/query-ir/plan'
import { resolveTableDependency } from 'util/db/query-ir/resolve'
import {
  compileFilterNode,
  compileOrGroup,
} from 'util/db/query-ir/translate/filterToSql'
import {
  validateFilterNode,
  validateQueryPlan,
} from 'util/db/query-ir/validate'
import { describe, expect, it } from 'vitest'

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

// ============================================================
// compileOrGroup
// ============================================================

describe('compileOrGroup', () => {
  it('空のブランチで "1=1" を返す', () => {
    const orGroup: OrGroup = { branches: [], kind: 'or-group' }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.sql).toBe('1=1')
    expect(result.binds).toEqual([])
    expect(result.joins).toEqual([])
  })

  it('単一ブランチ・単一フィルタで括弧なしの条件を返す', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.sql).toBe('p.is_sensitive = ?')
    expect(result.binds).toEqual([0])
    expect(result.joins).toEqual([])
    // 単一ブランチなので外側の括弧がない
    expect(result.sql).not.toMatch(/^\(/)
  })

  it('単一ブランチ・複数フィルタで AND 結合される', () => {
    const orGroup: OrGroup = {
      branches: [
        [
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
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.sql).toContain('AND')
    expect(result.sql).toContain('p.is_sensitive = ?')
    expect(result.sql).toContain('p.is_reblog = ?')
    expect(result.binds).toEqual([0, 0])
  })

  it('2つのブランチで OR 結合と括弧を生成する', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
        [
          {
            column: 'is_reblog',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 1,
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.sql).toContain('OR')
    expect(result.sql).toMatch(/^\(.*OR.*\)$/)
    expect(result.binds).toEqual([0, 1])
  })

  it('TimelineScope を含むブランチで JOIN を収集する', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.joins.length).toBeGreaterThan(0)
    expect(result.joins[0].table).toBe('timeline_entries')
    expect(result.joins[0].type).toBe('inner')
    expect(result.joins[0].alias).toBe('te')
    expect(result.sql).toContain('te.timeline_key = ?')
    expect(result.sql).toContain('te.local_account_id = ?')
    expect(result.binds).toContain('home')
    expect(result.binds).toContain(1)
  })

  it('アカウント別タイムラインスコープを OR 結合できる', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
        [
          {
            accountScope: [2],
            kind: 'timeline-scope',
            timelineKeys: ['local'],
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    expect(result.sql).toContain('OR')
    // timeline_key の値はバインド変数なので SQL には含まれない
    expect(result.sql).toContain('te.timeline_key = ?')
    expect(result.binds).toContain('home')
    expect(result.binds).toContain('local')
    expect(result.binds).toContain(1)
    expect(result.binds).toContain(2)
    expect(result.joins.length).toBeGreaterThan(0)
    expect(result.joins[0].table).toBe('timeline_entries')
  })

  it('1=1 のみのブランチは無視される', () => {
    const orGroup: OrGroup = {
      branches: [
        [], // 空のブランチ → branchConditions が空 → branchSqls に追加されない
        [
          {
            column: 'is_reblog',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    // 有効なブランチが1つだけなので OR は含まない
    expect(result.sql).not.toContain('OR')
    expect(result.sql).toBe('p.is_reblog = ?')
  })

  it('複数フィルタの各ブランチが括弧で囲まれる', () => {
    const orGroup: OrGroup = {
      branches: [
        [
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
        [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 1,
          },
          {
            column: 'is_reblog',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 1,
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileOrGroup(orGroup, 'posts', 'p')

    // 外側の括弧 + 各ブランチ内の AND が括弧で囲まれる
    expect(result.sql).toMatch(/^\(/)
    expect(result.sql).toContain('OR')
    expect(result.binds).toEqual([0, 0, 1, 1])
  })
})

// ============================================================
// compileFilterNode ディスパッチ
// ============================================================

describe('compileFilterNode — OrGroup ディスパッチ', () => {
  it('OrGroup が compileFilterNode から正しくディスパッチされる', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            column: 'is_sensitive',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 0,
          },
        ],
        [
          {
            column: 'is_reblog',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 1,
          },
        ],
      ],
      kind: 'or-group',
    }
    const result = compileFilterNode(orGroup, 'posts', 'p')

    expect(result.sql).toContain('OR')
    expect(result.binds).toEqual([0, 1])
  })

  it('compileFilterNode の結果が compileOrGroup と一致する', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
      ],
      kind: 'or-group',
    }
    const fromDispatch = compileFilterNode(orGroup, 'posts', 'p')
    const fromDirect = compileOrGroup(orGroup, 'posts', 'p')

    expect(fromDispatch.sql).toBe(fromDirect.sql)
    expect(fromDispatch.binds).toEqual(fromDirect.binds)
    expect(fromDispatch.joins).toEqual(fromDirect.joins)
  })
})

// ============================================================
// resolveTableDependency
// ============================================================

describe('resolveTableDependency — OrGroup', () => {
  it('全ブランチの依存を再帰的に解決する', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
        [{ kind: 'backend-filter', localAccountIds: [2] }],
      ],
      kind: 'or-group',
    }
    const deps = resolveTableDependency(orGroup, 'posts')

    expect(deps.length).toBe(2)
    const tables = deps.map((d) => d.table)
    expect(tables).toContain('timeline_entries')
    expect(tables).toContain('post_backend_ids')
  })

  it('空のブランチは依存なしで空配列を返す', () => {
    const orGroup: OrGroup = { branches: [], kind: 'or-group' }
    const deps = resolveTableDependency(orGroup, 'posts')

    expect(deps).toHaveLength(0)
  })

  it('複数ブランチで同一テーブル参照時に重複して返す', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            accountScope: [1],
            kind: 'timeline-scope',
            timelineKeys: ['home'],
          },
        ],
        [
          {
            accountScope: [2],
            kind: 'timeline-scope',
            timelineKeys: ['local'],
          },
        ],
      ],
      kind: 'or-group',
    }
    const deps = resolveTableDependency(orGroup, 'posts')

    // resolveTableDependency はノード単位なので重複排除しない
    // resolveAllDependencies がプラン全体で重複排除する
    expect(deps.length).toBe(2)
    expect(deps.every((d) => d.table === 'timeline_entries')).toBe(true)
    expect(deps.every((d) => d.strategy === 'inner-join')).toBe(true)
  })

  it('ネストされたフィルタの依存を正しく解決する', () => {
    const orGroup: OrGroup = {
      branches: [
        [
          {
            column: 'language',
            kind: 'table-filter',
            op: '=',
            table: 'posts',
            value: 'ja',
          },
        ],
        [
          {
            column: 'acct',
            kind: 'table-filter',
            op: '=',
            table: 'profiles',
            value: 'user@example',
          },
        ],
      ],
      kind: 'or-group',
    }
    const deps = resolveTableDependency(orGroup, 'posts')

    expect(deps.length).toBe(2)
    const tables = deps.map((d) => d.table)
    expect(tables).toContain('posts')
    expect(tables).toContain('profiles')

    const postsDep = deps.find((d) => d.table === 'posts')
    expect(postsDep?.strategy).toBe('direct')

    const profilesDep = deps.find((d) => d.table === 'profiles')
    expect(profilesDep?.strategy).toBe('exists')
  })
})

// ============================================================
// validateQueryPlan / validateFilterNode — OrGroup
// ============================================================

describe('validateQueryPlan — OrGroup', () => {
  it('空のブランチで警告を出す', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [{ branches: [], kind: 'or-group' }],
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('OrGroup has no branches')
  })

  it('空の個別ブランチで警告を出す', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            branches: [
              [],
              [
                {
                  column: 'is_reblog',
                  kind: 'table-filter',
                  op: '=',
                  table: 'posts',
                  value: 0,
                },
              ],
            ],
            kind: 'or-group',
          },
        ],
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('OrGroup has an empty branch')
  })

  it('ブランチ内の不正なフィルタでエラーが伝播する', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            branches: [
              [
                {
                  column: 'x',
                  kind: 'table-filter',
                  op: '=',
                  table: 'nonexistent',
                  value: 1,
                },
              ],
            ],
            kind: 'or-group',
          },
        ],
      }),
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('nonexistent'))).toBe(true)
  })

  it('有効な OrGroup フィルタでエラーなし', () => {
    const result = validateQueryPlan(
      makePlan({
        filters: [
          {
            branches: [
              [
                {
                  column: 'is_sensitive',
                  kind: 'table-filter',
                  op: '=',
                  table: 'posts',
                  value: 0,
                },
              ],
              [
                {
                  column: 'is_reblog',
                  kind: 'table-filter',
                  op: '=',
                  table: 'posts',
                  value: 1,
                },
              ],
            ],
            kind: 'or-group',
          },
        ],
      }),
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('validateFilterNode — OrGroup', () => {
  it('空ブランチの OrGroup で警告を返す', () => {
    const result = validateFilterNode(
      { branches: [], kind: 'or-group' },
      'posts',
    )
    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('OrGroup has no branches')
  })

  it('ブランチ内のバリデーションエラーを検出する', () => {
    const result = validateFilterNode(
      {
        branches: [
          [
            {
              column: 'language',
              kind: 'table-filter',
              op: 'IS NULL',
              table: 'posts',
              value: 'should_not_be_here',
            },
          ],
        ],
        kind: 'or-group',
      },
      'posts',
    )
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('IS NULL'))).toBe(true)
  })
})

// ============================================================
// compileQueryPlan — OrGroup 統合テスト
// ============================================================

describe('compileQueryPlan — OrGroup 統合', () => {
  it('OrGroup フィルタ付き QueryPlan で OR 条件の SQL を生成する', () => {
    const plan = makePlan({
      filters: [
        {
          branches: [
            [
              {
                column: 'is_sensitive',
                kind: 'table-filter',
                op: '=',
                table: 'posts',
                value: 0,
              },
            ],
            [
              {
                column: 'is_reblog',
                kind: 'table-filter',
                op: '=',
                table: 'posts',
                value: 1,
              },
            ],
          ],
          kind: 'or-group',
        },
      ],
    })
    const result = compileQueryPlan(plan)
    const idStep = result.steps[0] as IdCollectStep

    expect(idStep.type).toBe('id-collect')
    expect(idStep.sql).toContain('WHERE')
    expect(idStep.sql).toContain('OR')
    expect(idStep.sql).toContain('p.is_sensitive = ?')
    expect(idStep.sql).toContain('p.is_reblog = ?')
    expect(idStep.binds).toContain(0)
    expect(idStep.binds).toContain(1)
  })

  it('TimelineScope ブランチの OrGroup で INNER JOIN + OR WHERE を生成する', () => {
    const plan = makePlan({
      filters: [
        {
          branches: [
            [
              {
                accountScope: [1],
                kind: 'timeline-scope',
                timelineKeys: ['home'],
              },
            ],
            [
              {
                accountScope: [2],
                kind: 'timeline-scope',
                timelineKeys: ['local'],
              },
            ],
          ],
          kind: 'or-group',
        },
      ],
    })
    const result = compileQueryPlan(plan)
    const idStep = result.steps[0] as IdCollectStep

    expect(idStep.sql).toContain('INNER JOIN timeline_entries te')
    expect(idStep.sql).toContain('OR')
    expect(idStep.sql).toContain('GROUP BY p.id')
    expect(idStep.binds).toContain('home')
    expect(idStep.binds).toContain('local')
    expect(idStep.binds).toContain(1)
    expect(idStep.binds).toContain(2)
  })

  it('OrGroup と他のフィルタを AND で組み合わせる', () => {
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
          branches: [
            [
              {
                column: 'language',
                kind: 'table-filter',
                op: '=',
                table: 'posts',
                value: 'ja',
              },
            ],
            [
              {
                column: 'language',
                kind: 'table-filter',
                op: '=',
                table: 'posts',
                value: 'en',
              },
            ],
          ],
          kind: 'or-group',
        },
      ],
    })
    const result = compileQueryPlan(plan)
    const idStep = result.steps[0] as IdCollectStep

    expect(idStep.sql).toContain('WHERE')
    // 直接フィルタと OrGroup が AND で結合
    expect(idStep.sql).toContain('p.is_sensitive = ?')
    expect(idStep.sql).toContain('OR')
    expect(idStep.sql).toContain('p.language = ?')
    expect(idStep.binds).toContain(0)
    expect(idStep.binds).toContain('ja')
    expect(idStep.binds).toContain('en')
  })
})
