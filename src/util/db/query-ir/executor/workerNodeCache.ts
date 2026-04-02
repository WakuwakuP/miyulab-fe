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
  if (params.upstreamHash) parts.push(params.upstreamHash)
  return parts.join('\0')
}

// --------------- WorkerNodeCache クラス ---------------

/**
 * Worker 内で動作するノードキャッシュ。
 *
 * テーブルバージョンベースの遅延無効化を行う。
 * Worker はテーブルへの書き込みを直接検知できるため、
 * メインスレッドとのバージョン同期は不要。
 */
export class WorkerNodeCache {
  private cache = new Map<string, CacheEntry>()
  private tableVersions = new Map<string, number>()

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
        this.cache.delete(key)
        return null
      }
    }

    return entry.rows
  }

  /** 結果をキャッシュに保存する */
  set(
    params: NodeCacheKey,
    rows: NodeOutputRow[],
    dependentTables: string[],
  ): void {
    const key = makeKey(params)
    const capturedVersions: Record<string, number> = {}
    for (const table of dependentTables) {
      capturedVersions[table] = this.tableVersions.get(table) ?? 0
    }
    this.cache.set(key, { capturedVersions, dependentTables, rows })
  }

  /** テーブルへの書き込みを通知してバージョンを進める */
  bumpVersion(table: string): void {
    this.tableVersions.set(table, (this.tableVersions.get(table) ?? 0) + 1)
  }

  /** 外部のテーブルバージョンマップと同期する */
  syncVersions(versions: Map<string, number>): void {
    for (const [table, version] of versions) {
      const local = this.tableVersions.get(table) ?? 0
      if (version > local) {
        this.tableVersions.set(table, version)
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
  }

  /** 現在のキャッシュエントリ数を返す */
  get size(): number {
    return this.cache.size
  }
}
