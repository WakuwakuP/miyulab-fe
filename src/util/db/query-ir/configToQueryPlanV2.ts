// ============================================================
// configToQueryPlanV2 — TimelineConfigV2 → QueryPlanV2 直接生成
//
// 既存の V1 パイプライン (configToQueryPlan → V1 → compilePhase1) を
// 迂回し、TimelineConfigV2 から直接 QueryPlanV2 グラフを生成する。
// ============================================================

import type { TimelineConfigV2 } from 'types/types'
import type {
  ExistsCondition,
  FilterCondition,
  GetIdsFilter,
  GetIdsNode,
  MergeNodeV2,
  OutputNodeV2,
  QueryPlanV2,
  QueryPlanV2Edge,
  QueryPlanV2Node,
} from './nodes'

// --------------- コンテキスト ---------------

export type ConfigToV2Context = {
  /** 対象 backendUrl から解決済みの local_account_id[] */
  localAccountIds: number[]
  /** 対象 backendUrl から解決済みの server_id[] (ミュート条件用) */
  serverIds: number[]
  /** 1回の取得件数上限 */
  queryLimit: number
}

// --------------- メイン関数 ---------------

/**
 * TimelineConfigV2 から QueryPlanV2 を生成する。
 *
 * タイムライン種別に応じてグラフ構造を構築:
 * - home/local/public → GetIds(timeline_entries) → Output
 * - tag → GetIds(posts, hashtag JOIN) → Output
 * - notification → GetIds(notifications) → Output
 * - composite (timelineTypes 複数指定) → GetIds×N → Merge → Output
 */
export function configToQueryPlanV2(
  config: TimelineConfigV2,
  context: ConfigToV2Context,
): QueryPlanV2 {
  const isNotification = config.type === 'notification'
  const isTag = config.type === 'tag'

  // タイムラインキーの決定
  const timelineKeys =
    !isNotification && !isTag
      ? config.timelineTypes && config.timelineTypes.length > 0
        ? [...config.timelineTypes]
        : [config.type]
      : []

  // composite: 複数の timelineTypes を持つ場合は Merge パターン
  const isComposite = !isNotification && !isTag && timelineKeys.length > 1

  if (isComposite) {
    return buildCompositeGraph(config, context, timelineKeys)
  }

  // 単一ソース
  const nodes: QueryPlanV2Node[] = []
  const edges: QueryPlanV2Edge[] = []

  // GetIds ノード
  const getIdsNode = buildGetIdsNode(config, context, timelineKeys)
  nodes.push({ id: 'source', node: getIdsNode })

  // Output ノード
  const outputNode = buildOutputNode(context.queryLimit)
  nodes.push({ id: 'output', node: outputNode })

  edges.push({ source: 'source', target: 'output' })

  return { edges, nodes, version: 2 }
}

// --------------- Composite グラフ ---------------

function buildCompositeGraph(
  config: TimelineConfigV2,
  context: ConfigToV2Context,
  timelineKeys: string[],
): QueryPlanV2 {
  const nodes: QueryPlanV2Node[] = []
  const edges: QueryPlanV2Edge[] = []

  // 各 timelineKey に対して GetIds ノードを生成
  for (let i = 0; i < timelineKeys.length; i++) {
    const key = timelineKeys[i]
    const singleConfig = {
      ...config,
      timelineTypes: undefined,
      type: key,
    } as TimelineConfigV2
    const getIdsNode = buildGetIdsNode(singleConfig, context, [key])
    const nodeId = `source-${key}`
    nodes.push({ id: nodeId, node: getIdsNode })
    edges.push({ source: nodeId, target: 'merge' })
  }

  // Merge ノード
  const mergeNode: MergeNodeV2 = {
    kind: 'merge-v2',
    limit: context.queryLimit,
    strategy: 'interleave-by-time',
  }
  nodes.push({ id: 'merge', node: mergeNode })

  // Output ノード
  const outputNode = buildOutputNode(context.queryLimit)
  nodes.push({ id: 'output', node: outputNode })
  edges.push({ source: 'merge', target: 'output' })

  return { edges, nodes, version: 2 }
}

