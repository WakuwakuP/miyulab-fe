// ============================================================
// getIds IdCollectStep インメモリキャッシュ (Phase 2)
//
// SQL+binds のハッシュをキーに NodeOutputRow[] をキャッシュし、
// テーブルへの書き込みがあった場合のみ自動無効化する。
// ============================================================

import type { NodeOutputRow } from 'util/db/query-ir/plan'

// --------------- キャッシュエントリ ---------------

type CacheEntry = {
  rows: NodeOutputRow[]
  /**
   * キャッシュ取得時点のテーブルバージョンスナップショット。
   * notifyChange 後にバージョンが上がっていたら無効化する。
   */
  capturedVersions: Record<string, number>
  /** キャッシュ対象のテーブル名（無効化判定に使用） */
  sourceTable: string
}

// --------------- ストレージ ---------------

const cache = new Map<string, CacheEntry>()

/** メインスレッドで追跡するテーブルバージョン（Worker のバージョンと同期） */
const localTableVersions = new Map<string, number>()

// --------------- キャッシュキー ---------------

export type IdCollectKey = {
  sql: string
  binds: (string | number | null)[]
  /** Phase 3: 上流ノード結果のハッシュ（オプション） */
  upstreamHash?: string
}

function makeKey(params: IdCollectKey): string {
  const parts: string[] = [params.sql, JSON.stringify(params.binds)]
  if (params.upstreamHash) parts.push(params.upstreamHash)
  return parts.join('\0')
}

// --------------- 公開 API ---------------

/**
 * キャッシュから IdCollect 結果を取得する。
 * バージョンが古い場合は自動的にキャッシュを無効化して null を返す。
 */
export function getCachedIdCollect(
  params: IdCollectKey,
): NodeOutputRow[] | null {
  const key = makeKey(params)
  const entry = cache.get(key)
  if (!entry) return null

  // バージョン検証: キャッシュ取得時より後に対象テーブルへの書き込みがあれば無効
  const currentVersion = localTableVersions.get(entry.sourceTable) ?? 0
  const capturedVersion = entry.capturedVersions[entry.sourceTable] ?? 0
  if (currentVersion !== capturedVersion) {
    cache.delete(key)
    return null
  }

  return entry.rows
}

/**
 * IdCollect 結果をキャッシュに保存する。
 * Worker から返ってきた capturedVersions と sourceTable を一緒に保存する。
 */
export function setCachedIdCollect(
  params: IdCollectKey,
  rows: NodeOutputRow[],
  capturedVersions: Record<string, number>,
  sourceTable: string,
): void {
  const key = makeKey(params)
  cache.set(key, { capturedVersions, rows, sourceTable })
}

/**
 * テーブルへの書き込みを通知してバージョンを進める。
 * `notifyChange(table)` が発火した直後に呼ぶこと。
 * キャッシュの即時削除は行わず、次回 get 時にバージョン不一致で自動無効化される。
 */
export function bumpLocalTableVersion(table: string): void {
  localTableVersions.set(table, (localTableVersions.get(table) ?? 0) + 1)
}

/**
 * Worker から受け取った capturedVersions でローカルバージョンを同期する。
 * Worker 側でインクリメントされたバージョンをメインスレッドに反映する。
 */
export function syncTableVersions(
  capturedVersions: Record<string, number>,
): void {
  for (const [table, version] of Object.entries(capturedVersions)) {
    const local = localTableVersions.get(table) ?? 0
    if (version > local) {
      localTableVersions.set(table, version)
    }
  }
}

/** キャッシュを全クリアする（デバッグ用） */
export function clearIdCollectCache(): void {
  cache.clear()
}

/** 現在のキャッシュエントリ数を返す（デバッグ用） */
export function getIdCollectCacheSize(): number {
  return cache.size
}
