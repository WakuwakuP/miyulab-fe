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

// --------------- Join column options ---------------

/** JoinCondition / TimeCondition で使用可能なカラム（PK/FK を含む） */
const JOIN_COLUMN_MAP: Record<string, ColumnOption[]> = {
  local_accounts: [
    {
      label: 'ローカルアカウント ID',
      name: 'id',
      nullable: false,
      type: 'integer',
    },
    {
      label: 'プロフィール ID',
      name: 'profile_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: 'サーバー ID',
      name: 'server_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: '作成日時',
      name: 'created_at',
      nullable: false,
      type: 'integer',
    },
  ],
  notifications: [
    { label: '通知 ID', name: 'id', nullable: false, type: 'integer' },
    {
      label: 'アクターのプロフィール ID',
      name: 'actor_profile_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '関連投稿 ID',
      name: 'related_post_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '通知種別 ID',
      name: 'notification_type_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: '作成日時',
      name: 'created_at_ms',
      nullable: false,
      type: 'integer',
    },
  ],
  posts: [
    { label: '投稿 ID', name: 'id', nullable: false, type: 'integer' },
    {
      label: '著者のプロフィール ID',
      name: 'author_profile_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: '配信元サーバー ID',
      name: 'origin_server_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: 'リブログ元投稿 ID',
      name: 'reblog_of_post_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '引用元投稿 ID',
      name: 'quote_of_post_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '作成日時',
      name: 'created_at_ms',
      nullable: false,
      type: 'integer',
    },
  ],
}

/** JoinCondition / TimeCondition 向けカラム一覧を返す (PK/FK を含む) */
export function getJoinableColumns(table: string): ColumnOption[] {
  return JOIN_COLUMN_MAP[table] ?? []
}

/** ミリ秒タイムスタンプカラム一覧を返す (TimeCondition 用) */
export function getTimeColumns(table: string): ColumnOption[] {
  // joinable カラムから時刻系カラムを抽出
  const joinable = getJoinableColumns(table).filter(
    (c) =>
      c.type === 'integer' &&
      (c.name.endsWith('_ms') || c.name.startsWith('created_at')),
  )
  if (joinable.length > 0) return joinable

  // フォールバック: レジストリから created_at* カラムを探す
  const entry = TABLE_REGISTRY[table]
  if (!entry) return []
  return Object.entries(entry.columns)
    .filter(
      ([name, meta]) =>
        meta.type === 'integer' && name.startsWith('created_at'),
    )
    .map(([name, meta]) => ({
      label: meta.label,
      name,
      nullable: meta.nullable,
      type: 'integer' as const,
    }))
}

/**
 * テーブルのデフォルト時刻カラム名を返す。
 * `created_at_ms` があればそれを、なければ `created_at` を、
 * どちらもなければ `null` (時刻カラムなし) を返す。
 */
export function getDefaultTimeColumn(table: string): string | null {
  const timeCols = getTimeColumns(table)
  const ms = timeCols.find((c) => c.name === 'created_at_ms')
  if (ms) return ms.name
  const plain = timeCols.find((c) => c.name === 'created_at')
  if (plain) return plain.name
  if (timeCols.length > 0) return timeCols[0].name
  return null
}

// --------------- Output ID column options ---------------

/**
 * テーブルごとの出力 ID カラム候補
 * getIds ノードが下流へ渡す整数 ID カラムの一覧
 */
