'use client'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useCustomQueryTimeline } from 'util/hooks/useCustomQueryTimeline'
import { useFilteredTagTimeline } from 'util/hooks/useFilteredTagTimeline'
import { useFilteredTimeline } from 'util/hooks/useFilteredTimeline'
import { useNotifications } from 'util/hooks/useNotifications'

const noopLoadMore = () => {}

/**
 * `TimelineConfigV2` に基づき、適切なデータ取得 Hook を束ねるファサード。
 *
 * ルーティング優先順位:
 * 1. `queryPlan` あり → type ベースルーティング (IR コンパイルパス)
 *    - 各 Hook が normalizeQueryPlanForExecution → compilePhase1ForTimeline で直接処理
 *    - nodesToWhere 由来の customQuery よりも正確（accountScope/moderation 保持）
 * 2. `customQuery` が非空 → `useCustomQueryTimeline` (後方互換)
 * 3. type ベースルーティング
 *    - `type === 'tag'` → `useFilteredTagTimeline`
 *    - `type === 'home' | 'local' | 'public'` → `useFilteredTimeline`
 *    - `type === 'notification'` → `useNotifications`
 *
 * React の Hook ルールのため内部では全 Hook を常に呼び出し、上記に応じて戻り値だけを選択する。
 * 各実装 Hook は `config.type` 不一致時に早期リターンし、不要な DB クエリを避ける。
 *
 * @param config — タイムライン種別・フィルタ・カスタム SQL 等の設定
 * @returns 選択された Hook と同形の `{ data, queryDuration, loadMore }`
 * @remarks
 * `customQuery` が空で、かつ `type` が上記いずれでもない場合は
 * `{ data: [], queryDuration: null, loadMore: 空関数 }` を返す。
 * @see {@link useFilteredTimeline}
 * @see {@link useFilteredTagTimeline}
 * @see {@link useCustomQueryTimeline}
 * @see {@link useNotifications}
 */
export function useTimelineData(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
} {
  // 全 Hook を無条件に呼び出す（Hook ルール遵守）
  const filteredTimeline = useFilteredTimeline(config)
  const filteredTagTimeline = useFilteredTagTimeline(config)
  const notifications = useNotifications(config)
  const customQueryTimeline = useCustomQueryTimeline(config)

  // queryPlan が保存されている場合は IR コンパイルパスを優先
  // (各 Hook 内で normalizeQueryPlanForExecution → compilePhase1 で直接処理される)
  if (config.queryPlan) {
    switch (config.type) {
      case 'home':
      case 'local':
      case 'public':
        return filteredTimeline
      case 'notification':
        return notifications
      case 'tag':
        return filteredTagTimeline
    }
  }

  // customQuery が設定されている場合は後方互換パスを使用
  if (config.customQuery?.trim()) {
    return customQueryTimeline
  }

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
      return { data: [], loadMore: noopLoadMore, queryDuration: null }
  }
}
