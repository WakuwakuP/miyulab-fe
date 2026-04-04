import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { inferFlowSourceType } from '../inferFlowSourceType'
import type {
  FlowEdge,
  FlowNodeData,
  GetIdsFlowNodeData,
  LookupRelatedFlowNodeData,
  MergeFlowNodeDataV2,
  OutputFlowNodeDataV2,
} from '../types'

// ============================================================
// テストヘルパー
// ============================================================

type FlowNode = Node<FlowNodeData>

function makeGetIdsNode(
  id: string,
  table: string,
  outputIdColumn?: string,
): FlowNode {
  return {
    data: {
      config: {
        filters: [],
        kind: 'get-ids',
        outputIdColumn,
        table,
      },
      nodeType: 'get-ids',
    } satisfies GetIdsFlowNodeData,
    id,
    position: { x: 0, y: 0 },
    type: 'get-ids',
  }
}

function makeLookupNode(id: string, lookupTable: string): FlowNode {
  return {
    data: {
      config: {
        joinConditions: [],
        kind: 'lookup-related',
        lookupTable,
      },
      nodeType: 'lookup-related',
    } satisfies LookupRelatedFlowNodeData,
    id,
    position: { x: 0, y: 0 },
    type: 'lookup-related',
  }
}

function makeMergeNode(id: string): FlowNode {
  return {
    data: {
      config: {
        kind: 'merge-v2',
        limit: 100,
        strategy: 'union',
      },
      nodeType: 'merge-v2',
    } satisfies MergeFlowNodeDataV2,
    id,
    position: { x: 0, y: 0 },
    type: 'merge-v2',
  }
}

function makeOutputNode(id: string): FlowNode {
  return {
    data: {
      config: {
        kind: 'output-v2',
        pagination: { limit: 40 },
        sort: { direction: 'DESC', field: 'created_at_ms' },
      },
      nodeType: 'output-v2',
    } satisfies OutputFlowNodeDataV2,
    id,
    position: { x: 0, y: 0 },
    type: 'output-v2',
  }
}

function edge(source: string, target: string): FlowEdge {
  return { id: `e-${source}-${target}`, source, target }
}

// ============================================================
// テスト
// ============================================================

describe('inferFlowSourceType', () => {
  it('posts のみの場合は "post" を返す', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'timeline_entries', 'post_id'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [edge('g1', 'out')]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('post')
  })

  it('posts テーブルから直接取得する場合は "post" を返す', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'posts'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [edge('g1', 'out')]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('post')
  })

  it('notifications のみの場合は "notification" を返す', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'notifications'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [edge('g1', 'out')]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('notification')
  })

  it('posts と notifications が混在する場合は "mixed" を返す', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'posts'),
      makeGetIdsNode('g2', 'notifications'),
      makeMergeNode('m1'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [
      edge('g1', 'm1'),
      edge('g2', 'm1'),
      edge('m1', 'out'),
    ]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('mixed')
  })

  it('上流ノードが接続されていない場合は "unknown" を返す', () => {
    const nodes: FlowNode[] = [makeOutputNode('out')]
    const edges: FlowEdge[] = []

    expect(inferFlowSourceType('out', nodes, edges)).toBe('unknown')
  })

  it('lookup-related ノード経由で notifications に解決される場合', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'posts'),
      makeLookupNode('l1', 'notifications'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [edge('g1', 'l1'), edge('l1', 'out')]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('mixed')
  })

  it('outputIdColumn が related_post_id の場合 posts に解決される', () => {
    const nodes: FlowNode[] = [
      makeGetIdsNode('g1', 'notifications', 'related_post_id'),
      makeOutputNode('out'),
    ]
    const edges: FlowEdge[] = [edge('g1', 'out')]

    expect(inferFlowSourceType('out', nodes, edges)).toBe('post')
  })
})
