/**
 * backend_url → { localAccountId, serverId } の解決と管理
 *
 * DB に保存された local_accounts テーブルのレコードを
 * メインスレッド側でキャッシュし、SQL クエリからの
 * local_accounts JOIN / サブクエリを排除する。
 */

import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedAccount = {
  localAccountId: number
  serverId: number
  backendUrl: string
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let accountCache = new Map<string, ResolvedAccount>()
let initialized = false
let subscribed = false
const listeners = new Set<() => void>()

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function notifyListeners(): void {
  for (const fn of listeners) {
    fn()
  }
}

async function loadFromDb(): Promise<Map<string, ResolvedAccount>> {
  const handle = await getSqliteDb()
  const rows = (await handle.execAsync(
    'SELECT id, backend_url, server_id FROM local_accounts;',
    { returnValue: 'resultRows' },
  )) as [number, string, number][]

  const map = new Map<string, ResolvedAccount>()
  for (const [id, backendUrl, serverId] of rows) {
    map.set(backendUrl, { backendUrl, localAccountId: id, serverId })
  }
  return map
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * DB から local_accounts を読み込みキャッシュを構築する。
 * 初回呼び出し時に `local_accounts` テーブルの変更購読も登録する。
 */
export async function initAccountResolver(): Promise<void> {
  accountCache = await loadFromDb()
  initialized = true

  // 変更購読は一度だけ登録
  if (!subscribed) {
    subscribed = true
    subscribe('local_accounts', () => {
      refreshAccountResolver()
    })
  }

  notifyListeners()
}

/** backend_url → local_account_id を同期的に返す */
export function resolveLocalAccountId(backendUrl: string): number | null {
  return accountCache.get(backendUrl)?.localAccountId ?? null
}

/** backend_url → server_id を同期的に返す */
export function resolveServerId(backendUrl: string): number | null {
  return accountCache.get(backendUrl)?.serverId ?? null
}

/** 複数の backend_url を一括解決し、解決できたもののみ返す */
export function resolveLocalAccountIds(backendUrls: string[]): number[] {
  const ids: number[] = []
  for (const url of backendUrls) {
    const id = resolveLocalAccountId(url)
    if (id != null) ids.push(id)
  }
  return ids
}

/** 複数の backend_url から server_id を一括解決し、解決できたもののみ返す */
export function resolveServerIds(backendUrls: string[]): number[] {
  const ids: number[] = []
  for (const url of backendUrls) {
    const id = resolveServerId(url)
    if (id != null) ids.push(id)
  }
  return ids
}

/** local_account_id → backend_url の逆引き */
export function resolveBackendUrlFromAccountId(
  localAccountId: number,
): string | null {
  for (const entry of accountCache.values()) {
    if (entry.localAccountId === localAccountId) return entry.backendUrl
  }
  return null
}

/** キャッシュを DB から再読み込みする（アカウント追加・削除時に呼ばれる） */
export async function refreshAccountResolver(): Promise<void> {
  accountCache = await loadFromDb()
  notifyListeners()
}

/** キャッシュが初期化済みかどうかを返す */
export function isAccountResolverReady(): boolean {
  return initialized
}

/**
 * キャッシュ変更を購読する（useSyncExternalStore 向け）。
 * 返り値は購読解除関数。
 */
export function subscribeAccountResolver(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 現在のキャッシュ Map を返す（useSyncExternalStore getSnapshot 向け）。
 * refreshAccountResolver で Map インスタンスが置き換わるため
 * 参照比較で変更検知が可能。
 */
export function getSnapshot(): ReadonlyMap<string, ResolvedAccount> {
  return accountCache
}
