'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { useContext, useMemo } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { db, type StoredStatus } from 'util/db/database'
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
 * タグタイムライン用の統合 Hook
 *
 * ## OR 条件 (tagConfig.mode === 'or')
 * 各タグに対して belongingTags index でクエリを発行し、
 * compositeKey で重複排除してマージする。
 *
 * ## AND 条件 (tagConfig.mode === 'and')
 * 最初のタグで belongingTags index クエリを発行し、
 * JS 側で残りのタグの包含を検証する。
 *
 * ## パフォーマンス考慮
 * タグタイムラインは home/local と比較して件数が少ない想定のため、
 * JS 側フィルタでも十分なパフォーマンスが得られる。
 */
export function useFilteredTagTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const tagConfig = config.tagConfig

  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  const tags = tagConfig?.tags ?? []
  const tagMode = tagConfig?.mode ?? 'or'
  const onlyMedia = config.onlyMedia ?? false

  // 依存配列用に安定したプリミティブを生成
  const backendUrlsKey = targetBackendUrls.join(',')
  const tagsKey = tags.join(',')

  const statuses = useLiveQuery(
    async () => {
      // tag 以外の type の場合は早期に空配列を返し、不要な DB クエリを防ぐ
      // （useTimelineData で全 Hook を無条件に呼び出すため、この分岐が必須）
      if (config.type !== 'tag') return []
      if (targetBackendUrls.length === 0 || tags.length === 0) return []

      let results: StoredStatus[]

      if (tagMode === 'or') {
        // OR: 各タグで個別クエリ → compositeKey で重複排除
        const perTagResults = await Promise.all(
          tags.map((tag) =>
            db.statuses.where('belongingTags').equals(tag).toArray(),
          ),
        )
        const merged = new Map<string, StoredStatus>()
        for (const group of perTagResults) {
          for (const status of group) {
            if (targetBackendUrls.includes(status.backendUrl)) {
              merged.set(status.compositeKey, status)
            }
          }
        }
        results = Array.from(merged.values())
      } else {
        // AND: 最初のタグでクエリ → JS 側で全タグ包含チェック
        const baseResults = await db.statuses
          .where('belongingTags')
          .equals(tags[0])
          .filter((s) => targetBackendUrls.includes(s.backendUrl))
          .toArray()

        results = baseResults.filter((status) =>
          tags.every((tag) => status.belongingTags.includes(tag)),
        )
      }

      // onlyMedia フィルタ
      if (onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      return results
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .slice(0, MAX_LENGTH)
    },
    [backendUrlsKey, tagsKey, tagMode, onlyMedia, config.type],
    [],
  )

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
