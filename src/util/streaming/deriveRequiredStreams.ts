import type { App, TimelineConfigV2 } from 'types/types'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { createStreamKey } from './streamKey'

/**
 * タイムライン設定一覧から必要なストリーム接続キーを算出する
 *
 * ## 算出ルール
 *
 * - type === 'home': userStreaming は StatusStoreProvider 管理のため対象外
 * - type === 'notification': userStreaming に含まれるため対象外
 * - type === 'local': 各対象 backendUrl に対して localStreaming を要求
 * - type === 'public': 各対象 backendUrl に対して publicStreaming を要求
 * - type === 'tag': 各対象 backendUrl × 各タグに対して tagStreaming を要求
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
): Set<string> {
  const keys = new Set<string>()

  for (const config of timelines) {
    // home / notification は userStreaming（StatusStoreProvider）で管理
    if (config.type === 'home' || config.type === 'notification') {
      continue
    }

    const filter = normalizeBackendFilter(config.backendFilter, apps)
    const backendUrls = resolveBackendUrls(filter, apps)

    for (const url of backendUrls) {
      if (config.type === 'tag' && config.tagConfig) {
        // tag: 各タグに対して個別のストリームを要求
        for (const tag of config.tagConfig.tags) {
          keys.add(createStreamKey('tag', url, tag))
        }
      } else if (config.type === 'local' || config.type === 'public') {
        keys.add(createStreamKey(config.type, url))
      }
    }
  }

  return keys
}
