// ============================================================
// Query IR — QueryPlan validation
// ============================================================

import type {
  ExistsFilter,
  FilterNode,
  FilterOp,
  FilterValue,
  QueryPlan,
  TableFilter,
} from './nodes'
import type { ColumnMeta, TableRegistry } from './registry'
import { TABLE_REGISTRY } from './registry'

export type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// --------------- Helpers ---------------

const FORBIDDEN_SQL_RE =
  /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i

function validateValueType(
  value: FilterValue | undefined,
  colMeta: ColumnMeta,
  op: FilterOp,
  errors: string[],
): void {
  if (op === 'IS NULL' || op === 'IS NOT NULL') {
    if (value !== undefined && value !== null) {
      errors.push(
        `Operator '${op}' should not have a value, got: ${String(value)}`,
      )
    }
    return
  }

  if (op === 'IN' || op === 'NOT IN') {
    if (!Array.isArray(value)) {
      errors.push(
        `Operator '${op}' requires an array value, got: ${typeof value}`,
      )
      return
    }
  }

  const values = Array.isArray(value) ? value : [value]
  for (const v of values) {
    if (v === null || v === undefined) continue
    if (colMeta.type === 'integer' && typeof v !== 'number') {
      errors.push(
        `Column type is 'integer' but value '${String(v)}' is ${typeof v}`,
      )
    }
    if (colMeta.type === 'text' && typeof v !== 'string') {
      errors.push(
        `Column type is 'text' but value '${String(v)}' is ${typeof v}`,
      )
    }
  }
}

// --------------- Single-node validation ---------------

function validateTableFilter(
  node: TableFilter,
  sourceTable: string,
  registry: TableRegistry,
  errors: string[],
  warnings: string[],
): void {
  const entry = registry[node.table]
  if (!entry) {
    errors.push(`Table '${node.table}' not found in registry`)
    return
  }

  const colMeta = entry.columns[node.column]
  if (!colMeta) {
    warnings.push(
      `Column '${node.column}' not found in registry for table '${node.table}'`,
    )
  }

  if (node.table !== sourceTable) {
    const joinPath =
      entry.joinPaths[sourceTable as keyof typeof entry.joinPaths]
    if (!joinPath) {
      errors.push(
        `No join path from '${node.table}' to source table '${sourceTable}'`,
      )
    }
  }

  if (colMeta) {
    validateValueType(node.value, colMeta, node.op, errors)
  }
}

function validateExistsFilter(
  node: ExistsFilter,
  sourceTable: string,
  registry: TableRegistry,
  errors: string[],
  warnings: string[],
): void {
  const entry = registry[node.table]
  if (!entry) {
    errors.push(`Table '${node.table}' not found in registry`)
    return
  }

  const joinPath = entry.joinPaths[sourceTable as keyof typeof entry.joinPaths]
  if (!joinPath) {
    errors.push(
      `No join path from '${node.table}' to source table '${sourceTable}'`,
    )
  }

  if (
    node.mode.startsWith('count-') &&
    (node.countValue === null || node.countValue === undefined)
  ) {
    errors.push(`Exists filter with mode '${node.mode}' requires a countValue`)
  }

  if (node.innerFilters) {
    for (const inner of node.innerFilters) {
      validateTableFilter(inner, node.table, registry, errors, warnings)
    }
  }
}

// --------------- Core validation ---------------

function validateNode(
  node: FilterNode,
  sourceTable: string,
  registry: TableRegistry,
  errors: string[],
  warnings: string[],
): void {
  switch (node.kind) {
    case 'table-filter':
      validateTableFilter(node, sourceTable, registry, errors, warnings)
      break
    case 'exists-filter':
      validateExistsFilter(node, sourceTable, registry, errors, warnings)
      break
    case 'backend-filter':
      if (node.localAccountIds.length === 0) {
        warnings.push('BackendFilter has empty localAccountIds')
      }
      break
    case 'moderation-filter':
      break
    case 'aerial-reply-filter':
      if (node.notificationTypes.length === 0) {
        warnings.push('AerialReplyFilter has empty notificationTypes')
      }
      if (node.timeWindowMs <= 0) {
        errors.push('AerialReplyFilter timeWindowMs must be positive')
      }
      break
    case 'timeline-scope':
      break
    case 'or-group':
      if (node.branches.length === 0) {
        warnings.push('OrGroup has no branches')
      }
      for (const branch of node.branches) {
        if (branch.length === 0) {
          warnings.push('OrGroup has an empty branch')
        }
        for (const filter of branch) {
          validateNode(filter, sourceTable, registry, errors, warnings)
        }
      }
      break
    case 'raw-sql-filter':
      if (FORBIDDEN_SQL_RE.test(node.where)) {
        errors.push(
          `RawSQLFilter contains forbidden SQL keyword in: ${node.where}`,
        )
      }
      break
  }
}

// --------------- Public API ---------------

/** Validate a single filter node against the registry */
export function validateFilterNode(
  node: FilterNode,
  sourceTable: string,
  registry: TableRegistry = TABLE_REGISTRY,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  validateNode(node, sourceTable, registry, errors, warnings)
  return { errors, valid: errors.length === 0, warnings }
}

/** Validate an entire QueryPlan against the registry */
export function validateQueryPlan(
  plan: QueryPlan,
  registry: TableRegistry = TABLE_REGISTRY,
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const sourceTable = plan.source.table

  if (!registry[sourceTable]) {
    errors.push(`Source table '${sourceTable}' not found in registry`)
  }

  for (const filter of plan.filters) {
    validateNode(filter, sourceTable, registry, errors, warnings)
  }

  for (const composite of plan.composites) {
    if (composite.kind === 'merge') {
      for (const sub of composite.sources) {
        const subResult = validateQueryPlan(sub, registry)
        errors.push(...subResult.errors)
        warnings.push(...subResult.warnings)
      }
    }
  }

  return { errors, valid: errors.length === 0, warnings }
}
