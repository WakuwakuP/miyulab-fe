import { describe, expect, it } from 'vitest'

import type {
  BackendFilter,
  ExistsFilter,
  FilterNode,
  ModerationFilter,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from '../../nodes'
import { nodesToWhere, nodeToSqlFragment } from '../nodesToWhere'
import { parseWhereToNodes } from '../whereToNodes'

// ---------------------------------------------------------------------------
// nodesToWhere
// ---------------------------------------------------------------------------

describe('nodesToWhere', () => {
  // --- 正常系: TimelineScope ---
  describe('TimelineScope', () => {
    it("timelineKeysが1件の時、ptt.timelineType = 'x' 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'timeline-scope', timelineKeys: ['home'] },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("ptt.timelineType = 'home'")
    })

    it("timelineKeysが複数件の時、ptt.timelineType IN ('a', 'b') 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'timeline-scope', timelineKeys: ['home', 'local'] },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("ptt.timelineType IN ('home', 'local')")
    })

    it('timelineKeysが3件以上の時、すべてのキーがIN句にカンマ区切りで含まれること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          kind: 'timeline-scope',
          timelineKeys: ['home', 'local', 'federated'],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("ptt.timelineType IN ('home', 'local', 'federated')")
    })
  })

  // --- 正常系: TableFilter 演算子別 ---
  describe('TableFilter — 演算子別', () => {
    it("op が '=' の時、alias.column = value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog = 0')
    })

    it("op が '!=' の時、alias.column != value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '!=',
          table: 'posts',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog != 1')
    })

    it("op が '>' の時、alias.column > value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'favourites_count',
          kind: 'table-filter',
          op: '>',
          table: 'post_stats',
          value: 5,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('ps.favourites_count > 5')
    })

    it("op が '>=' の時、alias.column >= value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'favourites_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 10,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('ps.favourites_count >= 10')
    })

    it("op が '<' の時、alias.column < value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'reblogs_count',
          kind: 'table-filter',
          op: '<',
          table: 'post_stats',
          value: 3,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('ps.reblogs_count < 3')
    })

    it("op が '<=' の時、alias.column <= value 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'reblogs_count',
          kind: 'table-filter',
          op: '<=',
          table: 'post_stats',
          value: 100,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('ps.reblogs_count <= 100')
    })

    it("op が 'LIKE' の時、alias.column LIKE 'pattern' 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'content',
          kind: 'table-filter',
          op: 'LIKE',
          table: 'posts',
          value: '%hello%',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.content LIKE '%hello%'")
    })

    it("op が 'NOT LIKE' の時、alias.column NOT LIKE 'pattern' 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'content',
          kind: 'table-filter',
          op: 'NOT LIKE',
          table: 'posts',
          value: '%spam%',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.content NOT LIKE '%spam%'")
    })

    it("op が 'GLOB' の時、alias.column GLOB 'pattern' 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'content',
          kind: 'table-filter',
          op: 'GLOB',
          table: 'posts',
          value: '*test*',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.content GLOB '*test*'")
    })

    it("op が 'IS NULL' の時、alias.column IS NULL 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'in_reply_to_uri',
          kind: 'table-filter',
          op: 'IS NULL',
          table: 'posts',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.in_reply_to_uri IS NULL')
    })

    it("op が 'IS NOT NULL' の時、alias.column IS NOT NULL 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'in_reply_to_uri',
          kind: 'table-filter',
          op: 'IS NOT NULL',
          table: 'posts',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.in_reply_to_uri IS NOT NULL')
    })
  })

  // --- 正常系: TableFilter IN / NOT IN ---
  describe('TableFilter — IN / NOT IN', () => {
    it("op が 'IN' で value が配列の時、alias.column IN (v1, v2) 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'visibility_types',
          value: ['public', 'unlisted'],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("vt.name IN ('public', 'unlisted')")
    })

    it("op が 'NOT IN' で value が配列の時、alias.column NOT IN (v1, v2) 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: 'NOT IN',
          table: 'visibility_types',
          value: ['direct', 'private'],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("vt.name NOT IN ('direct', 'private')")
    })

    it("op が 'IN' で value が文字列の時、alias.column = 'value' 形式（=に変換）のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'visibility_types',
          value: 'public',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("vt.name = 'public'")
    })

    it("op が 'NOT IN' で value が文字列の時、alias.column != 'value' 形式（!=に変換）のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: 'NOT IN',
          table: 'visibility_types',
          value: 'direct',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("vt.name != 'direct'")
    })

    it("op が 'IN' で value が数値の時、alias.column = value 形式（=に変換）のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: 'IN',
          table: 'posts',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog = 1')
    })

    it("op が 'NOT IN' で value が数値の時、alias.column != value 形式（!=に変換）のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: 'NOT IN',
          table: 'posts',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog != 1')
    })

    it('IN の配列に文字列が含まれる時、各要素がシングルクォートで囲まれること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'hashtags',
          value: ['photo', 'art', 'music'],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("ht.name IN ('photo', 'art', 'music')")
    })

    it('IN の配列に数値が含まれる時、各要素がクォートなしで出力されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'id',
          kind: 'table-filter',
          op: 'IN',
          table: 'posts',
          value: [1, 2, 3],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.id IN (1, 2, 3)')
    })

    it('IN の配列に文字列と数値が混在する時、文字列のみクォートされること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'tag',
          kind: 'table-filter',
          op: 'IN',
          table: 'posts',
          value: ['hello', 42, 'world'],
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.tag IN ('hello', 42, 'world')")
    })
  })

  // --- 正常系: TableFilter 値の型 ---
  describe('TableFilter — 値の型', () => {
    it('value が文字列の時、シングルクォートで囲まれたSQL文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'language',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 'ja',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.language = 'ja'")
    })

    it('value が数値の時、クォートなしのSQL文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog = 1')
    })

    it('value が0の時、クォートなしで0として出力されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_sensitive',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_sensitive = 0')
    })
  })

  // --- 正常系: TableFilter テーブルエイリアスマッピング ---
  describe('TableFilter — テーブルエイリアスマッピング', () => {
    it("table が 'posts' の時、エイリアス 'p' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'id',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.id = 1')
    })

    it("table が 'profiles' の時、エイリアス 'pr' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'acct',
          kind: 'table-filter',
          op: '=',
          table: 'profiles',
          value: 'user@example.com',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("pr.acct = 'user@example.com'")
    })

    it("table が 'hashtags' の時、エイリアス 'ht' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'hashtags',
          value: 'photo',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("ht.name = 'photo'")
    })

    it("table が 'notification_types' の時、エイリアス 'nt' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'notification_types',
          value: 'favourite',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("nt.name = 'favourite'")
    })

    it("table が 'post_interactions' の時、エイリアス 'pe' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_bookmarked',
          kind: 'table-filter',
          op: '=',
          table: 'post_interactions',
          value: 1,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('pe.is_bookmarked = 1')
    })

    it("table が 'post_media' の時、エイリアス 'post_media' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'type',
          kind: 'table-filter',
          op: '=',
          table: 'post_media',
          value: 'image',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("post_media.type = 'image'")
    })

    it("table が 'post_mentions' の時、エイリアス 'pme' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'acct',
          kind: 'table-filter',
          op: '=',
          table: 'post_mentions',
          value: 'user@example.com',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("pme.acct = 'user@example.com'")
    })

    it("table が 'post_stats' の時、エイリアス 'ps' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'favourites_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 10,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('ps.favourites_count >= 10')
    })

    it("table が 'visibility_types' の時、エイリアス 'vt' が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'visibility_types',
          value: 'public',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("vt.name = 'public'")
    })

    it('table がマッピングに存在しない時、テーブル名がそのままエイリアスとして使用されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'col',
          kind: 'table-filter',
          op: '=',
          table: 'unknown_table',
          value: 'val',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("unknown_table.col = 'val'")
    })
  })

  // --- 正常系: ExistsFilter ---
  describe('ExistsFilter', () => {
    it("mode が 'exists' の時、EXISTS(SELECT 1 FROM table WHERE post_id = p.id) 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it("mode が 'not-exists' の時、NOT EXISTS(SELECT 1 FROM table WHERE post_id = p.id) 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'exists-filter', mode: 'not-exists', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it("mode が 'count-gte' で countValue が指定されている時、(SELECT COUNT(*) ...) >= countValue 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          countValue: 3,
          kind: 'exists-filter',
          mode: 'count-gte',
          table: 'post_media',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3',
      )
    })

    it("mode が 'count-lte' で countValue が指定されている時、(SELECT COUNT(*) ...) <= countValue 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          countValue: 5,
          kind: 'exists-filter',
          mode: 'count-lte',
          table: 'post_media',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) <= 5',
      )
    })

    it("mode が 'count-eq' で countValue が指定されている時、(SELECT COUNT(*) ...) = countValue 形式のSQL文字列が返ること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          countValue: 2,
          kind: 'exists-filter',
          mode: 'count-eq',
          table: 'post_media',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) = 2',
      )
    })
  })

  // --- 境界値: ExistsFilter countValue デフォルト ---
  describe('ExistsFilter — countValue デフォルト値', () => {
    it("mode が 'count-gte' で countValue が未指定の時、デフォルト値 1 が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'exists-filter', mode: 'count-gte', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 1',
      )
    })

    it("mode が 'count-lte' で countValue が未指定の時、デフォルト値 0 が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'exists-filter', mode: 'count-lte', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) <= 0',
      )
    })

    it("mode が 'count-eq' で countValue が未指定の時、デフォルト値 0 が使用されること", () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'exists-filter', mode: 'count-eq', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) = 0',
      )
    })

    it("mode が 'count-gte' で countValue が 0 の時、0 が使用されること（デフォルトではなく明示値）", () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          countValue: 0,
          kind: 'exists-filter',
          mode: 'count-gte',
          table: 'post_media',
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 0',
      )
    })
  })

  // --- 正常系: RawSQLFilter ---
  describe('RawSQLFilter', () => {
    it('raw-sql-filter の時、where プロパティの文字列がそのまま返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'raw-sql-filter', where: "p.content LIKE '%hello%'" },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.content LIKE '%hello%'")
    })

    it('raw-sql-filter のwhere に複雑なSQL式が含まれる時、変換されずそのまま返ること', () => {
      // Arrange
      const complexSql =
        "(p.created_at > '2024-01-01' AND p.language IN ('ja', 'en')) OR p.is_reblog = 0"
      const nodes: FilterNode[] = [
        { kind: 'raw-sql-filter', where: complexSql },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(complexSql)
    })
  })

  // --- 制約条件: BackendFilter / ModerationFilter スキップ ---
  describe('BackendFilter / ModerationFilter のスキップ', () => {
    it('backend-filter ノードのみの配列の時、空文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'backend-filter', localAccountIds: [1, 2] },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('')
    })

    it('moderation-filter ノードのみの配列の時、空文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { apply: ['mute', 'instance-block'], kind: 'moderation-filter' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('')
    })

    it('backend-filter と他のフィルタが混在する時、backend-filter が除外されて他のフィルタのみがAND結合されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'backend-filter', localAccountIds: [1] },
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
        { kind: 'timeline-scope', timelineKeys: ['home'] },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe("p.is_reblog = 0 AND ptt.timelineType = 'home'")
    })

    it('moderation-filter と他のフィルタが混在する時、moderation-filter が除外されて他のフィルタのみがAND結合されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { apply: ['mute'], kind: 'moderation-filter' },
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
        { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        'p.is_reblog = 0 AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })
  })

  // --- 正常系: 複数フィルタの AND 結合 ---
  describe('複数フィルタの AND 結合', () => {
    it('複数のフィルタノードが渡された時、各条件が AND で結合された文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
        {
          column: 'is_sensitive',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog = 0 AND p.is_sensitive = 0')
    })

    it('異なる種類のノード（timeline-scope + table-filter + exists-filter）が渡された時、すべてがAND結合されること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        { kind: 'timeline-scope', timelineKeys: ['home'] },
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
        { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe(
        "ptt.timelineType = 'home' AND p.is_reblog = 0 AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)",
      )
    })

    it('フィルタが1件のみの時、AND なしで単一条件の文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = [
        {
          column: 'is_reblog',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 0,
        },
      ]

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('p.is_reblog = 0')
      expect(result).not.toContain('AND')
    })
  })

  // --- 境界値: 空配列 ---
  describe('空配列', () => {
    it('空の配列が渡された時、空文字列が返ること', () => {
      // Arrange
      const nodes: FilterNode[] = []

      // Act
      const result = nodesToWhere(nodes)

      // Assert
      expect(result).toBe('')
    })
  })
})

