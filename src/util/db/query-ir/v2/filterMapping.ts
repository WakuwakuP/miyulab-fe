// ============================================================
// V1 FilterNode ↔ V2 GetIdsFilter マッピング
// ============================================================

import type {
  FilterCondition,
  FilterNode,
  GetIdsFilter,
  OrGroup,
  TableFilter,
  TimelineScope,
} from '../nodes'
import { isOrGroup } from '../nodes'

/** timeline-scope を GetIdsFilter に展開 */
export function timelineScopeToFilters(node: TimelineScope): GetIdsFilter[] {
  const out: GetIdsFilter[] = [
    {
      column: 'timeline_key',
      op: 'IN',
      table: 'timeline_entries',
      value: node.timelineKeys,
    },
  ]
  if (node.accountScope && node.accountScope.length > 0) {
    out.push({
      column: 'local_account_id',
      op: 'IN',
      table: 'timeline_entries',
      value: node.accountScope,
    })
  }
  return out
}

export function tableFilterToCondition(t: TableFilter): FilterCondition {
  return {
    column: t.column,
    op: t.op,
    table: t.table,
    value: t.value,
  }
}

export function filterNodeToGetIdsFilter(
  node: FilterNode,
): GetIdsFilter | null {
  switch (node.kind) {
    case 'table-filter':
      return tableFilterToCondition(node)
    case 'exists-filter':
      return {
        countValue: node.countValue,
        innerFilters: node.innerFilters?.map(tableFilterToCondition),
        mode: node.mode,
        table: node.table,
      }
    case 'timeline-scope':
      return null
    case 'backend-filter':
      if (node.localAccountIds.length === 0) return null
      return {
        column: 'id',
        op: 'IN',
        table: 'local_accounts',
        value: node.localAccountIds,
      }
    case 'moderation-filter':
    case 'raw-sql-filter':
    case 'aerial-reply-filter':
    case 'or-group':
      return null
    default:
      return null
  }
}

/** filters から or-group を分離 */
export function partitionOrGroups(filters: FilterNode[]): {
  base: FilterNode[]
  orBranches: FilterNode[][]
} {
  const base: FilterNode[] = []
  const orBranches: FilterNode[][] = []
  for (const f of filters) {
    if (isOrGroup(f)) {
      orBranches.push(...(f as OrGroup).branches)
    } else {
      base.push(f)
    }
  }
  return { base, orBranches }
}
