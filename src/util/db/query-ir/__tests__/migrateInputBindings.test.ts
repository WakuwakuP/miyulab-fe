import { describe, expect, it } from 'vitest'
import { migrateInputBindings } from '../migrateInputBindings'
import type { FilterCondition, GetIdsNode } from '../nodes'

type GetIdsConfig = Pick<
  GetIdsNode,
  'filters' | 'inputBinding' | 'inputBindings' | 'table'
>

describe('migrateInputBindings', () => {
  // --- 正常系 ---
  it('一致するフィルタがある場合、upstreamSourceNodeId に sourceNodeId が設定されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [{ column: 'user_id', op: '=', table: 'posts', value: '123' }],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const filter = result.filters[0] as FilterCondition
    expect(filter.upstreamSourceNodeId).toBe('node-1')
  })

  it('一致するフィルタの op が IN 以外の場合、op が IN に上書きされること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [{ column: 'user_id', op: '=', table: 'posts', value: '123' }],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const filter = result.filters[0] as FilterCondition
    expect(filter.op).toBe('IN')
  })

  it('一致するフィルタの op が NOT IN の場合、NOT IN が維持されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [
        {
          column: 'user_id',
          op: 'NOT IN',
          table: 'posts',
          value: ['a', 'b'],
        },
      ],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const filter = result.filters[0] as FilterCondition
    expect(filter.op).toBe('NOT IN')
    expect(filter.upstreamSourceNodeId).toBe('node-1')
  })

  it('一致するフィルタの value がクリアされること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [
        { column: 'user_id', op: 'IN', table: 'posts', value: ['a', 'b'] },
      ],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const filter = result.filters[0] as FilterCondition
    expect(filter.value).toBeUndefined()
  })

  it('一致するフィルタがない場合、新規 FilterCondition が追加されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [{ column: 'status', op: '=', table: 'posts', value: 'active' }],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toHaveLength(2)
    const added = result.filters[1] as FilterCondition
    expect(added.column).toBe('user_id')
    expect(added.upstreamSourceNodeId).toBe('node-1')
  })

  it('一致するフィルタがない場合、新規 FilterCondition の op が IN であること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const added = result.filters[0] as FilterCondition
    expect(added.op).toBe('IN')
  })

  it('一致するフィルタがない場合、新規 FilterCondition の table が config.table と一致すること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [],
      inputBinding: undefined,
      inputBindings: [{ column: 'target_id', sourceNodeId: 'node-2' }],
      table: 'notifications',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const added = result.filters[0] as FilterCondition
    expect(added.table).toBe('notifications')
  })

  it('複数の inputBindings がある場合、すべて一括変換されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [
        { column: 'user_id', op: '=', table: 'posts', value: '123' },
        { column: 'category_id', op: '=', table: 'posts', value: '456' },
      ],
      inputBinding: undefined,
      inputBindings: [
        { column: 'user_id', sourceNodeId: 'node-1' },
        { column: 'category_id', sourceNodeId: 'node-2' },
      ],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toHaveLength(2)
    const filter0 = result.filters[0] as FilterCondition
    expect(filter0.upstreamSourceNodeId).toBe('node-1')
    expect(filter0.op).toBe('IN')
    const filter1 = result.filters[1] as FilterCondition
    expect(filter1.upstreamSourceNodeId).toBe('node-2')
    expect(filter1.op).toBe('IN')
  })

  // --- 境界値 ---
  it('inputBindings が空配列の場合、フィルタを変更しないこと', () => {
    // Arrange
    const originalFilters: FilterCondition[] = [
      { column: 'user_id', op: '=', table: 'posts', value: '123' },
    ]
    const config: GetIdsConfig = {
      filters: [...originalFilters],
      inputBinding: undefined,
      inputBindings: [],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toEqual(originalFilters)
  })

  it('inputBindings が undefined の場合、config をそのまま返すこと', () => {
    // Arrange
    const originalFilters: FilterCondition[] = [
      { column: 'user_id', op: '=', table: 'posts', value: '123' },
    ]
    const config: GetIdsConfig = {
      filters: [...originalFilters],
      inputBinding: undefined,
      inputBindings: undefined,
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toEqual(originalFilters)
  })

  it('filters が空配列で inputBindings がある場合、新規 FilterCondition のみ追加されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [],
      inputBinding: undefined,
      inputBindings: [
        { column: 'user_id', sourceNodeId: 'node-1' },
        { column: 'tag_id', sourceNodeId: 'node-2' },
      ],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toHaveLength(2)
    const f0 = result.filters[0] as FilterCondition
    expect(f0.column).toBe('user_id')
    expect(f0.op).toBe('IN')
    expect(f0.table).toBe('posts')
    expect(f0.upstreamSourceNodeId).toBe('node-1')
    const f1 = result.filters[1] as FilterCondition
    expect(f1.column).toBe('tag_id')
    expect(f1.op).toBe('IN')
    expect(f1.table).toBe('posts')
    expect(f1.upstreamSourceNodeId).toBe('node-2')
  })

  // --- 異常系 ---
  it('同じ column を持つフィルタが複数ある場合、最初に一致したフィルタのみ変換されること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [
        { column: 'user_id', op: '=', table: 'posts', value: 'first' },
        { column: 'user_id', op: '!=', table: 'posts', value: 'second' },
      ],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result.filters).toHaveLength(2)
    const first = result.filters[0] as FilterCondition
    expect(first.upstreamSourceNodeId).toBe('node-1')
    expect(first.op).toBe('IN')
    expect(first.value).toBeUndefined()
    const second = result.filters[1] as FilterCondition
    expect(second.upstreamSourceNodeId).toBeUndefined()
    expect(second.op).toBe('!=')
    expect(second.value).toBe('second')
  })

  // --- 制約条件 ---
  describe('変換後のクリーンアップ', () => {
    it('変換後に inputBindings が undefined になること', () => {
      // Arrange
      const config: GetIdsConfig = {
        filters: [{ column: 'user_id', op: '=', table: 'posts', value: '123' }],
        inputBinding: undefined,
        inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
        table: 'posts',
      }

      // Act
      const result = migrateInputBindings(config)

      // Assert
      expect(result.inputBindings).toBeUndefined()
    })

    it('変換後に inputBinding が undefined になること', () => {
      // Arrange
      const config: GetIdsConfig = {
        filters: [{ column: 'user_id', op: '=', table: 'posts', value: '123' }],
        inputBinding: undefined,
        inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
        table: 'posts',
      }

      // Act
      const result = migrateInputBindings(config)

      // Assert
      expect(result.inputBinding).toBeUndefined()
    })

    it('旧 inputBinding (column のみ) がある場合もクリアされること', () => {
      // Arrange
      const config: GetIdsConfig = {
        filters: [{ column: 'user_id', op: '=', table: 'posts', value: '123' }],
        inputBinding: { column: 'user_id' },
        inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
        table: 'posts',
      }

      // Act
      const result = migrateInputBindings(config)

      // Assert
      expect(result.inputBinding).toBeUndefined()
      expect(result.inputBindings).toBeUndefined()
    })

    it('inputBindings が空配列の場合でも inputBindings と inputBinding がクリアされること', () => {
      // Arrange
      const config: GetIdsConfig = {
        filters: [],
        inputBinding: { column: 'user_id' },
        inputBindings: [],
        table: 'posts',
      }

      // Act
      const result = migrateInputBindings(config)

      // Assert
      expect(result.inputBindings).toBeUndefined()
      expect(result.inputBinding).toBeUndefined()
    })
  })

  // --- 状態遷移 ---
  it('既に upstreamSourceNodeId が設定済みのフィルタがある場合、inputBindings の値で上書きされること', () => {
    // Arrange
    const config: GetIdsConfig = {
      filters: [
        {
          column: 'user_id',
          op: 'IN',
          table: 'posts',
          upstreamSourceNodeId: 'old-node',
        },
      ],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'new-node' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    const filter = result.filters[0] as FilterCondition
    expect(filter.upstreamSourceNodeId).toBe('new-node')
  })

  it('元の config が変更されず新しいオブジェクトが返ること', () => {
    // Arrange
    const originalFilter: FilterCondition = {
      column: 'user_id',
      op: '=',
      table: 'posts',
      value: '123',
    }
    const config: GetIdsConfig = {
      filters: [originalFilter],
      inputBinding: undefined,
      inputBindings: [{ column: 'user_id', sourceNodeId: 'node-1' }],
      table: 'posts',
    }

    // Act
    const result = migrateInputBindings(config)

    // Assert
    expect(result).not.toBe(config)
    expect(result.filters).not.toBe(config.filters)
    expect(originalFilter.op).toBe('=')
    expect(originalFilter.value).toBe('123')
    expect(originalFilter.upstreamSourceNodeId).toBeUndefined()
    expect(config.inputBindings).toHaveLength(1)
  })
})