// --------------- GetIds ノード構築 ---------------

function buildGetIdsNode(
  config: TimelineConfigV2,
  context: ConfigToV2Context,
  timelineKeys: string[],
): GetIdsNode {
  const isNotification = config.type === 'notification'
  const isTag = config.type === 'tag'
  const isTimelineScope = !isNotification && !isTag && timelineKeys.length > 0

  // home/local/public は timeline_entries からクエリ開始
  // (post_id を出力して Output で posts を参照)
  const table = isNotification
    ? 'notifications'
    : isTimelineScope
      ? 'timeline_entries'
      : 'posts'
  const filters: GetIdsFilter[] = []
  let orBranches: GetIdsFilter[][] | undefined

  // --- Timeline Scope (home/local/public) ---
  if (isTimelineScope) {
    // timeline_entries がソーステーブルなので direct filter
    filters.push({
      column: 'timeline_key',
      op: 'IN',
      table: 'timeline_entries',
      value: timelineKeys,
    })

    // home タイムラインはアカウントスコープが必要
    if (timelineKeys.includes('home') && context.localAccountIds.length > 0) {
      filters.push({
        column: 'local_account_id',
        op: 'IN',
        table: 'timeline_entries',
        value: [...context.localAccountIds],
      })
    }
  }

  // --- Tag (hashtag JOIN) ---
  if (isTag && config.tagConfig && config.tagConfig.tags.length > 0) {
    const { mode, tags } = config.tagConfig

    if (mode === 'or' || tags.length === 1) {
      // OR モード or 単一タグ: 1つの EXISTS で IN 句
      filters.push({
        innerFilters: [
          {
            column: 'name',
            op: 'IN',
            table: 'hashtags',
            value: tags.map((t) => t.toLowerCase()),
          },
        ],
        mode: 'exists',
        table: 'post_hashtags',
      } satisfies ExistsCondition)
    } else {
      // AND モード: 各タグを OR ブランチとして表現（各タグが存在する投稿）
      // → 実際には各タグの EXISTS を AND で結合
      for (const tag of tags) {
        filters.push({
          innerFilters: [
            {
              column: 'name',
              op: '=',
              table: 'hashtags',
              value: tag.toLowerCase(),
            },
          ],
          mode: 'exists',
          table: 'post_hashtags',
        } satisfies ExistsCondition)
      }
    }
  }

  // --- Backend Filter ---
  if (context.localAccountIds.length > 0) {
    if (isNotification) {
      // 通知テーブルは local_account_id を直接持つ
      filters.push({
        column: 'local_account_id',
        op: 'IN',
        table: 'notifications',
        value: [...context.localAccountIds],
      })
    } else if (!isTag) {
      // home/local/public は timeline_entries 経由（既に scope で対応）
      // tag は post_backend_ids 経由
    } else {
      // tag: post_backend_ids で対象バックエンドにスコープ
      filters.push({
        column: 'id',
        op: 'IN',
        table: 'local_accounts',
        value: [...context.localAccountIds],
      })
    }
  }

  // --- Content Filters ---
  addContentFilters(config, filters, table)

  // --- Moderation Filters ---
  addModerationFilters(config, context, filters)

  // --- Notification Type Filter ---
  if (isNotification && config.notificationFilter?.length) {
    filters.push({
      column: 'name',
      op: 'IN',
      table: 'notification_types',
      value: [...config.notificationFilter],
    })
  }

  return {
    filters,
    kind: 'get-ids',
    orBranches,
    // timeline_entries は post_id を出力 ID として使用
    outputIdColumn: isTimelineScope ? 'post_id' : undefined,
    table,
  }
}

// --------------- コンテンツフィルタ ---------------

