'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useContext, useMemo } from 'react'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { db } from 'util/db/database'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 * 呼び出し側で appIndex === -1 のレコードを除外すること。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * 通知をリアクティブに取得するHook
 *
 * 複合インデックス [backendUrl+created_at_ms] を活用し、
 * 可能な限りDB側でソート・フィルタを行う。
 *
 * created_at_ms は数値型（UnixTime ms）のため、
 * ソート順が確実に時系列となる。
 */
export function useNotifications(
  config?: TimelineConfigV2,
): NotificationAddAppIndex[] {
  const apps = useContext(AppsContext)

  // configが渡された場合はbackendFilterを適用、なければ全バックエンド
  const targetBackendUrls = useMemo(() => {
    if (!config) {
      return apps.map((app) => app.backendUrl)
    }
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config, apps])

  const notifications = useLiveQuery(
    async () => {
      if (targetBackendUrls.length === 0) return []

      // 各backendUrl別に複合インデックスで降順取得し、マージする
      const perUrlResults = await Promise.all(
        targetBackendUrls.map((url) =>
          db.notifications
            .where('[backendUrl+created_at_ms]')
            .between([url, Dexie.minKey], [url, Dexie.maxKey])
            .reverse()
            .limit(MAX_LENGTH)
            .toArray(),
        ),
      )

      const merged = perUrlResults.flat()
      return merged
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .slice(0, MAX_LENGTH)
    },
    [targetBackendUrls],
    [],
  )

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
  return useMemo(
    () =>
      notifications
        .map((n) => ({
          ...n,
          appIndex: resolveAppIndex(n.backendUrl, apps),
        }))
        .filter((n) => n.appIndex !== -1),
    [notifications, apps],
  )
}