const OUTPUT_ID_COLUMNS_MAP: Record<string, ColumnOption[]> = {
  local_accounts: [
    {
      label: 'ローカルアカウント ID',
      name: 'id',
      nullable: false,
      type: 'integer',
    },
    {
      label: 'プロフィール ID',
      name: 'profile_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: 'サーバー ID',
      name: 'server_id',
      nullable: false,
      type: 'integer',
    },
  ],
  notifications: [
    {
      label: '通知 ID',
      name: 'id',
      nullable: false,
      type: 'integer',
    },
    {
      label: 'アクターのプロフィール ID',
      name: 'actor_profile_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '関連投稿 ID',
      name: 'related_post_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '通知種別 ID',
      name: 'notification_type_id',
      nullable: false,
      type: 'integer',
    },
  ],
  posts: [
    { label: '投稿 ID', name: 'id', nullable: false, type: 'integer' },
    {
      label: '著者のプロフィール ID',
      name: 'author_profile_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: '配信元サーバー ID',
      name: 'origin_server_id',
      nullable: false,
      type: 'integer',
    },
    {
      label: 'リブログ元投稿 ID',
      name: 'reblog_of_post_id',
      nullable: true,
      type: 'integer',
    },
    {
      label: '引用元投稿 ID',
      name: 'quote_of_post_id',
      nullable: true,
      type: 'integer',
    },
  ],
  profiles: [
    { label: 'プロフィール ID', name: 'id', nullable: false, type: 'integer' },
  ],
}

/**
 * getIds ノードの出力 ID カラム候補を返す。
 * テーブルの PK や FK など、下流ノードへ渡せる整数 ID カラムの一覧。
 */
export function getOutputIdColumns(table: string): ColumnOption[] {
  if (OUTPUT_ID_COLUMNS_MAP[table]) {
    return OUTPUT_ID_COLUMNS_MAP[table]
  }
  // フォールバック: レジストリの整数カラムから ID 系カラムを抽出
  const entry = TABLE_REGISTRY[table]
  if (!entry)
    return [{ label: 'ID', name: 'id', nullable: false, type: 'integer' }]
  const idCols: ColumnOption[] = Object.entries(entry.columns)
    .filter(
      ([name, meta]) =>
        meta.type === 'integer' &&
        !name.endsWith('_ms') &&
        !name.startsWith('is_'),
    )
    .map(([name, meta]) => ({
      label: meta.label,
      name,
      nullable: meta.nullable,
      type: 'integer' as const,
    }))
  if (!idCols.some((c) => c.name === 'id')) {
    idCols.unshift({
      label: 'ID',
      name: 'id',
      nullable: false,
      type: 'integer',
    })
  }
  return idCols
}

// --------------- Output table resolution ---------------

/**
 * FK カラム名 → ターゲットテーブル名の明示的マッピング。
 * スキーマの FK 定義に基づく。新しい FK が追加された場合はここに追記する。
 */
const FK_TARGET_TABLE: Record<string, string> = {
  actor_profile_id: 'profiles',
  author_profile_id: 'profiles',
  card_type_id: 'card_types',
  display_post_id: 'posts',
  local_account_id: 'local_accounts',
  media_type_id: 'media_types',
  moved_to_profile_id: 'profiles',
  notification_type_id: 'notification_types',
  origin_server_id: 'servers',
  post_id: 'posts',
  profile_id: 'profiles',
  quote_of_post_id: 'posts',
  reblog_of_post_id: 'posts',
  related_post_id: 'posts',
  server_id: 'servers',
  visibility_id: 'visibility_types',
}

/**
 * ソーステーブルと出力 ID カラムから、行が所属するターゲットテーブルを解決する。
 *
 * - `outputIdColumn` が `'id'` → ソーステーブル自身
 * - FK カラム名に一致 → `FK_TARGET_TABLE` から解決
 * - フォールバック → ソーステーブル
 *
 * @example
 * resolveOutputTable('timeline_entries', 'post_id')  // → 'posts'
 * resolveOutputTable('notifications', 'id')          // → 'notifications'
 * resolveOutputTable('notifications', 'related_post_id') // → 'posts'
 */
export function resolveOutputTable(
  sourceTable: string,
  outputIdColumn: string,
): string {
  if (outputIdColumn === 'id') return sourceTable
  return FK_TARGET_TABLE[outputIdColumn] ?? sourceTable
}

/** Output ノードで受入可能なテーブル */
export const SUPPORTED_OUTPUT_TABLES = new Set(['posts', 'notifications'])

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
