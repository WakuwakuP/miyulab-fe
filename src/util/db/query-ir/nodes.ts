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
  /** SELECT する ID カラム名 (デフォルト: 'id')。AS id でエイリアスされる */
  idColumn?: string
  /** SELECT する時刻カラム名 (デフォルト: 'created_at_ms')。AS created_at_ms でエイリアスされる */
  timeColumn?: string
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

// ============================================================
// Query IR V2 — グラフベースのノード定義
// ============================================================

/** 既存の QueryPlan 形状 (V1) */
export type QueryPlanV1 = QueryPlan

/** 単一フィルタ条件 (getIds 内部) */
export type FilterCondition = {
  table: string
  column: string
  op: FilterOp
  value?: FilterValue
  /**
   * 上流ノードの出力 ID を値として使用する場合のソースノード ID。
   * 設定時は `value` の代わりに上流ノードの出力行 ID が op に従って注入される。
   * 主に `IN` / `NOT IN` 演算子と組み合わせて使用する。
   */
  upstreamSourceNodeId?: string
}

/** EXISTS / COUNT 条件 */
export type ExistsCondition = {
  table: string
  mode: 'exists' | 'not-exists' | 'count-gte' | 'count-lte' | 'count-eq'
  countValue?: number
  innerFilters?: FilterCondition[]
}

/** getIds のフィルタ */
export type GetIdsFilter = FilterCondition | ExistsCondition

/** 上流ノードの出力 ID をフィルタ値として受け取る設定 */
export type GetIdsInputBinding = {
  /** この table のどのカラムに上流 ID を IN で適用するか */
  column: string
  /**
   * どの上流ノード (FlowNode.id) の出力を使うか。
   * 上流が複数ある場合に指定必須。単一の場合も明示的に持つ。
   */
  sourceNodeId: string
}

/** テーブルからフィルタした ID リストを取得 */
export type GetIdsNode = {
  kind: 'get-ids'
  table: string
  filters: GetIdsFilter[]
  orBranches?: GetIdsFilter[][]
  /** 出力する ID カラム (省略時はテーブルの PK = 'id') */
  outputIdColumn?: string
  /**
   * 出力する時刻カラム (省略時は 'created_at_ms')。マージ・キャッシュに使用。
   * `null` を指定するとテーブルに時刻カラムがないことを示し、
   * createdAtMs には 0 が設定され ROWID 降順でソートされる。
   */
  outputTimeColumn?: string | null
  /** @deprecated FilterCondition.upstreamSourceNodeId を使用してください */
  inputBindings?: GetIdsInputBinding[]
  /** @deprecated FilterCondition.upstreamSourceNodeId を使用してください */
  inputBinding?: { column: string }
}

/** ID リストから関連テーブルの ID を相関検索 */
export type LookupRelatedNode = {
  kind: 'lookup-related'
  lookupTable: string
  joinConditions: JoinCondition[]
  timeCondition?: TimeCondition
  aggregate?: AggregateMode
}

export type JoinCondition = {
  inputColumn: string
  lookupColumn: string
  resolve?: {
    via: string
    inputKey: string
    lookupKey: string
    matchColumn: string
  }
}

export type TimeCondition = {
  lookupTimeColumn: string
  inputTimeColumn: string
  afterInput: boolean
  windowMs: number
}

export type AggregateMode = {
  column: string
  function: 'MIN' | 'MAX'
}

/** 複数の ID リストを結合 */
export type MergeNodeV2 = {
  kind: 'merge-v2'
  strategy: 'union' | 'intersect' | 'interleave-by-time'
  limit: number
}

/** 最終出力 */
export type OutputNodeV2 = {
  kind: 'output-v2'
  sort: {
    field: string
    direction: 'ASC' | 'DESC'
  }
  pagination: {
    limit: number
    offset?: number
  }
}

export type QueryNodeV2 =
  | GetIdsNode
  | LookupRelatedNode
  | MergeNodeV2
  | OutputNodeV2

export type QueryPlanV2Node = {
  id: string
  node: QueryNodeV2
}

export type QueryPlanV2Edge = {
  source: string
  target: string
}

export type QueryPlanV2 = {
  version: 2
  nodes: QueryPlanV2Node[]
  edges: QueryPlanV2Edge[]
  /**
   * V1 からの移行で GetIds に落とせなかった FilterNode。
   * 実行時は v2ToV1 で QueryPlan.filters にマージされる。
   */
  legacyV1Overlay?: {
    filters: FilterNode[]
  }
}

export function isQueryPlanV2(
  plan: QueryPlanV1 | QueryPlanV2 | undefined,
): plan is QueryPlanV2 {
  return (
    plan != null &&
    typeof plan === 'object' &&
    'version' in plan &&
    plan.version === 2
  )
}
