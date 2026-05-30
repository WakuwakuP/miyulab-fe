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
  QueryPlan,
  RawSQLFilter,
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
// configToQueryPlan helpers
// ---------------------------------------------------------------------------

function buildSource(config: TimelineConfigV2): SourceNode {
  return {
    kind: 'source',
    orderBy: 'created_at_ms',
    orderDirection: 'DESC',
    table: config.type === 'notification' ? 'notifications' : 'posts',
  }
}

function resolveTimelineKeys(config: TimelineConfigV2): string[] {
  if (config.timelineTypes && config.timelineTypes.length > 0) {
    return [...config.timelineTypes]
  }
  if (
    config.type === 'home' ||
    config.type === 'local' ||
    config.type === 'public'
  ) {
    return [config.type]
  }
  return []
}

function buildTimelineScopeFilter(
  config: TimelineConfigV2,
  context: ConfigToNodesContext,
): TimelineScope | undefined {
  const isNotification = config.type === 'notification'
  const isTag = config.type === 'tag'
  if (isNotification || isTag) {
    return undefined
  }

  const timelineKeys = resolveTimelineKeys(config)
  if (timelineKeys.length === 0) {
    return undefined
  }

  const scope: TimelineScope = {
    kind: 'timeline-scope',
    timelineKeys,
  }
  if (timelineKeys.includes('home') && context.localAccountIds.length > 0) {
    scope.accountScope = [...context.localAccountIds]
  }
  return scope
}

function buildTagComposite(
  config: TimelineConfigV2,
): CompositeNode | undefined {
  if (
    config.type !== 'tag' ||
    !config.tagConfig ||
    config.tagConfig.tags.length === 0
  ) {
    return undefined
  }
  return {
    kind: 'tag-combination',
    mode: config.tagConfig.mode ?? 'or',
    tags: [...config.tagConfig.tags],
  }
}

function buildBackendFilter(
  context: ConfigToNodesContext,
): BackendFilter | undefined {
  if (context.localAccountIds.length === 0) {
    return undefined
  }
  return {
    kind: 'backend-filter',
    localAccountIds: [...context.localAccountIds],
  }
}

function buildMediaFilter(config: TimelineConfigV2): ExistsFilter | undefined {
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    return {
      countValue: config.minMediaCount,
      kind: 'exists-filter',
      mode: 'count-gte',
      table: 'post_media',
    }
  }
  if (config.onlyMedia) {
    return {
      kind: 'exists-filter',
      mode: 'exists',
      table: 'post_media',
    }
  }
  return undefined
}

function buildVisibilityFilter(
  config: TimelineConfigV2,
): TableFilter | undefined {
  const visibility = config.visibilityFilter
  if (!visibility || visibility.length === 0 || visibility.length >= 4) {
    return undefined
  }
  return {
    column: 'name',
    kind: 'table-filter',
    op: 'IN',
    table: 'visibility_types',
    value: [...visibility],
  }
}

function buildLanguageFilter(
  config: TimelineConfigV2,
): RawSQLFilter | undefined {
  if (!config.languageFilter || config.languageFilter.length === 0) {
    return undefined
  }
  const inList = config.languageFilter
    .map((l) => `'${l.replace(/'/g, "''")}'`)
    .join(',')
  return {
    kind: 'raw-sql-filter',
    referencedTables: [],
    where: `(p.language IN (${inList}) OR p.language IS NULL)`,
  }
}

function buildPostExclusionFilters(config: TimelineConfigV2): TableFilter[] {
  const filters: TableFilter[] = []
  if (config.excludeReblogs) {
    filters.push({
      column: 'is_reblog',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 0,
    })
  }
  if (config.excludeReplies) {
    filters.push({
      column: 'in_reply_to_uri',
      kind: 'table-filter',
      op: 'IS NULL',
      table: 'posts',
    })
  }
  if (config.excludeSpoiler) {
    filters.push({
      column: 'spoiler_text',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: '',
    })
  }
  if (config.excludeSensitive) {
    filters.push({
      column: 'is_sensitive',
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value: 0,
    })
  }
  return filters
}

function buildContentFilters(config: TimelineConfigV2): FilterNode[] {
  const filters: FilterNode[] = []
  const media = buildMediaFilter(config)
  if (media) filters.push(media)
  const visibility = buildVisibilityFilter(config)
  if (visibility) filters.push(visibility)
  const language = buildLanguageFilter(config)
  if (language) filters.push(language)
  filters.push(...buildPostExclusionFilters(config))
  return filters
}

function buildAccountFilter(config: TimelineConfigV2): TableFilter | undefined {
  if (!config.accountFilter || config.accountFilter.accts.length === 0) {
    return undefined
  }
  return {
    column: 'acct',
    kind: 'table-filter',
    op: config.accountFilter.mode === 'include' ? 'IN' : 'NOT IN',
    table: 'profiles',
    value: [...config.accountFilter.accts],
  }
}

function buildModerationFilter(
  config: TimelineConfigV2,
  context: ConfigToNodesContext,
): ModerationFilter | undefined {
  const applyList: ('mute' | 'instance-block')[] = []
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    applyList.push('mute')
  }
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    applyList.push('instance-block')
  }
  if (applyList.length === 0) {
    return undefined
  }
  return {
    apply: applyList,
    kind: 'moderation-filter',
    serverIds:
      context.serverIds.length > 0 ? [...context.serverIds] : undefined,
  }
}

function buildNotificationTypeFilter(
  config: TimelineConfigV2,
): TableFilter | undefined {
  if (config.type !== 'notification' || !config.notificationFilter?.length) {
    return undefined
  }
  return {
    column: 'name',
    kind: 'table-filter',
    op: 'IN',
    table: 'notification_types',
    value: [...config.notificationFilter],
  }
}

function appendIfDefined<T>(list: T[], item: T | undefined): void {
  if (item !== undefined) {
    list.push(item)
  }
}

// ---------------------------------------------------------------------------
// Main conversion function
// ---------------------------------------------------------------------------

export function configToQueryPlan(
  config: TimelineConfigV2,
  context: ConfigToNodesContext,
): QueryPlan {
  const filters: FilterNode[] = []
  const composites: CompositeNode[] = []

  appendIfDefined(filters, buildTimelineScopeFilter(config, context))
  appendIfDefined(composites, buildTagComposite(config))
  appendIfDefined(filters, buildBackendFilter(context))
  filters.push(...buildContentFilters(config))
  appendIfDefined(filters, buildAccountFilter(config))
  appendIfDefined(filters, buildModerationFilter(config, context))
  appendIfDefined(filters, buildNotificationTypeFilter(config))

  return {
    composites,
    filters,
    pagination: { kind: 'pagination', limit: context.queryLimit },
    sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
    source: buildSource(config),
  }
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
