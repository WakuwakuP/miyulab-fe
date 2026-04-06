/**
 * タイムラインデバッグログ
 *
 * prod 環境でも有効化可能。ブラウザ Console で:
 *   localStorage.setItem('debug:timeline', '1')
 *   // 無効化: localStorage.removeItem('debug:timeline')
 *
 * 有効時、[TL], [DS], [CN], [WC] プレフィックス付きログが出力される。
 */

let enabled: boolean | null = null

function isEnabled(): boolean {
  if (enabled !== null) return enabled
  try {
    enabled = globalThis.localStorage?.getItem('debug:timeline') === '1'
  } catch {
    enabled = false
  }
  return enabled
}

/** localStorage 変更時にキャッシュをリセット */
if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === 'debug:timeline' || e.key === null) {
      enabled = null
    }
  })
}

export function tlDebug(...args: unknown[]): void {
  if (isEnabled()) console.debug(...args)
}

/** 強制リフレッシュ（同一タブ内で localStorage を変更した場合に使用） */
export function refreshTimelineDebug(): void {
  enabled = null
}
