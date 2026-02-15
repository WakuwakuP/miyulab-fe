import type { App, BackendFilter, TagConfig } from 'types/types'

/**
 * BackendFilter を正規化する
 * apps に存在しない backendUrl を除外し、要素数に応じて mode を調整する
 */
export function normalizeBackendFilter(
  filter: BackendFilter | undefined,
  apps: App[],
): BackendFilter {
  if (filter == null) return { mode: 'all' }

  const validUrls = apps.map((app) => app.backendUrl)

  switch (filter.mode) {
    case 'all':
      return filter

    case 'single':
      if (!validUrls.includes(filter.backendUrl)) {
        return { mode: 'all' }
      }
      return filter

    case 'composite': {
      const filtered = filter.backendUrls.filter((url) =>
        validUrls.includes(url),
      )
      if (filtered.length === 0) return { mode: 'all' }
      if (filtered.length === 1)
        return { backendUrl: filtered[0], mode: 'single' }
      // ソートして正規化（同一の URL 組み合わせが異なる順序で保存されることを防ぐ）
      return { backendUrls: [...filtered].sort(), mode: 'composite' }
    }
  }
}

/**
 * TagConfig を正規化する
 * 重複タグを除去する
 */
export function normalizeTagConfig(tagConfig: TagConfig): TagConfig {
  return {
    mode: tagConfig.mode,
    tags: Array.from(new Set(tagConfig.tags)),
  }
}

/**
 * BackendFilter から対象の backendUrl 配列を解決する
 */
export function resolveBackendUrls(
  filter: BackendFilter,
  apps: App[],
): string[] {
  switch (filter.mode) {
    case 'all':
      return apps.map((app) => app.backendUrl)
    case 'composite':
      return filter.backendUrls
    case 'single':
      return [filter.backendUrl]
  }
}
