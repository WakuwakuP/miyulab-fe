// ============================================================
// flowPresets — フローエディタ用プリセットテンプレート
// ============================================================

import type { QueryPlanV2 } from 'util/db/query-ir/nodes'

export type FlowPreset = {
  id: string
  label: string
  description: string
  plan: () => QueryPlanV2
}

let counter = 0
function uid(): string {
  return `preset-${++counter}-${Date.now().toString(36)}`
}

function makePreset(
  id: string,
  label: string,
  description: string,
  buildPlan: () => QueryPlanV2,
): FlowPreset {
  return { description, id, label, plan: buildPlan }
}

// --------------- 個別プリセット ---------------

function homePlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [
            {
              column: 'timeline_type',
              op: 'IN',
              table: 'timeline_entries',
              value: ['home'],
            },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function localPlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [
            {
              column: 'timeline_type',
              op: 'IN',
              table: 'timeline_entries',
              value: ['local'],
            },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function notificationPlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [],
          kind: 'get-ids',
          table: 'notifications',
        },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function mediaPlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [{ mode: 'exists', table: 'post_media' }],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function hashtagPlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [
            {
              innerFilters: [
                { column: 'name', op: 'IN', table: 'hashtags', value: [] },
              ],
              mode: 'exists',
              table: 'post_hashtags',
            },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function compositePlan(): QueryPlanV2 {
  const a = uid()
  const b = uid()
  const m = uid()
  const o = uid()
  return {
    edges: [
      { source: a, target: m },
      { source: b, target: m },
      { source: m, target: o },
    ],
    nodes: [
      {
        id: a,
        node: {
          filters: [
            {
              column: 'timeline_type',
              op: 'IN',
              table: 'timeline_entries',
              value: ['home'],
            },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: b,
        node: {
          filters: [
            {
              column: 'timeline_type',
              op: 'IN',
              table: 'timeline_entries',
              value: ['local'],
            },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: m,
        node: {
          kind: 'merge-v2',
          limit: 200,
          strategy: 'interleave-by-time',
        },
      },
      {
        id: o,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

// --------------- エクスポート ---------------

export const FLOW_PRESETS: FlowPreset[] = [
  makePreset('home', 'ホーム', 'ホームタイムラインの投稿', homePlan),
  makePreset('local', 'ローカル', 'ローカルタイムラインの投稿', localPlan),
  makePreset('notification', '通知', 'すべての通知を表示', notificationPlan),
  makePreset('media', 'メディア', 'メディア付き投稿のみ', mediaPlan),
  makePreset(
    'hashtag',
    'ハッシュタグ',
    'ハッシュタグでフィルタした投稿',
    hashtagPlan,
  ),
  makePreset(
    'composite',
    'ホーム + ローカル',
    'ホームとローカルを結合',
    compositePlan,
  ),
]
