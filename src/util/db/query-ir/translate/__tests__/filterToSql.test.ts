import type {
  AerialReplyFilter,
  BackendFilter,
  ExistsFilter,
  ModerationFilter,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from '../../nodes'
import type { TableDependency } from '../../resolve'
import {
  compileBackendFilter,
  compileFilterNode,
  compileModerationFilter,
  compileTimelineScope,
  formatCondition,
  translateDirectCondition,
  translateExistsCondition,
  translateScalarSubquery,
} from '../filterToSql'

// ============================================================
// formatCondition
// ============================================================

describe('formatCondition', () => {
  it('= 演算子で ? プレースホルダを生成する', () => {
    const result = formatCondition('p.id', '=', 42)
    expect(result.sql).toBe('p.id = ?')
    expect(result.binds).toEqual([42])
  })

  it('IS NULL で値なしの SQL を生成する', () => {
    const result = formatCondition('p.language', 'IS NULL', undefined)
    expect(result.sql).toBe('p.language IS NULL')
    expect(result.binds).toEqual([])
  })

  it('IS NOT NULL で値なしの SQL を生成する', () => {
    const result = formatCondition('p.language', 'IS NOT NULL', undefined)
    expect(result.sql).toBe('p.language IS NOT NULL')
    expect(result.binds).toEqual([])
  })

  it('IN 演算子で複数プレースホルダを生成する', () => {
    const result = formatCondition('p.id', 'IN', [1, 2, 3])
    expect(result.sql).toBe('p.id IN (?, ?, ?)')
    expect(result.binds).toEqual([1, 2, 3])
  })

  it('NOT IN 演算子で複数プレースホルダを生成する', () => {
    const result = formatCondition('p.id', 'NOT IN', [10, 20])
    expect(result.sql).toBe('p.id NOT IN (?, ?)')
    expect(result.binds).toEqual([10, 20])
  })

  it('IN に空配列を渡すと 0 (常に false) を返す', () => {
    const result = formatCondition('p.id', 'IN', [])
    expect(result.sql).toBe('0')
    expect(result.binds).toEqual([])
  })

  it('NOT IN に空配列を渡すと 1 (常に true) を返す', () => {
    const result = formatCondition('p.id', 'NOT IN', [])
    expect(result.sql).toBe('1')
    expect(result.binds).toEqual([])
  })

  it('LIKE 演算子を正しく生成する', () => {
    const result = formatCondition('p.content', 'LIKE', '%hello%')
    expect(result.sql).toBe('p.content LIKE ?')
    expect(result.binds).toEqual(['%hello%'])
  })

  it('GLOB 演算子を正しく生成する', () => {
    const result = formatCondition('p.content', 'GLOB', '*hello*')
    expect(result.sql).toBe('p.content GLOB ?')
    expect(result.binds).toEqual(['*hello*'])
  })
})

// ============================================================
// translateDirectCondition
// ============================================================

describe('translateDirectCondition', () => {
  it('ソーステーブルのカラムに対する直接条件を生成する', () => {
    const node: TableFilter = {
      column: 'is_sensitive',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 1,
    }
    const result = translateDirectCondition(node, 'p')
    expect(result.sql).toBe('p.is_sensitive = ?')
    expect(result.binds).toEqual([1])
    expect(result.joins).toEqual([])
  })

  it('IN 演算子を含む直接条件を生成する', () => {
    const node: TableFilter = {
      column: 'language',
      kind: 'table-filter',
      op: 'IN',
      table: 'posts',
      value: ['ja', 'en'],
    }
    const result = translateDirectCondition(node, 'p')
    expect(result.sql).toBe('p.language IN (?, ?)')
    expect(result.binds).toEqual(['ja', 'en'])
    expect(result.joins).toEqual([])
  })
})

// ============================================================
// translateExistsCondition
// ============================================================

describe('translateExistsCondition', () => {
  it('ExistsFilter (exists) で EXISTS サブクエリを生成する', () => {
    const node: ExistsFilter = {
      kind: 'exists-filter',
      mode: 'exists',
      table: 'post_media',
    }
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_media',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('EXISTS (SELECT 1 FROM post_media')
    expect(result.sql).toContain('post_media.post_id = p.id')
    expect(result.binds).toEqual([])
    expect(result.joins).toEqual([])
  })

  it('ExistsFilter (not-exists) で NOT EXISTS サブクエリを生成する', () => {
    const node: ExistsFilter = {
      kind: 'exists-filter',
      mode: 'not-exists',
      table: 'post_media',
    }
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_media',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('NOT EXISTS (SELECT 1 FROM post_media')
    expect(result.sql).toContain('post_media.post_id = p.id')
    expect(result.binds).toEqual([])
    expect(result.joins).toEqual([])
  })

  it('ExistsFilter (count-gte) で COUNT サブクエリを生成する', () => {
    const node: ExistsFilter = {
      countValue: 3,
      kind: 'exists-filter',
      mode: 'count-gte',
      table: 'post_media',
    }
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_media',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('(SELECT COUNT(*)')
    expect(result.sql).toContain('>= ?')
    expect(result.binds).toContain(3)
  })

  it('ExistsFilter に innerFilters がある場合、内部条件を追加する', () => {
    const node: ExistsFilter = {
      innerFilters: [
        {
          column: 'description',
          kind: 'table-filter',
          op: 'IS NOT NULL',
          table: 'post_media',
        },
      ],
      kind: 'exists-filter',
      mode: 'exists',
      table: 'post_media',
    }
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_media',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('AND post_media.description IS NOT NULL')
  })

  it('TableFilter + exists 戦略で EXISTS を生成する', () => {
    const node: TableFilter = {
      column: 'favourites_count',
      kind: 'table-filter',
      op: '>=',
      table: 'post_stats',
      value: 10,
    }
    const dep: TableDependency = {
      cardinality: '1:1',
      joinPath: { column: 'post_id', sourceColumn: 'id' },
      strategy: 'exists',
      table: 'post_stats',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('EXISTS')
    expect(result.sql).toContain('post_stats.favourites_count >= ?')
    expect(result.binds).toEqual([10])
  })

  it('via チェーン経由の EXISTS を生成する', () => {
    const node: ExistsFilter = {
      innerFilters: [
        {
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'hashtags',
          value: 'test',
        },
      ],
      kind: 'exists-filter',
      mode: 'exists',
      table: 'hashtags',
    }
    const dep: TableDependency = {
      cardinality: '1:N',
      joinPath: {
        column: 'id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'post_hashtags',
            toColumn: 'hashtag_id',
          },
        ],
      },
      strategy: 'exists',
      table: 'hashtags',
    }
    const result = translateExistsCondition(node, dep, 'p')
    expect(result.sql).toContain('post_hashtags _via0')
    expect(result.sql).toContain('INNER JOIN hashtags')
    expect(result.binds).toEqual(['test'])
  })
})

// ============================================================
// translateScalarSubquery
// ============================================================

describe('translateScalarSubquery', () => {
  it('ルックアップテーブルに対するスカラーサブクエリを生成する', () => {
    const node: TableFilter = {
      column: 'name',
      kind: 'table-filter',
      op: '=',
      table: 'visibility_types',
      value: 'public',
    }
    const dep: TableDependency = {
      cardinality: 'lookup',
      joinPath: { column: 'id', sourceColumn: 'visibility_id' },
      strategy: 'scalar-subquery',
      table: 'visibility_types',
    }
    const result = translateScalarSubquery(node, dep, 'p')
    expect(result.sql).toContain(
      '(SELECT name FROM visibility_types WHERE id = p.visibility_id) = ?',
    )
    expect(result.binds).toEqual(['public'])
    expect(result.joins).toEqual([])
  })
})

// ============================================================
// compileBackendFilter
// ============================================================

describe('compileBackendFilter', () => {
  it('post_backend_ids に対する EXISTS サブクエリを生成する', () => {
    const node: BackendFilter = {
      kind: 'backend-filter',
      localAccountIds: [1, 2],
    }
    const result = compileBackendFilter(node, 'p')
    expect(result.sql).toContain(
      'EXISTS (SELECT 1 FROM post_backend_ids pbi WHERE pbi.post_id = p.id AND pbi.local_account_id IN (?, ?))',
    )
    expect(result.binds).toEqual([1, 2])
  })
})

// ============================================================
// compileModerationFilter
// ============================================================

describe('compileModerationFilter', () => {
  it('ミュートフィルタでNOT INサブクエリを生成する', () => {
    const node: ModerationFilter = {
      apply: ['mute'],
      kind: 'moderation-filter',
      serverIds: [1],
    }
    const result = compileModerationFilter(node, 'p', 'posts')
    expect(result.sql).toContain('NOT IN')
    expect(result.sql).toContain('muted_accounts')
  })

  it('インスタンスブロックフィルタでNOT EXISTSを生成する', () => {
    const node: ModerationFilter = {
      apply: ['instance-block'],
      kind: 'moderation-filter',
    }
    const result = compileModerationFilter(node, 'p', 'posts')
    expect(result.sql).toContain('NOT EXISTS')
    expect(result.sql).toContain('blocked_instances')
  })

  it('ミュート+インスタンスブロックの両方を結合する', () => {
    const node: ModerationFilter = {
      apply: ['mute', 'instance-block'],
      kind: 'moderation-filter',
      serverIds: [1],
    }
    const result = compileModerationFilter(node, 'p', 'posts')
    expect(result.sql).toContain('AND')
    expect(result.sql).toContain('muted_accounts')
    expect(result.sql).toContain('blocked_instances')
  })
})

// ============================================================
// compileTimelineScope
// ============================================================

describe('compileTimelineScope', () => {
  it('単一タイムラインキーでINNER JOINとWHEREを生成する', () => {
    const node: TimelineScope = {
      kind: 'timeline-scope',
      timelineKeys: ['home'],
    }
    const result = compileTimelineScope(node, 'p')
    expect(result.joins).toHaveLength(1)
    expect(result.joins[0]).toEqual(
      expect.objectContaining({
        alias: 'te',
        table: 'timeline_entries',
        type: 'inner',
      }),
    )
    expect(result.sql).toContain('te.timeline_key = ?')
    expect(result.binds).toEqual(['home'])
  })

  it('複数タイムラインキーでINを使う', () => {
    const node: TimelineScope = {
      kind: 'timeline-scope',
      timelineKeys: ['home', 'local'],
    }
    const result = compileTimelineScope(node, 'p')
    expect(result.sql).toContain('IN (?, ?)')
    expect(result.binds).toEqual(['home', 'local'])
  })

  it('accountScope ありで local_account_id 条件を追加する', () => {
    const node: TimelineScope = {
      accountScope: [1, 2],
      kind: 'timeline-scope',
      timelineKeys: ['home'],
    }
    const result = compileTimelineScope(node, 'p')
    expect(result.sql).toContain('te.local_account_id IN (?, ?)')
    expect(result.binds).toContain(1)
    expect(result.binds).toContain(2)
  })
})

// ============================================================
// compileFilterNode (main dispatcher)
// ============================================================

describe('compileFilterNode', () => {
  it('posts テーブルの直接フィルタをディスパッチする', () => {
    const node: TableFilter = {
      column: 'is_reblog',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 0,
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toContain('p.is_reblog = ?')
    expect(result.binds).toEqual([0])
  })

  it('レジストリに基づく exists 戦略にディスパッチする', () => {
    const node: TableFilter = {
      column: 'favourites_count',
      kind: 'table-filter',
      op: '>=',
      table: 'post_stats',
      value: 10,
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toContain('EXISTS')
  })

  it('raw-sql-filter をそのまま返す', () => {
    const node: RawSQLFilter = {
      kind: 'raw-sql-filter',
      where: 'p.id > 100',
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toBe('p.id > 100')
    expect(result.binds).toEqual([])
    expect(result.joins).toEqual([])
  })

  it('BackendFilter をディスパッチする', () => {
    const node: BackendFilter = {
      kind: 'backend-filter',
      localAccountIds: [5],
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toContain('post_backend_ids')
    expect(result.binds).toEqual([5])
  })

  it('TimelineScope をディスパッチする', () => {
    const node: TimelineScope = {
      kind: 'timeline-scope',
      timelineKeys: ['home'],
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toContain('te.timeline_key = ?')
    expect(result.joins).toHaveLength(1)
  })
})

// ============================================================
// compileAerialReplyFilter
// ============================================================

describe('compileAerialReplyFilter', () => {
  it('デフォルト設定で SQL とバインドパラメータを生成する', () => {
    const node: AerialReplyFilter = {
      kind: 'aerial-reply-filter',
      notificationTypes: ['favourite', 'emoji_reaction', 'reblog'],
      timeWindowMs: 180000,
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.sql).toContain('EXISTS')
    expect(result.sql).toContain('notification_types')
    expect(result.sql).toContain('ntt.name IN')
    // Should have bind params for notification types and time windows
    expect(result.binds.length).toBeGreaterThan(0)
    // Notification types as individual bind params
    expect(result.binds).toContain('favourite')
    expect(result.binds).toContain('emoji_reaction')
    expect(result.binds).toContain('reblog')
    // Time window appears twice in the query (for both checks)
    const timeWindowBinds = result.binds.filter((b) => b === 180000)
    expect(timeWindowBinds.length).toBe(2)
  })

  it('通知タイプが1つの場合のバインドパラメータ', () => {
    const node: AerialReplyFilter = {
      kind: 'aerial-reply-filter',
      notificationTypes: ['mention'],
      timeWindowMs: 60000,
    }
    const result = compileFilterNode(node, 'posts', 'p')
    expect(result.binds).toContain('mention')
    const timeWindowBinds = result.binds.filter((b) => b === 60000)
    expect(timeWindowBinds.length).toBe(2)
  })
})
