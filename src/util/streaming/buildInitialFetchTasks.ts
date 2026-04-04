import type { App, TimelineConfigV2 } from 'types/types'
import { GetClient } from 'util/GetClient'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { fetchInitialData } from 'util/timelineFetcher'

/**
 * apps と timelineSettings から初期データ取得タスク配列を構築する。
 *
 * - local / public は全 backendUrl に対してデフォルトで取得
 * - tag は tagConfig を持つタイムライン設定から取得
 * - fetchedKeys で取得済みキーを追跡し、重複フェッチを防止する
 *
 * fetchedKeys は呼び出し元が管理する Set で、この関数内で取得対象を
 * 追加する（副作用あり）。
 */
export function buildInitialFetchTasks(
  apps: App[],
  timelines: TimelineConfigV2[],
  fetchedKeys: Set<string>,
): (() => Promise<void>)[] {
  const tasks: (() => Promise<void>)[] = []

  // local / public は全 backendUrl に対してデフォルトで初期データを取得
  for (const app of apps) {
    const { backendUrl } = app
    const client = GetClient(app)
    for (const type of ['local', 'public'] as const) {
      const key = `${type}|${backendUrl}`
      if (fetchedKeys.has(key)) continue
      fetchedKeys.add(key)
      // fetchInitialData は config.type に基づいて動作するため、
      // local/public 用の最小限の設定を構築して渡す
      const config: TimelineConfigV2 = {
        id: `__default_${type}`,
        order: 0,
        type,
        visible: false,
      }
      tasks.push(() =>
        fetchInitialData(client, config, backendUrl).catch((error) => {
          console.error(
            `Failed to fetch initial data for ${type} (${backendUrl}):`,
            error,
          )
        }),
      )
    }
  }

  // tag タイムラインの初期データ取得（tagConfig を持つ全設定が対象）
  // 同一 tag × backendUrl の組み合わせは重複フェッチを防止する
  for (const config of timelines) {
    if (!config.tagConfig || config.tagConfig.tags.length === 0) continue

    const filter = normalizeBackendFilter(config.backendFilter, apps)
    const targetUrls = resolveBackendUrls(filter, apps)

    for (const url of targetUrls) {
      // 未フェッチのタグのみ抽出
      const newTags = config.tagConfig.tags.filter((tag) => {
        const key = `tag|${tag}|${url}`
        if (fetchedKeys.has(key)) return false
        fetchedKeys.add(key)
        return true
      })
      if (newTags.length === 0) continue

      const app = apps.find((a) => a.backendUrl === url)
      if (!app) continue

      // fetchInitialData は config.type で分岐するため、type を 'tag' に強制する
      const tagFetchConfig: TimelineConfigV2 = {
        ...config,
        tagConfig: { ...config.tagConfig, tags: newTags },
        type: 'tag',
      }

      const client = GetClient(app)
      tasks.push(() =>
        fetchInitialData(client, tagFetchConfig, url).catch((error) => {
          console.error(`Failed to fetch initial data for tag (${url}):`, error)
        }),
      )
    }
  }

  return tasks
}
