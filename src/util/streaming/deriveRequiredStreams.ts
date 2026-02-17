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
 * - local / public: 全 backendUrl に対してデフォルトでストリーミング接続する
 *   （タイムライン設定の有無に関わらず常時接続）
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
): Set<string> {
  const keys = new Set<string>()

  // local / public は全 backendUrl に対してデフォルトでストリーミング接続
  for (const app of apps) {
    keys.add(createStreamKey('local', app.backendUrl))
    keys.add(createStreamKey('public', app.backendUrl))
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
