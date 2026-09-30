// ============================================================
// Graph Executor — Worker 側ノードキャッシュ
//
// SQL + binds + upstreamHash をキーに NodeOutputRow[] をキャッシュし、
// テーブルバージョンの変更で自動無効化する。
// Worker スレッド内で使用（メインスレッドの idCollectCache とは独立）。
// ============================================================

import type { NodeOutputRow } from '../plan'

// --------------- キャッシュエントリ ---------------

type CacheEntry = {
  rows: NodeOutputRow[]
  /** キャッシュ取得時点のテーブルバージョンスナップショット */
  capturedVersions: Record<string, number>
  /** 依存テーブル名一覧（無効化判定に使用） */
  dependentTables: string[]
}

// --------------- キャッシュキー ---------------

export type NodeCacheKey = {
  nodeId: string
  sql: string
  binds: (string | number | null)[]
  /** 上流ノード結果のハッシュ（依存関係の変更検出用） */
  upstreamHash?: string
}

function makeKey(params: NodeCacheKey): string {
  const parts: string[] = [
    params.nodeId,
    params.sql,
    JSON.stringify(params.binds),
  ]
  if (params.upstreamHash != null) parts.push(params.upstreamHash)
  return parts.join('\0')
}

// --------------- WorkerNodeCache クラス ---------------

const MAX_ENTRIES = 200
const MAX_ROWS = 50_000

export function serializeRowsForHash(rows: NodeOutputRow[]): string {
  return JSON.stringify(rows.map((r) => [r.table, r.id, r.createdAtMs]))
}

/**
 * Worker 内で動作するノードキャッシュ。
 *
 * テーブルバージョンベースの遅延無効化を行う。
 * Worker はテーブルへの書き込みを直接検知できるため、
 * メインスレッドとのバージョン同期は不要。
 */
export class WorkerNodeCache {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly tableVersions = new Map<string, number>()
  private totalRows = 0

  /**
   * キャッシュから結果を取得する。
   * テーブルバージョンが変わっていれば自動的に無効化して null を返す。
   */
  get(params: NodeCacheKey): NodeOutputRow[] | null {
    const key = makeKey(params)
    const entry = this.cache.get(key)
    if (!entry) return null

    // 依存テーブルのバージョン検証
    for (const table of entry.dependentTables) {
      const current = this.tableVersions.get(table) ?? 0
      const captured = entry.capturedVersions[table] ?? 0
      if (current !== captured) {
        this.removeEntry(key, entry)
        return null
      }
    }

    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.rows
  }

  /** 結果をキャッシュに保存する */
  set(
    params: NodeCacheKey,
    rows: NodeOutputRow[],
    dependentTables: string[],
  ): void {
    const key = makeKey(params)
    const existing = this.cache.get(key)
    if (existing) {
      this.removeEntry(key, existing)
    }
    if (rows.length > MAX_ROWS) return

    const capturedVersions: Record<string, number> = {}
    for (const table of dependentTables) {
      capturedVersions[table] = this.tableVersions.get(table) ?? 0
    }

    this.evictIfNeeded(rows.length)
    this.cache.set(key, { capturedVersions, dependentTables, rows })
    this.totalRows += rows.length
  }

  /** テーブルへの書き込みを通知してバージョンを進める */
  bumpVersion(table: string): void {
    this.tableVersions.set(table, (this.tableVersions.get(table) ?? 0) + 1)
    this.invalidateDependents(table)
  }

  /** 外部のテーブルバージョンマップと同期する */
  syncVersions(versions: Map<string, number>): void {
    for (const [table, version] of versions) {
      const local = this.tableVersions.get(table) ?? 0
      if (version > local) {
        this.tableVersions.set(table, version)
        this.invalidateDependents(table)
      }
    }
  }

  /** 現在のテーブルバージョンスナップショットを返す */
  captureVersions(): Record<string, number> {
    return Object.fromEntries(this.tableVersions)
  }

  /** キャッシュを全クリアする */
  clear(): void {
    this.cache.clear()
    this.totalRows = 0
  }

  /** 現在のキャッシュエントリ数を返す */
  get size(): number {
    return this.cache.size
  }

  private removeEntry(key: string, entry: CacheEntry): void {
    this.cache.delete(key)
    this.totalRows -= entry.rows.length
  }

  private evictIfNeeded(incomingRows: number): void {
    while (
      this.cache.size >= MAX_ENTRIES ||
      this.totalRows + incomingRows > MAX_ROWS
    ) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) return
      const oldest = this.cache.get(oldestKey)
      this.cache.delete(oldestKey)
      if (oldest) {
        this.totalRows -= oldest.rows.length
      }
    }
  }

  private invalidateDependents(table: string): void {
    for (const [key, entry] of this.cache) {
      if (entry.dependentTables.includes(table)) {
        this.removeEntry(key, entry)
      }
    }
  }
}
