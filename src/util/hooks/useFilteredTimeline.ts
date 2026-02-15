'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useContext, useMemo } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { type TimelineType as DbTimelineType, db } from 'util/db/database'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * appIndex はDBに永続化しないため、表示時に都度算出する。
 * apps の並び替えが行われても常に最新のインデックスが得られる。
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * TimelineConfigV2 に基づいてフィルタ済みの Status 配列を返す
 *
 * 対応する type:
 * - 'home' | 'local' | 'public': timelineTypes インデックスを使用
 * - 'tag': このHookでは扱わない（useFilteredTagTimeline に委譲）
 * - 'notification': このHookでは扱わない
 *
 * ## クエリ戦略
 *
 * backendFilter.mode に応じてクエリ対象の backendUrl を決定し、
 * 複合インデックス [backendUrl+created_at_ms] を活用して
 * DB 側でソート・フィルタを行う。
 *
 * onlyMedia フィルタは DB インデックスに含まれないため、
 * JS 側で適用する（表示層フィルタリング）。
 */
export function useFilteredTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)

  // 1. BackendFilter から対象 backendUrls を解決
  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  // 依存配列用に安定したプリミティブを生成
  const backendUrlsKey = targetBackendUrls.join(',')

  // 2. IndexedDB からリアクティブにデータ取得
  //    type === 'tag' / 'notification' の場合は早期に空配列を返し、
  //    不要な DB クエリの発行を防ぐ（useTimelineData で全 Hook を
  //    無条件に呼び出すため、この分岐が必須）
  const statuses = useLiveQuery(
    async () => {
      // tag / notification はそれぞれ専用 Hook で処理するためスキップ
      if (config.type === 'tag' || config.type === 'notification') return []
      if (targetBackendUrls.length === 0) return []

      const perUrlResults = await Promise.all(
        targetBackendUrls.map((url) =>
          db.statuses
            .where('[backendUrl+created_at_ms]')
            .between([url, Dexie.minKey], [url, Dexie.maxKey])
            .reverse()
            .filter((s) =>
              s.timelineTypes.includes(config.type as DbTimelineType),
            )
            .limit(MAX_LENGTH)
            .toArray(),
        ),
      )

      let merged = perUrlResults.flat()

      // 3. onlyMedia フィルタ（JS 側）
      if (config.onlyMedia) {
        merged = merged.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      return merged
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .slice(0, MAX_LENGTH)
    },
    [backendUrlsKey, config.type, config.onlyMedia],
    [],
  )

  // 4. appIndex を付与
  return useMemo(
    () =>
      statuses
        .map((s) => ({
          ...s,
          appIndex: resolveAppIndex(s.backendUrl, apps),
        }))
        .filter((s) => s.appIndex !== -1),
    [statuses, apps],
  )
}
