import { useSyncExternalStore } from 'react'

import type { SetDetailParams } from 'util/provider/DetailProvider'

// --- Route types ---

export type PanelRoute =
  | { type: 'home' }
  | { type: 'bookmark'; accountIndex: number }
  | { type: 'dm'; accountIndex: number }
  | { type: 'setting' }
  | { type: 'timeline' }
  | { type: 'accounts' }
  | { type: 'database' }
  | { type: 'status'; accountIndex: number; statusId: string }
  | { type: 'profile'; acct: string }
  | { type: 'hashtag'; tag: string }

// --- Types for GettingStarted selected state ---

export type GettingStartedView =
  | 'bookmark'
  | 'dm'
  | 'setting'
  | 'timeline'
  | 'accounts'
  | 'database'
  | null

// --- Route parsing ---

export function parsePanelRoute(pathname: string): PanelRoute {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return { type: 'home' }

  switch (parts[0]) {
    case 'bookmark': {
      const idx = Number(parts[1])
      return { accountIndex: Number.isNaN(idx) ? 0 : idx, type: 'bookmark' }
    }
    case 'dm': {
      const idx = Number(parts[1])
      return { accountIndex: Number.isNaN(idx) ? 0 : idx, type: 'dm' }
    }
    case 'setting':
      return { type: 'setting' }
    case 'timeline':
      return { type: 'timeline' }
    case 'accounts':
      return { type: 'accounts' }
    case 'database':
      return { type: 'database' }
    case 'status': {
      const idx = Number(parts[1])
      return {
        accountIndex: Number.isNaN(idx) ? 0 : idx,
        statusId: parts[2] ?? '',
        type: 'status',
      }
    }
    case 'profile': {
      // /profile/@user@domain or /profile/@user
      const raw = parts.slice(1).join('/')
      const acct = decodeURIComponent(raw).replace(/^@/, '')
      return { acct, type: 'profile' }
    }
    case 'hashtag':
      return { tag: decodeURIComponent(parts[1] ?? ''), type: 'hashtag' }
    default:
      return { type: 'home' }
  }
}

// --- Route → selected view (for GettingStarted) ---

export function routeToView(route: PanelRoute): GettingStartedView {
  switch (route.type) {
    case 'bookmark':
      return 'bookmark'
    case 'dm':
      return 'dm'
    case 'setting':
      return 'setting'
    case 'timeline':
      return 'timeline'
    case 'accounts':
      return 'accounts'
    case 'database':
      return 'database'
    default:
      return null
  }
}

export function routeToAccountIndex(route: PanelRoute): number {
  if (route.type === 'bookmark' || route.type === 'dm') {
    return route.accountIndex
  }
  return 0
}

// --- Detail params → URL path ---

export function detailToPath(params: SetDetailParams): string {
  switch (params.type) {
    case 'Status':
      // id が空（SQLite キャッシュ由来で local_id 未解決）の場合は
      // URL を変えず、DetailPanel 側で search API で解決させる
      if (!params.content.id) return window.location.pathname
      return `/status/${params.content.appIndex}/${params.content.id}`
    case 'Account':
      return `/profile/@${params.content.acct}`
    case 'SearchUser':
      // SearchUser は中間状態（すぐ Account に解決される）なので URL を変えない
      return window.location.pathname
    case 'Hashtag':
      return `/hashtag/${encodeURIComponent(params.content ?? '')}`
    case null:
      return '/'
  }
}

// --- Reactive URL subscription (useSyncExternalStore) ---

const listeners = new Set<() => void>()

function emitChange() {
  for (const fn of listeners) fn()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', emitChange)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return window.location.pathname
}

function getServerSnapshot() {
  return '/'
}

/** 現在の URL パスをリアクティブに返すフック */
export function usePanelRoute(): PanelRoute {
  const pathname = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  )
  return parsePanelRoute(pathname)
}

// --- Navigation functions ---

/** pushState で URL を変更し、サブスクライバーに通知する */
export function navigatePanel(path: string, state?: unknown) {
  window.history.pushState(state ?? null, '', path)
  emitChange()
}

/** replaceState で現在の URL を書き換える（履歴エントリ追加なし） */
export function replacePanelUrl(path: string, state?: unknown) {
  window.history.replaceState(state ?? null, '', path)
}

/** Detail route かどうか判定する */
export function isDetailRoute(route: PanelRoute): boolean {
  return (
    route.type === 'status' ||
    route.type === 'profile' ||
    route.type === 'hashtag'
  )
}
