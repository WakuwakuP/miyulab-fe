'use client'

/**
 * backend_url[] → local_account_id[] / server_id[] の解決を提供する Hook
 */
import { useMemo, useSyncExternalStore } from 'react'

import type { ResolvedAccount } from 'util/accountResolver'
import {
  getSnapshot,
  isAccountResolverReady,
  resolveLocalAccountIds,
  resolveServerIds,
  subscribeAccountResolver,
} from 'util/accountResolver'

const EMPTY_MAP: ReadonlyMap<string, never> = new Map<string, never>()

function useAccountResolverSnapshot(): ReadonlyMap<string, ResolvedAccount> {
  return useSyncExternalStore(
    subscribeAccountResolver,
    getSnapshot,
    () => EMPTY_MAP as ReadonlyMap<string, ResolvedAccount>,
  )
}

/** resolver キャッシュが初期化済みかどうかを返す */
export function useAccountResolverReady(): boolean {
  return useSyncExternalStore(
    subscribeAccountResolver,
    isAccountResolverReady,
    () => false,
  )
}

/** backend_url[] から local_account_id[] を解決する */
export function useLocalAccountIds(backendUrls: string[]): number[] {
  const snapshot = useAccountResolverSnapshot()
  return useMemo(
    () => (snapshot.size > 0 ? resolveLocalAccountIds(backendUrls) : []),
    [snapshot, backendUrls],
  )
}

/** backend_url[] から server_id[] を解決する */
export function useServerIds(backendUrls: string[]): number[] {
  const snapshot = useAccountResolverSnapshot()
  return useMemo(
    () => (snapshot.size > 0 ? resolveServerIds(backendUrls) : []),
    [snapshot, backendUrls],
  )
}
