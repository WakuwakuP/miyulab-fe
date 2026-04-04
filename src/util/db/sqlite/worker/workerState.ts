/**
 * Worker 内で共有される mutable state
 *
 * db / sqlite3Module インスタンスとテーブルバージョン管理を一元化する。
 */

import type { TableName } from '../protocol'

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type RawDb = any

let db: RawDb = null
// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
let sqlite3Module: any = null

export function getDb(): RawDb {
  return db
}

export function setDb(value: RawDb): void {
  db = value
}

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
export function getSqlite3Module(): any {
  return sqlite3Module
}

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
export function setSqlite3Module(value: any): void {
  sqlite3Module = value
}

// テーブルごとの書き込みバージョン — 書き込みのたびにインクリメント
const tableVersions = new Map<string, number>()

/** 書き込みが発生したテーブルのバージョンをインクリメントする */
export function bumpTableVersions(tables: TableName[] | undefined): void {
  if (!tables) return
  for (const t of tables) {
    tableVersions.set(t, (tableVersions.get(t) ?? 0) + 1)
  }
}

/** 現在のテーブルバージョンスナップショットを返す */
export function captureTableVersions(): Record<string, number> {
  return Object.fromEntries(tableVersions)
}

/** tableVersions の Map を直接返す（グラフキャッシュ同期用） */
export function getTableVersionsMap(): Map<string, number> {
  return tableVersions
}
