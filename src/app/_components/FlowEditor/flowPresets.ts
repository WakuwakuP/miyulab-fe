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
              column: 'timeline_key',
              op: 'IN',
              table: 'timeline_entries',
              value: ['home'],
            },
          ],
          kind: 'get-ids',
          outputIdColumn: 'post_id',
          table: 'timeline_entries',
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
              column: 'timeline_key',
              op: 'IN',
              table: 'timeline_entries',
              value: ['local'],
            },
          ],
          kind: 'get-ids',
          outputIdColumn: 'post_id',
          table: 'timeline_entries',
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
          outputIdColumn: 'post_id',
          table: 'post_hashtags',
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

/** hashtags → post_hashtags → posts（メディア付きのみ） */
function hashtagMediaPlan(): QueryPlanV2 {
  const tagNode = uid()
  const postNode = uid()
  const out = uid()
  return {
    edges: [
      { source: tagNode, target: postNode },
      { source: postNode, target: out },
    ],
    nodes: [
      {
        id: tagNode,
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
          outputIdColumn: 'post_id',
          table: 'post_hashtags',
        },
      },
      {
        id: postNode,
        node: {
          filters: [
            {
              column: 'id',
              op: 'IN',
              table: 'posts',
              upstreamSourceNodeId: tagNode,
              value: [],
            },
            { mode: 'exists', table: 'post_media' },
          ],
          kind: 'get-ids',
          table: 'posts',
        },
      },
      {
        id: out,
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
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: {
          filters: [
            {
              column: 'timeline_key',
              op: 'IN',
              table: 'timeline_entries',
              value: ['home', 'local'],
            },
          ],
          kind: 'get-ids',
          outputIdColumn: 'post_id',
          table: 'timeline_entries',
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

/** 通知 → 関連投稿(lookup) → merge で通知と投稿を合流 */
function aerialReplyPlan(): QueryPlanV2 {
  const n = uid()
  const l = uid()
  const m = uid()
  const o = uid()
  return {
    edges: [
      { source: n, target: l },
      { source: n, target: m },
      { source: l, target: m },
      { source: m, target: o },
    ],
    nodes: [
      {
        id: n,
        node: {
          filters: [
            {
              column: 'name',
              op: 'IN',
              table: 'notification_types',
              value: ['favourite', 'emoji_reaction', 'reblog'],
            },
          ],
          kind: 'get-ids',
          table: 'notifications',
        },
      },
      {
        id: l,
        node: {
          joinConditions: [
            {
              inputColumn: 'actor_profile_id',
              lookupColumn: 'author_profile_id',
            },
          ],
          kind: 'lookup-related',
          lookupTable: 'posts',
          timeCondition: {
            afterInput: true,
            inputTimeColumn: 'created_at_ms',
            lookupTimeColumn: 'created_at_ms',
            windowMs: 180000,
          },
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
    'ハッシュタグでフィルタした投稿（post_hashtags 経由）',
    hashtagPlan,
  ),
  makePreset(
    'hashtag-media',
    'ハッシュタグ（メディア）',
    'ハッシュタグに該当しメディア付きの投稿のみ',
    hashtagMediaPlan,
  ),
  makePreset(
    'composite',
    'ホーム + ローカル',
    'ホームとローカルを1本のタイムラインエントリクエリで取得',
    compositePlan,
  ),
  makePreset(
    'aerial-reply',
    '空中リプライ',
    '通知と関連投稿をマージして表示',
    aerialReplyPlan,
  ),
]