function addContentFilters(
  config: TimelineConfigV2,
  filters: GetIdsFilter[],
  _table: string,
): void {
  // メディアフィルタ
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    filters.push({
      countValue: config.minMediaCount,
      mode: 'count-gte',
      table: 'post_media',
    } satisfies ExistsCondition)
  } else if (config.onlyMedia) {
    filters.push({
      mode: 'exists',
      table: 'post_media',
    } satisfies ExistsCondition)
  }

  // 公開範囲フィルタ
  if (
    config.visibilityFilter &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    filters.push({
      column: 'name',
      op: 'IN',
      table: 'visibility_types',
      value: [...config.visibilityFilter],
    } satisfies FilterCondition)
  }

  // 言語フィルタ — raw SQL は避け、OR 条件で表現
  // p.language IN (...) OR p.language IS NULL
  // → getIdsExecutor の compileFilterNode で処理される
  if (config.languageFilter && config.languageFilter.length > 0) {
    // NOTE: 言語フィルタは NULL を許可する必要がある。
    // V2 では OR ブランチとして表現はできないため、
    // legacyV1Overlay に raw SQL として残す代わりに
    // ExistsCondition の innerFilters で表現する。
    // → 暫定: FilterCondition で IN 句を使用
    //   NULL 許可は executor 側で別途処理が必要
    filters.push({
      column: 'language',
      op: 'IN',
      table: 'posts',
      value: [...config.languageFilter],
    } satisfies FilterCondition)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    filters.push({
      column: 'reblog_of_post_id',
      op: 'IS NULL',
      table: 'posts',
    } satisfies FilterCondition)
  }

  // リプライ除外
  if (config.excludeReplies) {
    filters.push({
      column: 'in_reply_to_uri',
      op: 'IS NULL',
      table: 'posts',
    } satisfies FilterCondition)
  }

  // CW 除外
  if (config.excludeSpoiler) {
    filters.push({
      column: 'spoiler_text',
      op: '=',
      table: 'posts',
      value: '',
    } satisfies FilterCondition)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    filters.push({
      column: 'is_sensitive',
      op: '=',
      table: 'posts',
      value: 0,
    } satisfies FilterCondition)
  }

  // アカウントフィルタ
  if (config.accountFilter && config.accountFilter.accts.length > 0) {
    filters.push({
      column: 'acct',
      op: config.accountFilter.mode === 'include' ? 'IN' : 'NOT IN',
      table: 'profiles',
      value: [...config.accountFilter.accts],
    } satisfies FilterCondition)
  }

  // フォロー限定
  if (config.followsOnly) {
    filters.push({
      mode: 'exists',
      table: 'follows',
    } satisfies ExistsCondition)
  }
}

// --------------- モデレーションフィルタ ---------------

function addModerationFilters(
  config: TimelineConfigV2,
  context: ConfigToV2Context,
  filters: GetIdsFilter[],
): void {
  const applyMute = config.applyMuteFilter ?? true
  const applyBlock = config.applyInstanceBlock ?? true

  // アカウントフィルタが include モードの場合、ミュートは不要
  if (applyMute && config.accountFilter?.mode !== 'include') {
    if (context.serverIds.length > 0) {
      filters.push({
        innerFilters: context.serverIds.map((sid) => ({
          column: 'server_id',
          op: '=' as const,
          table: 'muted_accounts',
          value: sid,
        })),
        mode: 'not-exists',
        table: 'muted_accounts',
      } satisfies ExistsCondition)
    } else {
      filters.push({
        mode: 'not-exists',
        table: 'muted_accounts',
      } satisfies ExistsCondition)
    }
  }

  if (applyBlock) {
    filters.push({
      mode: 'not-exists',
      table: 'blocked_instances',
    } satisfies ExistsCondition)
  }
}

// --------------- Output ノード構築 ---------------

function buildOutputNode(queryLimit: number): OutputNodeV2 {
  return {
    kind: 'output-v2',
    pagination: { limit: queryLimit },
    sort: { direction: 'DESC', field: 'created_at_ms' },
  }
}
