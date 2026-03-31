// ============================================================
// configToNodes — TimelineConfigV2 → QueryPlan 変換
// ============================================================
//
// 標準タイムライン設定（home/local/public/tag/notification）を
// IR ノードに変換する純粋関数。副作用なし・テスト容易。

import type { TimelineConfigV2 } from 'types/types'
import type {
  BackendFilter,
  CompositeNode,
  ExistsFilter,
  FilterNode,
  ModerationFilter,
  Pagination,
  QueryPlan,
  RawSQLFilter,
  SortSpec,
  SourceNode,
  TableFilter,
  TimelineScope,
} from '../nodes'

// ---------------------------------------------------------------------------
// Context (caller provides pre-resolved IDs from accountResolver)
// ---------------------------------------------------------------------------

export type ConfigToNodesContext = {
  /** 対象 backendUrl から解決済みの local_account_id[] */
  localAccountIds: number[]
  /** 対象 backendUrl から解決済みの server_id[] (ミュート条件用) */
  serverIds: number[]
  /** 1回の取得件数上限 */
  queryLimit: number
}

// ---------------------------------------------------------------------------
// Main conversion function
// ---------------------------------------------------------------------------

export function configToQueryPlan(
  config: TimelineConfigV2,
  context: ConfigToNodesContext,
): QueryPlan {
  const isNotification = config.type === 'notification'
  const isTag = config.type === 'tag'

  // === Source ===
  const source: SourceNode = {
    kind: 'source',
    orderBy: 'created_at_ms',
    orderDirection: 'DESC',
    table: isNotification ? 'notifications' : 'posts',
  }

  const filters: FilterNode[] = []
  const composites: CompositeNode[] = []

  // === Timeline Scope ===
  if (!isNotification && !isTag) {
    const timelineKeys =
      config.timelineTypes && config.timelineTypes.length > 0
        ? [...config.timelineTypes]
        : config.type === 'home' ||
            config.type === 'local' ||
            config.type === 'public'
          ? [config.type]
          : []

    if (timelineKeys.length > 0) {
      const scope: TimelineScope = {
        kind: 'timeline-scope',
        timelineKeys,
      }
      // Home タイムラインはアカウントスコープが必要
      if (timelineKeys.includes('home') && context.localAccountIds.length > 0) {
        scope.accountScope = [...context.localAccountIds]
      }
      filters.push(scope)
    }
  }

  // === Tag Combination ===
  if (isTag && config.tagConfig && config.tagConfig.tags.length > 0) {
    composites.push({
      kind: 'tag-combination',
      mode: config.tagConfig.mode ?? 'or',
      tags: [...config.tagConfig.tags],
    })
  }

  // === Backend Filter ===
  if (context.localAccountIds.length > 0) {
    filters.push({
      kind: 'backend-filter',
      localAccountIds: [...context.localAccountIds],
    } satisfies BackendFilter)
  }

  // === Content Filters ===

  // メディアフィルタ
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    filters.push({
      countValue: config.minMediaCount,
      kind: 'exists-filter',
      mode: 'count-gte',
      table: 'post_media',
    } satisfies ExistsFilter)
  } else if (config.onlyMedia) {
    filters.push({
      kind: 'exists-filter',
      mode: 'exists',
      table: 'post_media',
    } satisfies ExistsFilter)
  }

  // 公開範囲フィルタ
  if (
    config.visibilityFilter &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    filters.push({
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'visibility_types',
      value: [...config.visibilityFilter],
    } satisfies TableFilter)
  }

  // 言語フィルタ (NULL は常に許可)
  if (config.languageFilter && config.languageFilter.length > 0) {
    filters.push({
      kind: 'raw-sql-filter',
      referencedTables: [],
      where: `(p.language IN (${config.languageFilter.map((l) => `'${l.replace(/'/g, "''")}'`).join(',')}) OR p.language IS NULL)`,
    } satisfies RawSQLFilter)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    filters.push({
      column: 'is_reblog',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 0,
    } satisfies TableFilter)
  }

  // リプライ除外
  if (config.excludeReplies) {
    filters.push({
      column: 'in_reply_to_uri',
      kind: 'table-filter',
      op: 'IS NULL',
      table: 'posts',
    } satisfies TableFilter)
  }

  // CW 除外
  if (config.excludeSpoiler) {
    filters.push({
      column: 'spoiler_text',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: '',
    } satisfies TableFilter)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    filters.push({
      column: 'is_sensitive',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 0,
    } satisfies TableFilter)
  }

  // === Account Filter ===
  if (config.accountFilter && config.accountFilter.accts.length > 0) {
    filters.push({
      column: 'acct',
      kind: 'table-filter',
      op: config.accountFilter.mode === 'include' ? 'IN' : 'NOT IN',
      table: 'profiles',
      value: [...config.accountFilter.accts],
    } satisfies TableFilter)
  }

  // === Moderation Filters ===
  const applyList: ('mute' | 'instance-block')[] = []
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    applyList.push('mute')
  }
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    applyList.push('instance-block')
  }
  if (applyList.length > 0) {
    filters.push({
      apply: applyList,
      kind: 'moderation-filter',
      serverIds:
        context.serverIds.length > 0 ? [...context.serverIds] : undefined,
    } satisfies ModerationFilter)
  }

  // === Notification Type Filter ===
  if (isNotification && config.notificationFilter?.length) {
    filters.push({
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'notification_types',
      value: [...config.notificationFilter],
    } satisfies TableFilter)
  }

  // === Sort & Pagination ===
  const sort: SortSpec = {
    direction: 'DESC',
    field: 'created_at_ms',
    kind: 'sort',
  }

  const pagination: Pagination = {
    kind: 'pagination',
    limit: context.queryLimit,
  }

  return { composites, filters, pagination, sort, source }
}

