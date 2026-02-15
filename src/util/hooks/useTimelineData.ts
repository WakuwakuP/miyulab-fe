'use client'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useFilteredTagTimeline } from 'util/hooks/useFilteredTagTimeline'
import { useFilteredTimeline } from 'util/hooks/useFilteredTimeline'
import { useNotifications } from 'util/hooks/useNotifications'

/**
 * TimelineConfigV2 に基づいて適切なデータ取得 Hook を選択するファサード
 *
 * - type === 'tag' → useFilteredTagTimeline
 * - type === 'home' | 'local' | 'public' → useFilteredTimeline
 * - type === 'notification' → useNotifications (既存)
 *
 * ※ React の Hook ルール（条件分岐内での Hook 呼び出し禁止）を遵守するため、
 *   内部では全 Hook を常に呼び出し、type に応じて結果を選択する。
 *
 * ※ 各 Hook 内部で config.type をチェックして早期に空配列を返すため、
 *   不要な DB クエリは発行されない。例えば type === 'tag' の場合、
 *   useFilteredTimeline は DB クエリをスキップして空配列を返す。
 */
export function useTimelineData(
  config: TimelineConfigV2,
): NotificationAddAppIndex[] | StatusAddAppIndex[] {
  // 全 Hook を無条件に呼び出す（Hook ルール遵守）
  const filteredTimeline = useFilteredTimeline(config)
  const filteredTagTimeline = useFilteredTagTimeline(config)
  const notifications = useNotifications(config)

  switch (config.type) {
    case 'home':
    case 'local':
    case 'public':
      return filteredTimeline
    case 'notification':
      return notifications
    case 'tag':
      return filteredTagTimeline
    default:
      return []
  }
}
