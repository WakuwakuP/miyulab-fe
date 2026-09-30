import type { TimelineItem } from 'types/timelineViewModel'
import type {
  ExistsCondition,
  FilterCondition,
  GetIdsFilter,
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

export function planReferencesTableDeep(
  plan: QueryPlanV2,
  table: string,
): boolean {
  for (const entry of plan.nodes) {
    const node = entry.node
    if (node.kind === 'get-ids') {
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
      if (node.timeSourceJoin?.table === table) return true
    } else if (node.kind === 'lookup-related') {
      if (node.lookupTable === table) return true
      for (const jc of node.joinConditions ?? []) {
        if (jc.resolve?.via === table) return true
      }
    }
  }
  return false
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
      if (
        (own != null && changedPostIds.has(own)) ||
        (inner != null && changedPostIds.has(inner))
      ) {
        const nid = toPostId(item.notification_id)
        if (nid != null) notificationIds.add(nid)
      }
    } else {
      const pid = toPostId((item as StatusWithPostId).post_id)
      const inner = (item as StatusWithPostId).reblog?.post_id ?? null
      if (
        (pid != null && changedPostIds.has(pid)) ||
        (inner != null && changedPostIds.has(inner))
      ) {
        if (pid != null) postIds.add(pid)
      }
    }
  }
  return { notificationIds, postIds }
}
