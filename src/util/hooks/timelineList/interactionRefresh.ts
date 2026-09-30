import type { TimelineItem } from 'types/timelineViewModel'
import type {
  ExistsCondition,
  FilterCondition,
  GetIdsFilter,
  GetIdsNode,
  LookupRelatedNode,
  QueryPlanV2,
} from 'util/db/query-ir/nodes'

function isExistsCondition(f: GetIdsFilter): f is ExistsCondition {
  return 'mode' in f
}

function filterTouchesTable(filter: GetIdsFilter, table: string): boolean {
  if (isExistsCondition(filter)) {
    return (
      filter.table === table ||
      (filter.innerFilters ?? []).some(
        (f: FilterCondition) => f.table === table,
      )
    )
  }
  return filter.table === table
}

function getIdsReferencesTable(node: GetIdsNode, table: string): boolean {
  if (node.table === table) return true
  if ((node.filters ?? []).some((f) => filterTouchesTable(f, table))) {
    return true
  }
  if (
    (node.orBranches ?? []).some((branch) =>
      branch.some((f) => filterTouchesTable(f, table)),
    )
  ) {
    return true
  }
  return node.timeSourceJoin?.table === table
}

function lookupRelatedReferencesTable(
  node: LookupRelatedNode,
  table: string,
): boolean {
  if (node.lookupTable === table) return true
  return (node.joinConditions ?? []).some((jc) => jc.resolve?.via === table)
}

export function planReferencesTableDeep(
  plan: QueryPlanV2,
  table: string,
): boolean {
  return plan.nodes.some(({ node }) => {
    if (node.kind === 'get-ids') return getIdsReferencesTable(node, table)
    if (node.kind === 'lookup-related') {
      return lookupRelatedReferencesTable(node, table)
    }
    return false
  })
}

type StatusWithPostId = {
  post_id?: number
  reblog?: { post_id?: number } | null
}

function toPostId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function referencesChangedPost(
  changedPostIds: ReadonlySet<number>,
  own: number | null | undefined,
  inner: number | null | undefined,
): boolean {
  return (
    (own != null && changedPostIds.has(own)) ||
    (inner != null && changedPostIds.has(inner))
  )
}

export function collectAffectedTimelineEntries(
  changedPostIds: ReadonlySet<number>,
  items: readonly TimelineItem[],
): { postIds: Set<number>; notificationIds: Set<number> } {
  const postIds = new Set<number>()
  const notificationIds = new Set<number>()
  for (const item of items) {
    if ('notification_id' in item && 'status' in item) {
      const st = item.status as StatusWithPostId | null | undefined
      const own = st?.post_id
      const inner = st?.reblog?.post_id
      if (referencesChangedPost(changedPostIds, own, inner)) {
        const nid = toPostId(item.notification_id)
        if (nid != null) notificationIds.add(nid)
      }
    } else {
      const pid = toPostId((item as StatusWithPostId).post_id)
      const inner = (item as StatusWithPostId).reblog?.post_id
      if (pid != null && referencesChangedPost(changedPostIds, pid, inner)) {
        postIds.add(pid)
      }
    }
  }
  return { notificationIds, postIds }
}
