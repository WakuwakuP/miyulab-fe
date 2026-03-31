// ============================================================
// Query IR — Completion helpers
// ============================================================
//
// TABLE_REGISTRY からノードエディタ用の補完候補を抽出する。
// テーブル一覧、カラム一覧、既知の値候補を提供する。

import type { ColumnMeta, TableRegistryEntry } from './registry'
import { TABLE_REGISTRY } from './registry'

// --------------- Types ---------------

export type TableOption = {
  /** UI 表示ラベル */
  label: string
  /** テーブル名 */
  table: string
}

export type ColumnOption = {
  /** UI 表示ラベル */
  label: string
  /** カラム名 */
  name: string
  /** NULL 許容か */
  nullable: boolean
  /** SQLite の型 */
  type: 'integer' | 'text' | 'real'
}

// --------------- Table options ---------------

/** ソーステーブルに結合可能なテーブル一覧を返す */
export function getFilterableTables(
  sourceTable: 'posts' | 'notifications' = 'posts',
): TableOption[] {
  const result: TableOption[] = []
  for (const entry of Object.values(TABLE_REGISTRY)) {
    // ソーステーブル自身、または joinPath が存在するテーブル
    if (
      entry.table === sourceTable ||
      entry.joinPaths[sourceTable as keyof typeof entry.joinPaths]
    ) {
      result.push({ label: entry.label, table: entry.table })
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label))
}

/** フィルタ可能なカラムを持つ全テーブル一覧を返す */
export function getAllFilterableTables(): TableOption[] {
  const result: TableOption[] = []
  for (const entry of Object.values(TABLE_REGISTRY)) {
    if (Object.keys(entry.columns).length > 0) {
      result.push({ label: entry.label, table: entry.table })
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label))
}

// --------------- Column options ---------------

/** 指定テーブルのフィルタ可能なカラム一覧を返す */
export function getFilterableColumns(table: string): ColumnOption[] {
  const entry = TABLE_REGISTRY[table]
  if (!entry) return []

  return Object.entries(entry.columns).map(
    ([name, meta]: [string, ColumnMeta]) => ({
      label: meta.label,
      name,
      nullable: meta.nullable,
      type: meta.type,
    }),
  )
}

// --------------- Known values ---------------

/** カラムに定義済みの既知値候補を返す (レジストリの knownValues) */
export function getKnownValues(
  table: string,
  column: string,
): string[] | undefined {
  const entry = TABLE_REGISTRY[table]
  if (!entry) return undefined
  return entry.columns[column]?.knownValues as string[] | undefined
}

/** テーブルのレジストリエントリを返す */
export function getTableEntry(table: string): TableRegistryEntry | undefined {
  return TABLE_REGISTRY[table]
}

// --------------- Exists filter tables ---------------

/** ExistsFilter で使用可能なテーブル一覧 (1:N カーディナリティ) */
export function getExistsFilterTables(
  sourceTable: 'posts' | 'notifications' = 'posts',
): TableOption[] {
  const result: TableOption[] = []
  for (const entry of Object.values(TABLE_REGISTRY)) {
    if (entry.table === sourceTable) continue
    const joinPath =
      entry.joinPaths[sourceTable as keyof typeof entry.joinPaths]
    if (joinPath) {
      result.push({ label: entry.label, table: entry.table })
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label))
}
