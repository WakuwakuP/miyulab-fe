import { describe, expect, it } from 'vitest'

import type {
  GetIdsNode,
  MergeNodeV2,
  OutputNodeV2,
  PaginationCursor,
  QueryPlanV2,
} from '../nodes'
import { patchPlanForFetch } from '../patchPlanForFetch'

// テスト用の最小 QueryPlanV2 を生成
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

describe('patchPlanForFetch', () => {
  it('output-v2 の limit を上書きする', () => {
    const plan = makePlan()
    const patched = patchPlanForFetch(plan, 50)
    const output = patched.nodes.find((n) => n.node.kind === 'output-v2')
    const outputNode = output?.node as OutputNodeV2
    expect(outputNode.pagination.limit).toBe(50)
  })

  it('output-v2 にカーソルを設定する', () => {
    const plan = makePlan()
    const cursor: PaginationCursor = {
      direction: 'before',
      field: 'created_at_ms',
      value: 1000,
    }
    const patched = patchPlanForFetch(plan, 50, cursor)
    const output = patched.nodes.find((n) => n.node.kind === 'output-v2')
    const outputNode = output?.node as OutputNodeV2
    expect(outputNode.pagination.cursor).toEqual(cursor)
  })

  it('get-ids に before カーソルの push down 条件を追加する', () => {
    const plan = makePlan()
    const cursor: PaginationCursor = {
      direction: 'before',
      field: 'created_at_ms',
      value: 5000,
    }
    const patched = patchPlanForFetch(plan, 50, cursor)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const getIdsNode = getIds?.node as GetIdsNode
    expect(getIdsNode.cursor).toEqual({
      column: 'created_at_ms',
      op: '<',
      value: 5000,
    })
  })

  it('get-ids に after カーソルの push down 条件を追加する', () => {
    const plan = makePlan()
    const cursor: PaginationCursor = {
      direction: 'after',
      field: 'created_at_ms',
      value: 2000,
    }
    const patched = patchPlanForFetch(plan, 50, cursor)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const getIdsNode = getIds?.node as GetIdsNode
    expect(getIdsNode.cursor).toEqual({
      column: 'created_at_ms',
      op: '>',
      value: 2000,
    })
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
    const patched = patchPlanForFetch(plan, 50)
    const merge = patched.nodes.find((n) => n.node.kind === 'merge-v2')
    const mergeNode = merge?.node as MergeNodeV2
    expect(mergeNode.limit).toBe(50)
  })

  it('merge-v2 の limit が十分な場合はそのまま', () => {
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
          node: { kind: 'merge-v2', limit: 100, strategy: 'union' },
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
    const patched = patchPlanForFetch(plan, 50)
    const merge = patched.nodes.find((n) => n.node.kind === 'merge-v2')
    const mergeNode = merge?.node as MergeNodeV2
    expect(mergeNode.limit).toBe(100)
  })

  it('カーソルなしの場合は get-ids に cursor を設定しない', () => {
    const plan = makePlan()
    const patched = patchPlanForFetch(plan, 50)
    const getIds = patched.nodes.find((n) => n.node.kind === 'get-ids')
    const getIdsNode = getIds?.node as GetIdsNode
    expect(getIdsNode.cursor).toBeUndefined()
  })

  it('元の plan を変更しない (immutable)', () => {
    const plan = makePlan()
    const originalNodes = JSON.stringify(plan.nodes)
    patchPlanForFetch(plan, 100, {
      direction: 'before',
      field: 'created_at_ms',
      value: 999,
    })
    expect(JSON.stringify(plan.nodes)).toBe(originalNodes)
  })

  describe('FK→posts パターン (timeSourceJoin)', () => {
    it('outputIdColumn=post_id の中間テーブルに timeSourceJoin と cursor が設定される', () => {
      const plan: QueryPlanV2 = {
        edges: [
          { source: 'get-hashtags', target: 'get-post-hashtags' },
          { source: 'get-post-hashtags', target: 'output' },
        ],
        nodes: [
          {
            id: 'get-hashtags',
            node: {
              filters: [
                { column: 'name', op: 'IN', table: 'hashtags', value: ['foo'] },
              ],
              kind: 'get-ids',
              table: 'hashtags',
            },
          },
          {
            id: 'get-post-hashtags',
            node: {
              filters: [
                {
                  column: 'hashtag_id',
                  op: 'IN',
                  table: 'post_hashtags',
                  upstreamSourceNodeId: 'get-hashtags',
                },
              ],
              kind: 'get-ids',
              outputIdColumn: 'post_id',
              table: 'post_hashtags',
            },
          },
          {
            id: 'output',
            node: {
              kind: 'output-v2',
              pagination: { limit: 50 },
              sort: { direction: 'DESC', field: 'created_at_ms' },
            },
          },
        ],
        version: 2,
      }
      const cursor: PaginationCursor = {
        direction: 'before',
        field: 'created_at_ms',
        value: 9999,
      }
      const patched = patchPlanForFetch(plan, 50, cursor)
      const ph = patched.nodes.find((n) => n.id === 'get-post-hashtags')
      const phNode = ph?.node as GetIdsNode
      expect(phNode.cursor).toEqual({
        column: 'created_at_ms',
        op: '<',
        value: 9999,
      })
      expect(phNode.timeSourceJoin).toEqual({
        foreignColumn: 'id',
        localColumn: 'post_id',
        table: 'posts',
        timeColumn: 'created_at_ms',
      })
    })

    it('outputIdColumn が post_id でない場合は timeSourceJoin を設定しない', () => {
      const plan: QueryPlanV2 = {
        edges: [{ source: 'get-nodes', target: 'output' }],
        nodes: [
          {
            id: 'get-nodes',
            node: {
              filters: [],
              kind: 'get-ids',
              outputIdColumn: 'hashtag_id',
              table: 'post_hashtags',
            },
          },
          {
            id: 'output',
            node: {
              kind: 'output-v2',
              pagination: { limit: 50 },
              sort: { direction: 'DESC', field: 'created_at_ms' },
            },
          },
        ],
        version: 2,
      }
      const cursor: PaginationCursor = {
        direction: 'before',
        field: 'created_at_ms',
        value: 9999,
      }
      const patched = patchPlanForFetch(plan, 50, cursor)
      const node = patched.nodes.find((n) => n.id === 'get-nodes')
      const n = node?.node as GetIdsNode
      expect(n.timeSourceJoin).toBeUndefined()
      expect(n.cursor).toBeUndefined()
    })

    it('cursor が id フィールドの場合は timeSourceJoin を設定しない', () => {
      const plan: QueryPlanV2 = {
        edges: [{ source: 'get-ph', target: 'output' }],
        nodes: [
          {
            id: 'get-ph',
            node: {
              filters: [],
              kind: 'get-ids',
              outputIdColumn: 'post_id',
              table: 'post_hashtags',
            },
          },
          {
            id: 'output',
            node: {
              kind: 'output-v2',
              pagination: { limit: 50 },
              sort: { direction: 'DESC', field: 'id' },
            },
          },
        ],
        version: 2,
      }
      const cursor: PaginationCursor = {
        direction: 'before',
        field: 'id',
        value: 100,
      }
      const patched = patchPlanForFetch(plan, 50, cursor)
      const node = patched.nodes.find((n) => n.id === 'get-ph')
      const n = node?.node as GetIdsNode
      expect(n.timeSourceJoin).toBeUndefined()
      // ID カーソルは outputIdColumn に直接 push down される
      expect(n.cursor).toEqual({ column: 'post_id', op: '<', value: 100 })
    })
  })
})
