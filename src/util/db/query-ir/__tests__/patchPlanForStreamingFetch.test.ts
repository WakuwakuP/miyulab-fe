import { describe, expect, it } from 'vitest'

import type {
  GetIdsNode,
  LookupRelatedNode,
  MergeNodeV2,
  OutputNodeV2,
  PaginationCursor,
  QueryPlanV2,
} from '../nodes'
import { patchPlanForStreamingFetch } from '../patchPlanForFetch'

// --------------- ヘルパー ---------------

/** テスト用の最小 QueryPlanV2 を生成 */
function makePlan(overrides?: Partial<QueryPlanV2>): QueryPlanV2 {
  return {
    edges: [{ source: 'get-posts', target: 'output' }],
    nodes: [
      {
        id: 'get-posts',
        node: {
          filters: [],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: 'output',
        node: {
          kind: 'output-v2',
          pagination: { limit: 20 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
    ...overrides,
  }
}

const afterCursor: PaginationCursor = {
  direction: 'after',
  field: 'created_at_ms',
  value: 5000,
}

// --------------- テスト ---------------

describe('patchPlanForStreamingFetch', () => {
  it('changedTables に含まれるテーブルの get-ids にカーソルが適用される', () => {
    const plan = makePlan()
    const changed = new Set(['posts'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toEqual({
      column: 'created_at_ms',
      op: '>',
      value: 5000,
    })
  })

  it('changedTables に含まれないテーブルの get-ids にはカーソルが適用されない', () => {
    const plan: QueryPlanV2 = {
      edges: [{ source: 'get-hashtags', target: 'output' }],
      nodes: [
        {
          id: 'get-hashtags',
          node: {
            filters: [],
            kind: 'get-ids',
            table: 'hashtags',
          },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['posts'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toBeUndefined()
  })

  it('outputTimeColumn が null のテーブルでは ID ベースカーソルにフォールバックする', () => {
    const plan: QueryPlanV2 = {
      edges: [{ source: 'get-tags', target: 'output' }],
      nodes: [
        {
          id: 'get-tags',
          node: {
            filters: [],
            kind: 'get-ids',
            outputTimeColumn: null,
            table: 'post_tags',
          },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['post_tags'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toEqual({
      column: 'id',
      op: '>',
      value: 5000,
    })
  })

  it('outputTimeColumn が null で outputIdColumn 指定ありの場合はそれを使う', () => {
    const plan: QueryPlanV2 = {
      edges: [{ source: 'get-tags', target: 'output' }],
      nodes: [
        {
          id: 'get-tags',
          node: {
            filters: [],
            kind: 'get-ids',
            outputIdColumn: 'tag_id',
            outputTimeColumn: null,
            table: 'post_tags',
          },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['post_tags'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toEqual({
      column: 'tag_id',
      op: '>',
      value: 5000,
    })
  })

  it('output-v2 ノードは changedTables に関係なくカーソルと limit を受け取る', () => {
    const plan = makePlan()
    const changed = new Set<string>()
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const output = patched.nodes.find((n) => n.node.kind === 'output-v2')
    const node = output?.node as OutputNodeV2
    expect(node.pagination.cursor).toEqual(afterCursor)
    expect(node.pagination.limit).toBe(50)
  })

  it('merge-v2 の limit が不足時に引き上げる', () => {
    const plan: QueryPlanV2 = {
      edges: [
        { source: 'get-posts', target: 'merge' },
        { source: 'merge', target: 'output' },
      ],
      nodes: [
        {
          id: 'get-posts',
          node: { filters: [], kind: 'get-ids', table: 'posts' },
        },
        {
          id: 'merge',
          node: { kind: 'merge-v2', limit: 10, strategy: 'union' },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['posts'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const merge = patched.nodes.find((n) => n.node.kind === 'merge-v2')
    const node = merge?.node as MergeNodeV2
    expect(node.limit).toBe(50)
  })

  it('複数 get-ids ノードで changedTables に含まれるものだけカーソルが付く', () => {
    const plan: QueryPlanV2 = {
      edges: [
        { source: 'get-posts', target: 'merge' },
        { source: 'get-notif', target: 'merge' },
        { source: 'merge', target: 'output' },
      ],
      nodes: [
        {
          id: 'get-posts',
          node: { filters: [], kind: 'get-ids', table: 'posts' },
        },
        {
          id: 'get-notif',
          node: { filters: [], kind: 'get-ids', table: 'notifications' },
        },
        {
          id: 'merge',
          node: { kind: 'merge-v2', limit: 20, strategy: 'union' },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['posts'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const posts = patched.nodes.find((n) => n.id === 'get-posts')
    const notif = patched.nodes.find((n) => n.id === 'get-notif')
    expect((posts?.node as GetIdsNode).cursor).toBeDefined()
    expect((notif?.node as GetIdsNode).cursor).toBeUndefined()
  })

  it('lookup-related ノードはそのまま通過する', () => {
    const lookupNode: LookupRelatedNode = {
      joinConditions: [{ inputColumn: 'id', lookupColumn: 'post_id' }],
      kind: 'lookup-related',
      lookupTable: 'post_tags',
    }
    const plan: QueryPlanV2 = {
      edges: [
        { source: 'get-posts', target: 'lookup' },
        { source: 'lookup', target: 'output' },
      ],
      nodes: [
        {
          id: 'get-posts',
          node: { filters: [], kind: 'get-ids', table: 'posts' },
        },
        { id: 'lookup', node: lookupNode },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['posts'])
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const lookup = patched.nodes.find((n) => n.id === 'lookup')
    expect(lookup?.node).toEqual(lookupNode)
  })

  it('changedTables が空の場合、全 get-ids ノードにカーソルが付かない', () => {
    const plan = makePlan()
    const changed = new Set<string>()
    const patched = patchPlanForStreamingFetch(plan, 50, afterCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toBeUndefined()
  })

  it('before カーソルで正しい演算子が使われる', () => {
    const plan = makePlan()
    const changed = new Set(['posts'])
    const beforeCursor: PaginationCursor = {
      direction: 'before',
      field: 'created_at_ms',
      value: 3000,
    }
    const patched = patchPlanForStreamingFetch(plan, 50, beforeCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor?.op).toBe('<')
  })

  it('元の plan を変更しない (immutable)', () => {
    const plan = makePlan()
    const originalNodes = JSON.stringify(plan.nodes)
    patchPlanForStreamingFetch(plan, 50, afterCursor, new Set(['posts']))
    expect(JSON.stringify(plan.nodes)).toBe(originalNodes)
  })

  it('id フィールドカーソルで outputIdColumn を使用する', () => {
    const plan: QueryPlanV2 = {
      edges: [{ source: 'get-entries', target: 'output' }],
      nodes: [
        {
          id: 'get-entries',
          node: {
            filters: [],
            kind: 'get-ids',
            outputIdColumn: 'post_id',
            table: 'timeline_entries',
          },
        },
        {
          id: 'output',
          node: {
            kind: 'output-v2',
            pagination: { limit: 20 },
            sort: { direction: 'DESC', field: 'created_at_ms' },
          },
        },
      ],
      version: 2,
    }
    const changed = new Set(['timeline_entries'])
    const idCursor: PaginationCursor = {
      direction: 'after',
      field: 'id',
      value: 42,
    }
    const patched = patchPlanForStreamingFetch(plan, 50, idCursor, changed)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const node = getIds?.node as GetIdsNode
    expect(node.cursor).toEqual({
      column: 'post_id',
      op: '>',
      value: 42,
    })
  })
})
