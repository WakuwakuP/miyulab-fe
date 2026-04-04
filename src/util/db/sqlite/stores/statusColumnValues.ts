/**
 * Status ストア — 補完用カラム値取得
 *
 * DB に保存されたタグ・タイムラインタイプ・カラム値の取得を提供する。
 * 主にエディタの入力補完に使用される。
 */

import { getSqliteDb } from '../connection'
import {
  ALIAS_TO_TABLE,
  ALLOWED_COLUMN_VALUES,
  COLUMN_TABLE_OVERRIDE,
} from '../queries/statusCustomQuery'

/**
 * DB に保存されている全タグ名を取得する（補完用）
 */
export async function getDistinctTags(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT ht.name FROM post_hashtags pht INNER JOIN hashtags ht ON pht.hashtag_id = ht.id ORDER BY ht.name;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * DB に保存されている全タイムラインタイプを取得する（補完用）
 */
export async function getDistinctTimelineTypes(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT te.timeline_key FROM timeline_entries te ORDER BY te.timeline_key;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

export async function getDistinctColumnValues(
  table: string,
  column: string,
  maxResults = 20,
): Promise<string[]> {
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(column)) return []

  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != '' ORDER BY "${column}" LIMIT ?;`,
      { bind: [maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値をプレフィクス検索で取得する（補完用）
 *
 * エイリアス (p, pbt, pme 等) とカラム名から実テーブルを解決し、
 * 入力中のプレフィクスに一致する値を DB から検索して返す。
 */
export async function searchDistinctColumnValues(
  alias: string,
  column: string,
  prefix: string,
  maxResults = 20,
): Promise<string[]> {
  // 互換カラムのオーバーライドを優先
  const override = COLUMN_TABLE_OVERRIDE[alias]?.[column]
  let table: string
  let realColumn: string

  if (override) {
    table = override.table
    realColumn = override.column
  } else {
    const mapping = ALIAS_TO_TABLE[alias]
    if (!mapping) return []
    const col = mapping.columns[column]
    if (!col) return []
    table = mapping.table
    realColumn = col
  }

  if (!ALLOWED_COLUMN_VALUES[table]?.includes(realColumn)) return []

  try {
    const handle = await getSqliteDb()
    // LIKE でプレフィクスフィルタ（ESCAPE でワイルドカード文字を安全にエスケープ）
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${realColumn}" FROM "${table}" WHERE "${realColumn}" IS NOT NULL AND "${realColumn}" != '' AND "${realColumn}" LIKE ? ESCAPE '\\' ORDER BY "${realColumn}" LIMIT ?;`,
      { bind: [`${escaped}%`, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * テーブル名・カラム名を直接指定してプレフィクス検索する（NodeEditor 用）
 *
 * ALIAS_TO_TABLE を経由せず、テーブル名とカラム名を直接指定して
 * ALLOWED_COLUMN_VALUES のホワイトリストに準拠した値検索を行う。
 */
export async function searchColumnValuesDirect(
  table: string,
  column: string,
  prefix: string,
  maxResults = 20,
): Promise<string[]> {
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(column)) return []

  try {
    const handle = await getSqliteDb()
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != '' AND "${column}" LIKE ? ESCAPE '\\' ORDER BY "${column}" LIMIT ?;`,
      { bind: [`${escaped}%`, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}
