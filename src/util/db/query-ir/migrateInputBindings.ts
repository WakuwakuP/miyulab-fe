import type { FilterCondition, GetIdsNode } from './nodes'

type GetIdsConfig = Pick<
  GetIdsNode,
  'filters' | 'inputBinding' | 'inputBindings' | 'table'
>

/**
 * 旧 inputBindings を FilterCondition.upstreamSourceNodeId に変換する。
 * 変換後は inputBindings / inputBinding を undefined にクリアして返す。
 */
export function migrateInputBindings<T extends GetIdsConfig>(config: T): T {
  const bindings = config.inputBindings
  if (!bindings || bindings.length === 0) {
    return {
      ...config,
      inputBinding: undefined,
      inputBindings: undefined,
    }
  }

  const nextFilters = [...config.filters]
  for (const b of bindings) {
    const idx = nextFilters.findIndex(
      (f) => 'column' in f && f.column === b.column,
    )
    if (idx >= 0) {
      const existing = nextFilters[idx] as FilterCondition
      nextFilters[idx] = {
        ...existing,
        op: existing.op === 'NOT IN' ? 'NOT IN' : 'IN',
        upstreamSourceNodeId: b.sourceNodeId,
        value: undefined,
      }
    } else {
      nextFilters.push({
        column: b.column,
        op: 'IN',
        table: config.table,
        upstreamSourceNodeId: b.sourceNodeId,
      })
    }
  }

  return {
    ...config,
    filters: nextFilters,
    inputBinding: undefined,
    inputBindings: undefined,
  }
}