// ---------------------------------------------------------------------------
// enrichQueryPlan — 保存済み QueryPlan にランタイムコンテキストを注入
// ---------------------------------------------------------------------------

/**
 * FlowEditor で保存された QueryPlan にランタイム依存の情報を注入する。
 *
 * FlowEditor は localAccountIds / serverIds を持たない状態で QueryPlan を保存する。
 * 実行時に以下を補完する:
 * - timeline-scope.accountScope (home タイムラインのアカウントスコープ)
 * - backend-filter.localAccountIds
 * - moderation-filter.serverIds
 * - pagination.limit (queryLimit)
 *
 * backend-filter ノードが存在しない場合は追加する。
 * moderation-filter ノードが存在しない場合は追加する。
 */
export function enrichQueryPlan(
  plan: QueryPlan,
  context: ConfigToNodesContext,
): QueryPlan {
  const enrichedFilters = enrichFilters(plan.filters, context)

  const enrichedComposites = plan.composites.map((c) => {
    if (c.kind === 'merge') {
      return {
        ...c,
        sources: c.sources.map((sub) => enrichQueryPlan(sub, context)),
      }
    }
    return c
  })

  return {
    ...plan,
    composites: enrichedComposites,
    filters: enrichedFilters,
    pagination: { ...plan.pagination, limit: context.queryLimit },
  }
}

function enrichFilters(
  filters: FilterNode[],
  context: ConfigToNodesContext,
): FilterNode[] {
  let hasBackendFilter = false
  let hasModerationFilter = false

  const enriched = filters.map((f): FilterNode => {
    switch (f.kind) {
      case 'timeline-scope': {
        // home タイムラインにはアカウントスコープが必要
        if (
          f.timelineKeys.includes('home') &&
          context.localAccountIds.length > 0 &&
          (!f.accountScope || f.accountScope.length === 0)
        ) {
          return { ...f, accountScope: [...context.localAccountIds] }
        }
        return f
      }
      case 'backend-filter': {
        hasBackendFilter = true
        // localAccountIds を最新のコンテキストで上書き
        if (context.localAccountIds.length > 0) {
          return { ...f, localAccountIds: [...context.localAccountIds] }
        }
        return f
      }
      case 'moderation-filter': {
        hasModerationFilter = true
        // serverIds を最新のコンテキストで上書き
        if (context.serverIds.length > 0) {
          return { ...f, serverIds: [...context.serverIds] }
        }
        return f
      }
      default:
        return f
    }
  })

  // backend-filter が存在しない場合は追加
  if (!hasBackendFilter && context.localAccountIds.length > 0) {
    enriched.push({
      kind: 'backend-filter',
      localAccountIds: [...context.localAccountIds],
    } satisfies BackendFilter)
  }

  // moderation-filter が存在しない場合は追加
  if (!hasModerationFilter) {
    enriched.push({
      apply: ['mute', 'instance-block'],
      kind: 'moderation-filter',
      serverIds:
        context.serverIds.length > 0 ? [...context.serverIds] : undefined,
    } satisfies ModerationFilter)
  }

  return enriched
}