// ---------------------------------------------------------------------------
// nodeToSqlFragment
// ---------------------------------------------------------------------------

describe('nodeToSqlFragment', () => {
  // --- 正常系: 各ノード種別のSQL変換 ---
  describe('timeline-scope', () => {
    it("timelineKeysが1件の時、ptt.timelineType = 'x' 形式のSQL断片が返ること", () => {
      // Arrange
      const node: TimelineScope = {
        kind: 'timeline-scope',
        timelineKeys: ['home'],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe("ptt.timelineType = 'home'")
    })

    it('timelineKeysが複数件の時、ptt.timelineType IN (...) 形式のSQL断片が返ること', () => {
      // Arrange
      const node: TimelineScope = {
        kind: 'timeline-scope',
        timelineKeys: ['home', 'local'],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe("ptt.timelineType IN ('home', 'local')")
    })
  })

  describe('table-filter', () => {
    it('通常の比較演算子の時、alias.column op value 形式のSQL断片が返ること', () => {
      // Arrange
      const node: TableFilter = {
        column: 'favourites_count',
        kind: 'table-filter',
        op: '>=',
        table: 'post_stats',
        value: 10,
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('ps.favourites_count >= 10')
    })

    it('IS NULL の時、alias.column IS NULL 形式のSQL断片が返ること', () => {
      // Arrange
      const node: TableFilter = {
        column: 'in_reply_to_uri',
        kind: 'table-filter',
        op: 'IS NULL',
        table: 'posts',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('p.in_reply_to_uri IS NULL')
    })

    it('IN で配列の時、alias.column IN (...) 形式のSQL断片が返ること', () => {
      // Arrange
      const node: TableFilter = {
        column: 'name',
        kind: 'table-filter',
        op: 'IN',
        table: 'hashtags',
        value: ['photo', 'art'],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe("ht.name IN ('photo', 'art')")
    })
  })

  describe('exists-filter', () => {
    it("mode が 'exists' の時、EXISTS サブクエリ形式のSQL断片が返ること", () => {
      // Arrange
      const node: ExistsFilter = {
        kind: 'exists-filter',
        mode: 'exists',
        table: 'post_media',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe(
        'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it("mode が 'not-exists' の時、NOT EXISTS サブクエリ形式のSQL断片が返ること", () => {
      // Arrange
      const node: ExistsFilter = {
        kind: 'exists-filter',
        mode: 'not-exists',
        table: 'post_media',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe(
        'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it("mode が 'count-gte' の時、COUNT サブクエリ >= N 形式のSQL断片が返ること", () => {
      // Arrange
      const node: ExistsFilter = {
        countValue: 3,
        kind: 'exists-filter',
        mode: 'count-gte',
        table: 'post_media',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3',
      )
    })

    it("mode が 'count-lte' の時、COUNT サブクエリ <= N 形式のSQL断片が返ること", () => {
      // Arrange
      const node: ExistsFilter = {
        countValue: 2,
        kind: 'exists-filter',
        mode: 'count-lte',
        table: 'post_media',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) <= 2',
      )
    })

    it("mode が 'count-eq' の時、COUNT サブクエリ = N 形式のSQL断片が返ること", () => {
      // Arrange
      const node: ExistsFilter = {
        countValue: 4,
        kind: 'exists-filter',
        mode: 'count-eq',
        table: 'post_media',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) = 4',
      )
    })
  })

  describe('raw-sql-filter', () => {
    it('where プロパティの文字列がそのまま返ること', () => {
      // Arrange
      const node: RawSQLFilter = {
        kind: 'raw-sql-filter',
        where: "p.content LIKE '%test%'",
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe("p.content LIKE '%test%'")
    })
  })

  // --- 正常系: backend-filter / moderation-filter の表示用変換 ---
  describe('backend-filter', () => {
    it('localAccountIds が渡された時、backend_filter(id1, id2) 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: BackendFilter = {
        kind: 'backend-filter',
        localAccountIds: [1, 2],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('backend_filter(1, 2)')
    })

    it('localAccountIds が1件の時、backend_filter(id) 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: BackendFilter = {
        kind: 'backend-filter',
        localAccountIds: [42],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('backend_filter(42)')
    })

    it('localAccountIds が空配列の時、backend_filter() 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: BackendFilter = {
        kind: 'backend-filter',
        localAccountIds: [],
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('backend_filter()')
    })
  })

  describe('moderation-filter', () => {
    it('apply が複数の時、moderation(mute, instance-block) 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: ModerationFilter = {
        apply: ['mute', 'instance-block'],
        kind: 'moderation-filter',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('moderation(mute, instance-block)')
    })

    it('apply が1件の時、moderation(mute) 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: ModerationFilter = {
        apply: ['mute'],
        kind: 'moderation-filter',
      }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('moderation(mute)')
    })

    it('apply が空配列の時、moderation() 形式の表示用文字列が返ること', () => {
      // Arrange
      const node: ModerationFilter = { apply: [], kind: 'moderation-filter' }

      // Act
      const result = nodeToSqlFragment(node)

      // Assert
      expect(result).toBe('moderation()')
    })
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parseWhereToNodes → nodesToWhere
// ---------------------------------------------------------------------------

describe('Round-trip: parseWhereToNodes → nodesToWhere', () => {
  // --- 正常系 ---
  it("タイムラインスコープ単体をパースして逆変換した時、元のSQL 'ptt.timelineType = ...' と同等の文字列が返ること", () => {
    // Arrange
    const sql = "ptt.timelineType = 'home'"

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe("ptt.timelineType = 'home'")
  })

  it("複数キーのタイムラインスコープをパースして逆変換した時、元のSQL 'ptt.timelineType IN (...)' と同等の文字列が返ること", () => {
    // Arrange
    const sql = "ptt.timelineType IN ('home', 'local')"

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe("ptt.timelineType IN ('home', 'local')")
  })

  it("posts テーブルの等値フィルタをパースして逆変換した時、元のSQL 'p.column = value' と同等の文字列が返ること", () => {
    // Arrange
    const sql = 'p.is_reblog = 0'

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe('p.is_reblog = 0')
  })

  it('数値比較フィルタ（ps.favourites_count >= 10）をパースして逆変換した時、同等のSQL文字列が返ること', () => {
    // Arrange
    const sql = 'ps.favourites_count >= 10'

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe('ps.favourites_count >= 10')
  })

  it('EXISTS フィルタをパースして逆変換した時、同等のSQL文字列が返ること', () => {
    // Arrange
    const sql = 'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe('EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)')
  })

  it('IS NULL フィルタをパースして逆変換した時、同等のSQL文字列が返ること', () => {
    // Arrange
    const sql = 'p.in_reply_to_uri IS NULL'

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe('p.in_reply_to_uri IS NULL')
  })

  it('AND 結合された複数条件をパースして逆変換した時、同等のSQL文字列が返ること', () => {
    // Arrange
    const sql =
      "ptt.timelineType = 'home' AND p.is_reblog = 0 AND ps.favourites_count >= 10"

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    expect(result).toBe(
      "ptt.timelineType = 'home' AND p.is_reblog = 0 AND ps.favourites_count >= 10",
    )
  })

  // --- 制約条件 ---
  it('whereToNodes でIN配列に変換されるパターン（ht.name = x）は、nodesToWhere で IN (x) 形式に展開されること（元のSQLとは異なる正規化が起こること）', () => {
    // Arrange
    const sql = "ht.name = 'photo'"

    // Act
    const { nodes } = parseWhereToNodes(sql)
    const result = nodesToWhere(nodes)

    // Assert
    // parseWhereToNodes converts ht.name = 'photo' into a TableFilter with op: 'IN', value: ['photo']
    // nodesToWhere then outputs it as IN ('photo') — different from the original = 'photo'
    expect(result).toBe("ht.name IN ('photo')")
    expect(result).not.toBe(sql)
  })

  // --- AerialReplyFilter ---
  describe('AerialReplyFilter', () => {
    it('デフォルト設定の空中リプフィルタを WHERE に変換する', () => {
      const nodes: FilterNode[] = [
        {
          kind: 'aerial-reply-filter',
          notificationTypes: ['favourite', 'reaction', 'reblog'],
          timeWindowMs: 180000,
        },
      ]
      const result = nodesToWhere(nodes)
      expect(result).toContain('EXISTS')
      expect(result).toContain('notification_types')
      expect(result).toContain("'favourite'")
      expect(result).toContain("'reaction'")
      expect(result).toContain("'reblog'")
      expect(result).toContain('180000')
    })

    it('通知タイプが1つの場合も正しく変換する', () => {
      const nodes: FilterNode[] = [
        {
          kind: 'aerial-reply-filter',
          notificationTypes: ['favourite'],
          timeWindowMs: 60000,
        },
      ]
      const result = nodesToWhere(nodes)
      expect(result).toContain("'favourite'")
      expect(result).toContain('60000')
      expect(result).not.toContain("'reaction'")
    })

    it('nodeToSqlFragment でも正しく変換される', () => {
      const result = nodeToSqlFragment({
        kind: 'aerial-reply-filter',
        notificationTypes: ['favourite', 'reblog'],
        timeWindowMs: 300000,
      })
      expect(result).toContain('EXISTS')
      expect(result).toContain('300000')
    })

    it('他のフィルタと組み合わせて変換できる', () => {
      const nodes: FilterNode[] = [
        { kind: 'timeline-scope', timelineKeys: ['home'] },
        {
          kind: 'aerial-reply-filter',
          notificationTypes: ['favourite'],
          timeWindowMs: 180000,
        },
      ]
      const result = nodesToWhere(nodes)
      expect(result).toContain('ptt.timelineType')
      expect(result).toContain('EXISTS')
    })
  })
})
