import type { App, TimelineConfigV2 } from 'types/types'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { createStreamKey } from './streamKey'

export type RequiredPublicFeed = {
  backendUrl: string
  type: 'local' | 'public'
}

function isOpaqueFeedConsumer(config: TimelineConfigV2): boolean {
  return (
    config.customQuery != null ||
    config.queryPlan != null ||
    config.advancedQuery === true
  )
}

function addConfigPublicFeeds(
  config: TimelineConfigV2,
  apps: App[],
  add: (type: RequiredPublicFeed['type'], backendUrl: string) => void,
): void {
  const filter = normalizeBackendFilter(config.backendFilter, apps)
  const urls = resolveBackendUrls(filter, apps)
  if (urls.length === 0) return

  if (isOpaqueFeedConsumer(config)) {
    for (const url of urls) {
      add('local', url)
      add('public', url)
    }
    return
  }
  const types =
    config.timelineTypes && config.timelineTypes.length > 0
      ? config.timelineTypes
      : [config.type]
  for (const type of types) {
    if (type === 'local' || type === 'public') {
      for (const url of urls) {
        add(type, url)
      }
    }
  }
}

export function deriveRequiredPublicFeeds(
  timelines: TimelineConfigV2[],
  apps: App[],
  backgroundPublicStreaming = true,
): RequiredPublicFeed[] {
  const feeds = new Map<string, RequiredPublicFeed>()
  const add = (type: RequiredPublicFeed['type'], backendUrl: string) => {
    feeds.set(`${type}|${backendUrl}`, { backendUrl, type })
  }

  if (backgroundPublicStreaming) {
    // local / public は全 backendUrl に対してデフォルトで初期データを取得
    // local / public は全 backendUrl に対してデフォルトでストリーミング接続
    for (const app of apps) {
      add('local', app.backendUrl)
      add('public', app.backendUrl)
    }
    return [...feeds.values()]
  }

  for (const config of timelines) {
    addConfigPublicFeeds(config, apps, add)
  }
  return [...feeds.values()]
}

/**
 * タイムライン設定一覧から必要なストリーム接続キーを算出する
 *
 * ## 算出ルール
 *
 * - type === 'home': userStreaming は StatusStoreProvider 管理のため対象外
 * - type === 'notification': userStreaming に含まれるため対象外
 * - local / public: backgroundPublicStreaming が true の場合は全 backendUrl
 *   に対してデフォルトでストリーミング接続する（タイムライン設定の有無に
 *   関わらず常時接続）。false の場合は設定されたタイムラインが必要とする
 *   組み合わせのみ接続する。
 * - type === 'tag': 全タイムライン設定の tagConfig から
 *   各対象 backendUrl × 各タグに対して tagStreaming を要求
 *
 * ## 可視性
 *
 * visible === false のタイムラインについても、ストリーム接続は維持する。
 * これにより、タイムラインの表示/非表示を切り替えた際に
 * データの欠損（非表示中の投稿が取得されない）が発生しない。
 *
 * 将来的に「非表示時はストリーム切断」オプションを追加する場合は、
 * この関数に visible フィルタを追加する。
 */
export function deriveRequiredStreams(
  timelines: TimelineConfigV2[],
  apps: App[],
  backgroundPublicStreaming = true,
): Set<string> {
  const keys = new Set<string>()

  for (const feed of deriveRequiredPublicFeeds(
    timelines,
    apps,
    backgroundPublicStreaming,
  )) {
    keys.add(createStreamKey(feed.type, feed.backendUrl))
  }

  // tag: 全タイムライン設定の tagConfig からストリームを作成
  for (const config of timelines) {
    if (config.tagConfig && config.tagConfig.tags.length > 0) {
      const filter = normalizeBackendFilter(config.backendFilter, apps)
      const backendUrls = resolveBackendUrls(filter, apps)

      for (const url of backendUrls) {
        for (const tag of config.tagConfig.tags) {
          keys.add(createStreamKey('tag', url, tag))
        }
      }
    }
  }

  return keys
}
