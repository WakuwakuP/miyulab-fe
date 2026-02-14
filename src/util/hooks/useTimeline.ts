'use client'

import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useContext, useMemo } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import { db, type TimelineType } from 'util/db/database'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * appIndex はDBに永続化しないため、表示時に都度算出する。
 * apps の並び替えが行われても常に最新のインデックスが得られる。
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 * -1 を返すことで、呼び出し側で明示的に除外またはエラー通知を行える。
 * 0 を返すと別アカウント扱いになり、誤った権限で操作されるリスクがある。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * タイムライン種類に応じたStatusをリアクティブに取得するHook
 *
 * 複合インデックス [backendUrl+created_at_ms] を活用し、
 * 可能な限りDB側でソート・フィルタを行う。
 *
 * created_at_ms は数値型（UnixTime ms）のため、
 * ソート順が確実に時系列となる（文字列ソートの不確実性を排除）。
 *
 * @deprecated useFilteredTimeline を使用してください
 */
export function useTimeline(timelineType: TimelineType): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)

  const backendUrls = useMemo(() => apps.map((app) => app.backendUrl), [apps])

  const statuses = useLiveQuery(
    async () => {
      if (backendUrls.length === 0) return []

      // 各backendUrl別に複合インデックスで降順取得し、マージする
      const perUrlResults = await Promise.all(
        backendUrls.map((url) =>
          db.statuses
            .where('[backendUrl+created_at_ms]')
            .between([url, Dexie.minKey], [url, Dexie.maxKey])
            .reverse()
            .filter((s) => s.timelineTypes.includes(timelineType))
            .limit(MAX_LENGTH)
            .toArray(),
        ),
      )

      const merged = perUrlResults.flat()
      return merged
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .slice(0, MAX_LENGTH)
    },
    [backendUrls, timelineType],
    [],
  )

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
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

/**
 * タグに応じたStatusをリアクティブに取得するHook
 *
 * ## クエリ方式
 * belongingTags の multi-entry インデックスで該当タグの全件を取得し、
 * JS側で backendUrl フィルタとソートを行う。
 *
 * タグタイムラインは通常 home/local と比較して件数が少ないため、
 * この方式で十分なパフォーマンスが得られる想定。
 *
 * ## メディアフィルタ
 * onlyMedia オプションにより、メディア付き投稿のみに絞り込むことができる。
 * このフィルタはストレージ層ではなく表示層（この Hook）で行う。
 * データ保存時には全投稿を保存し、フィルタの切り替えに対応できるようにする。
 *
 * @deprecated useFilteredTagTimeline を使用してください
 */
export function useTagTimeline(
  tag: string,
  options?: { onlyMedia?: boolean },
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const onlyMedia = options?.onlyMedia ?? false

  const backendUrls = useMemo(() => apps.map((app) => app.backendUrl), [apps])

  const statuses = useLiveQuery(
    async () => {
      if (backendUrls.length === 0) return []

      let results = await db.statuses
        .where('belongingTags')
        .equals(tag)
        .filter((s) => backendUrls.includes(s.backendUrl))
        .toArray()

      // メディアフィルタ（表示層でのフィルタリング）
      if (onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      return results
        .sort((a, b) => b.created_at_ms - a.created_at_ms)
        .slice(0, MAX_LENGTH)
    },
    [backendUrls, tag, onlyMedia],
    [],
  )

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
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
