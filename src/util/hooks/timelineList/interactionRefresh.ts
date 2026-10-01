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

function filtersTouchTable(
  filters: readonly GetIdsFilter[],
  table: string,
): boolean {
  return filters.some((f) => filterTouchesTable(f, table))
}

function getIdsNodeReferencesTable(node: GetIdsNode, table: string): boolean {
  if (node.table === table) return true
  if (node.timeSourceJoin?.table === table) return true
  if (filtersTouchTable(node.filters ?? [], table)) return true
  const branches = node.orBranches ?? []
  return branches.some((branch) => filtersTouchTable(branch, table))
}

function lookupNodeReferencesTable(
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
    if (node.kind === 'get-ids') return getIdsNodeReferencesTable(node, table)
    if (node.kind === 'lookup-related') {
      return lookupNodeReferencesTable(node, table)
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

function hasChangedPostId(
  changedPostIds: ReadonlySet<number>,
  ...ids: (number | null | undefined)[]
): boolean {
  return ids.some((id) => id != null && changedPostIds.has(id))
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
      if (hasChangedPostId(changedPostIds, st?.post_id, st?.reblog?.post_id)) {
        const nid = toPostId(item.notification_id)
        if (nid != null) notificationIds.add(nid)
      }
      continue
    }
    const status = item as StatusWithPostId
    const pid = toPostId(status.post_id)
    if (
      pid != null &&
      hasChangedPostId(changedPostIds, pid, status.reblog?.post_id)
    ) {
      postIds.add(pid)
    }
  }
  return { notificationIds, postIds }
}
