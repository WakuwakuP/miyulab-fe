'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
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
 * タグタイムライン用の統合 Hook (SQLite版)
 *
 * ## OR 条件 (tagConfig.mode === 'or')
 * SQL の IN 句で一括クエリし、compositeKey で DISTINCT する。
 *
 * ## AND 条件 (tagConfig.mode === 'and')
 * HAVING COUNT(DISTINCT tag) = タグ数 で全タグを含む Status のみ取得する。
 *
 * ## v2 スキーマ対応
 *
 * onlyMedia / visibilityFilter / languageFilter 等のフィルタは
 * 正規化カラムを使って SQL の WHERE 句で直接フィルタする。
 * これにより LIMIT の精度が向上し、JS 側フィルタが不要になる。
 */
export function useFilteredTagTimeline(config: TimelineConfigV2): {
  data: StatusAddAppIndex[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const tagConfig = config.tagConfig
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const { queryDuration, recordDuration } = useQueryDuration()

  const loadMore = useCallback(() => {
    setQueryLimit((prev) => prev + TIMELINE_QUERY_LIMIT)
  }, [])

  // config 変更時に queryLimit をリセット
  const configId = config.id
  useEffect(() => {
    // configId の変更を検知して初期値にリセット
    void configId
    setQueryLimit(TIMELINE_QUERY_LIMIT)
  }, [configId])

  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  const tags = tagConfig?.tags ?? []
  const tagMode = tagConfig?.mode ?? 'or'

  // フィルタ条件を事前計算（useMemo で安定化）
  const {
    onlyMedia,
    minMediaCount,
    visibilityFilter,
    languageFilter,
    excludeReblogs,
    excludeReplies,
    excludeSpoiler,
    excludeSensitive,
    accountFilter,
    applyMuteFilter,
    applyInstanceBlock,
  } = config

  const filterResult = useMemo(
    () =>
      buildFilterConditions(
        {
          accountFilter,
          applyInstanceBlock,
          applyMuteFilter,
          excludeReblogs,
          excludeReplies,
          excludeSensitive,
          excludeSpoiler,
          languageFilter,
          minMediaCount,
          onlyMedia,
          visibilityFilter,
        } as TimelineConfigV2,
        targetBackendUrls,
        '', // マテリアライズド・ビューのサブクエリ内ではテーブルエイリアス不要
      ),
    [
      onlyMedia,
      minMediaCount,
      visibilityFilter,
      languageFilter,
      excludeReblogs,
      excludeReplies,
      excludeSpoiler,
      excludeSensitive,
      accountFilter,
      applyMuteFilter,
      applyInstanceBlock,
      targetBackendUrls,
    ],
  )
  const filterConditions = filterResult.conditions
  const filterBinds = filterResult.binds

  const configType = config.type
  const customQuery = config.customQuery

  const fetchData = useCallback(async () => {
    // tag 以外の type の場合は早期に空配列を返し、不要な DB クエリを防ぐ
    // customQuery が設定されている場合も useCustomQueryTimeline に委譲するためスキップ
    if (configType !== 'tag' || customQuery?.trim()) {
      setStatuses([])
      return
    }
    if (targetBackendUrls.length === 0 || tags.length === 0) {
      setStatuses([])
      return
    }

    try {
      const handle = await getSqliteDb()

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')
      const tagPlaceholders = tags.map(() => '?').join(',')

      let sql: string
      const binds: (string | number)[] = []

      if (tagMode === 'or') {
        // OR: いずれかのタグを含む（tag_entries サブクエリで高速絞り込み）
        const whereConditions = [
          `tag IN (${tagPlaceholders})`,
          `backendUrl IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        sql = `
          SELECT s.compositeKey, tge.backendUrl,
                 s.created_at_ms, s.storedAt, s.json
          FROM (
            SELECT compositeKey, MIN(backendUrl) AS backendUrl
            FROM tag_entries
            WHERE ${whereConditions.join('\n              AND ')}
            GROUP BY compositeKey
            ORDER BY created_at_ms DESC
            LIMIT ?
          ) tge
          INNER JOIN statuses s ON s.compositeKey = tge.compositeKey;
        `
        binds.push(...tags, ...targetBackendUrls, ...filterBinds, queryLimit)
      } else {
        // AND: すべてのタグを含む（tag_entries サブクエリで高速絞り込み）
        const whereConditions = [
          `tag IN (${tagPlaceholders})`,
          `backendUrl IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        sql = `
          SELECT s.compositeKey, tge.backendUrl,
                 s.created_at_ms, s.storedAt, s.json
          FROM (
            SELECT compositeKey, MIN(backendUrl) AS backendUrl
            FROM tag_entries
            WHERE ${whereConditions.join('\n              AND ')}
            GROUP BY compositeKey
            HAVING COUNT(DISTINCT tag) = ?
            ORDER BY created_at_ms DESC
            LIMIT ?
          ) tge
          INNER JOIN statuses s ON s.compositeKey = tge.compositeKey;
        `
        binds.push(
          ...tags,
          ...targetBackendUrls,
          ...filterBinds,
          tags.length,
          queryLimit,
        )
      }

      const start = performance.now()
      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number)[][]
      recordDuration(performance.now() - start)

      const results: SqliteStoredStatus[] = rows.map((row) => {
        const status = JSON.parse(row[4] as string)
        return {
          ...status,
          backendUrl: row[1] as string,
          belongingTags: [],
          compositeKey: row[0] as string,
          created_at_ms: row[2] as number,
          storedAt: row[3] as number,
          timelineTypes: [],
        }
      })

      setStatuses(results)
    } catch (e) {
      console.error('useFilteredTagTimeline query error:', e)
    }
  }, [
    tagMode,
    configType,
    customQuery,
    targetBackendUrls,
    tags,
    filterConditions,
    filterBinds,
    queryLimit,
    recordDuration,
  ])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('statuses', fetchData)
  }, [fetchData])

  const data = useMemo(
    () =>
      statuses
        .map((s) => ({
          ...s,
          appIndex: resolveAppIndex(s.backendUrl, apps),
        }))
        .filter((s) => s.appIndex !== -1),
    [statuses, apps],
  )

  return { data, loadMore, queryDuration }
}
