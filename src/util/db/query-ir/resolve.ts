// ============================================================
// Query IR — Table dependency resolution
// ============================================================

import type { FilterNode, QueryPlan } from './nodes'
import type {
  Cardinality,
  JoinPath,
  TableRegistry,
  TableRegistryEntry,
} from './registry'
import { TABLE_REGISTRY } from './registry'

export type JoinStrategy =
  | 'direct'
  | 'inner-join'
  | 'exists'
  | 'scalar-subquery'
  | 'not-exists'

export type TableDependency = {
  table: string
  joinPath: JoinPath | null
  cardinality: Cardinality
  strategy: JoinStrategy
}

// --------------- Strategy determination ---------------

/** Determine the optimal join strategy for a registry entry */
export function determineStrategy(entry: TableRegistryEntry): JoinStrategy {
  if (entry.hints?.isSmallLookup) return 'scalar-subquery'
  if (entry.hints?.preferExists) return 'exists'
  if (entry.cardinality === '1:N') return 'exists'
  if (entry.cardinality === 'lookup') return 'scalar-subquery'
  // 1:1 defaults to EXISTS to avoid row inflation
  return 'exists'
}

// --------------- Per-node resolution ---------------

/** Resolve table dependencies from a single filter node */
export function resolveTableDependency(
  node: FilterNode,
  sourceTable: string,
  registry: TableRegistry = TABLE_REGISTRY,
): TableDependency[] {
  switch (node.kind) {
    case 'table-filter': {
      if (node.table === sourceTable) {
        return [
          {
            cardinality: '1:1',
            joinPath: null,
            strategy: 'direct',
            table: node.table,
          },
        ]
      }
      const entry = registry[node.table]
      if (!entry) return []
      const joinPath =
        entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
      return [
        {
          cardinality: entry.cardinality,
          joinPath,
          strategy: determineStrategy(entry),
          table: node.table,
        },
      ]
    }

    case 'exists-filter': {
      const entry = registry[node.table]
      if (!entry) return []
      const joinPath =
        entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
      const strategy: JoinStrategy =
        node.mode === 'not-exists' ? 'not-exists' : 'exists'
      return [
        {
          cardinality: entry.cardinality,
          joinPath,
          strategy,
          table: node.table,
        },
      ]
    }

    case 'backend-filter': {
      const entry = registry.post_backend_ids
      if (!entry) return []
      const joinPath =
        entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
      return [
        {
          cardinality: entry.cardinality,
          joinPath,
          strategy: 'exists',
          table: 'post_backend_ids',
        },
      ]
    }

    case 'moderation-filter': {
      const entry = registry.profiles
      if (!entry) return []
      const joinPath =
        entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
      return [
        {
          cardinality: entry.cardinality,
          joinPath,
          strategy: 'scalar-subquery',
          table: 'profiles',
        },
      ]
    }

    case 'timeline-scope': {
      const entry = registry.timeline_entries
      if (!entry) return []
      const joinPath =
        entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
      return [
        {
          cardinality: entry.cardinality,
          joinPath,
          strategy: 'inner-join',
          table: 'timeline_entries',
        },
      ]
    }

    case 'raw-sql-filter': {
      const tables = node.referencedTables ?? []
      return tables.map((table) => {
        const entry = registry[table]
        if (!entry) {
          return {
            cardinality: '1:1' as Cardinality,
            joinPath: null,
            strategy: 'direct' as JoinStrategy,
            table,
          }
        }
        const joinPath =
          entry.joinPaths[sourceTable as keyof typeof entry.joinPaths] ?? null
        return {
          cardinality: entry.cardinality,
          joinPath,
          strategy: determineStrategy(entry),
          table,
        }
      })
    }

    case 'or-group': {
      const result: TableDependency[] = []
      for (const branch of node.branches) {
        for (const filter of branch) {
          const deps = resolveTableDependency(filter, sourceTable, registry)
          result.push(...deps)
        }
      }
      return result
    }

    case 'aerial-reply-filter': {
      // Aerial reply filter uses a correlated EXISTS subquery
      // referencing notifications, notification_types, profiles, and posts.
      // The subquery is self-contained so no external joins are needed.
      return []
    }
  }
}

// --------------- Full plan resolution ---------------

/** Resolve all table dependencies from a QueryPlan, deduped by table name */
export function resolveAllDependencies(
  plan: QueryPlan,
  registry: TableRegistry = TABLE_REGISTRY,
): TableDependency[] {
  const seen = new Set<string>()
  const result: TableDependency[] = []

  for (const filter of plan.filters) {
    const deps = resolveTableDependency(filter, plan.source.table, registry)
    for (const dep of deps) {
      if (!seen.has(dep.table)) {
        seen.add(dep.table)
        result.push(dep)
      }
    }
  }

  return result
}
