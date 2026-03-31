// ============================================================
// Query IR — Node type definitions
// ============================================================

// --------------- Basic types ---------------

/** フィルタ演算子 */
export type FilterOp =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'IN'
  | 'NOT IN'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'LIKE'
  | 'NOT LIKE'
  | 'GLOB'

/** フィルタ値 */
export type FilterValue = string | number | (string | number)[] | null

/** バインド変数 */
export type BindValue = string | number | null

// --------------- Source Node ---------------

/** ソーステーブルを指定する */
export type SourceNode = {
  kind: 'source'
  /** レジストリのテーブル名 */
  table: string
  /** ソートに使うカラム (デフォルト: 'created_at_ms') */
  orderBy?: string
  /** ソート方向 (デフォルト: 'DESC') */
  orderDirection?: 'ASC' | 'DESC'
}

// --------------- Filter Nodes ---------------

/** Generic table column filter */
export type TableFilter = {
  kind: 'table-filter'
  table: string
  column: string
  op: FilterOp
  value?: FilterValue
}

/** Row existence / count filter */
export type ExistsFilter = {
  kind: 'exists-filter'
  table: string
  mode: 'exists' | 'not-exists' | 'count-gte' | 'count-lte' | 'count-eq'
  countValue?: number
  innerFilters?: TableFilter[]
}

/** Which backend's data to include */
export type BackendFilter = {
  kind: 'backend-filter'
  localAccountIds: number[]
}

/** Mute / block filtering */
export type ModerationFilter = {
  kind: 'moderation-filter'
  apply: ('mute' | 'instance-block')[]
  serverIds?: number[]
}

/** Timeline entries scope (drives INNER JOIN) */
export type TimelineScope = {
  kind: 'timeline-scope'
  timelineKeys: string[]
  accountScope?: number[]
}

/** Escape hatch for Advanced Query compatibility */
export type RawSQLFilter = {
  kind: 'raw-sql-filter'
  where: string
  referencedTables?: string[]
}

/** 空中リプライ検出フィルタ — 通知直後の投稿を検出 */
export type AerialReplyFilter = {
  kind: 'aerial-reply-filter'
  /** 対象通知種別 (e.g. ['favourite', 'reaction', 'reblog']) */
  notificationTypes: string[]
  /** 通知からの時間窓 (ms) デフォルト: 180000 (3分) */
  timeWindowMs: number
}

/** OR分岐: 各ブランチは AND 結合され、ブランチ間は OR 結合される */
export type OrGroup = {
  kind: 'or-group'
  /** 各ブランチは FilterNode[] の AND 結合。ブランチ間は OR 結合 */
  branches: FilterNode[][]
}

// --------------- Composite Nodes ---------------

/** Multiple source merge (mixed queries) */
export type MergeNode = {
  kind: 'merge'
  sources: QueryPlan[]
  strategy: 'interleave-by-time'
  limit: number
}

/** Tag AND/OR logic */
export type TagCombination = {
  kind: 'tag-combination'
  tags: string[]
  mode: 'or' | 'and'
}

// --------------- Sort & Pagination ---------------

export type SortSpec = {
  kind: 'sort'
  field: string
  direction: 'ASC' | 'DESC'
}

export type Pagination = {
  kind: 'pagination'
  limit: number
  offset?: number
}

// --------------- Union Types ---------------

export type FilterNode =
  | TableFilter
  | ExistsFilter
  | BackendFilter
  | ModerationFilter
  | TimelineScope
  | RawSQLFilter
  | AerialReplyFilter
  | OrGroup

export type CompositeNode = MergeNode | TagCombination

export type QueryNode =
  | SourceNode
  | FilterNode
  | CompositeNode
  | SortSpec
  | Pagination

// --------------- QueryPlan ---------------

export type QueryPlan = {
  source: SourceNode
  filters: FilterNode[]
  composites: CompositeNode[]
  sort: SortSpec
  pagination: Pagination
}

// --------------- Type Guards ---------------

export function isTableFilter(node: FilterNode): node is TableFilter {
  return node.kind === 'table-filter'
}

export function isExistsFilter(node: FilterNode): node is ExistsFilter {
  return node.kind === 'exists-filter'
}

export function isBackendFilter(node: FilterNode): node is BackendFilter {
  return node.kind === 'backend-filter'
}

export function isModerationFilter(node: FilterNode): node is ModerationFilter {
  return node.kind === 'moderation-filter'
}

export function isTimelineScope(node: FilterNode): node is TimelineScope {
  return node.kind === 'timeline-scope'
}

export function isRawSQLFilter(node: FilterNode): node is RawSQLFilter {
  return node.kind === 'raw-sql-filter'
}

export function isAerialReplyFilter(
  node: FilterNode,
): node is AerialReplyFilter {
  return node.kind === 'aerial-reply-filter'
}

export function isOrGroup(node: FilterNode): node is OrGroup {
  return node.kind === 'or-group'
}
