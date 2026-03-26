'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
  buildPhase2Template,
  buildScopedBatchTemplates,
  buildSpbFilter,
  PHASE2_BASE_TEMPLATE,
  type SqliteStoredStatus,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { useConfigRefresh } from 'util/timelineRefresh'

/** 安定した空配列参照（`?? []` による毎レンダー新規参照を防ぐ） */
const EMPTY_TAGS: string[] = []

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
 * SQL の IN 句で一括クエリし、post_id で DISTINCT する。
 *
 * ## AND 条件 (tagConfig.mode === 'and')
 * HAVING COUNT(DISTINCT tag) = タグ数 で全タグを含む Status のみ取得する。
 *
 * ## v2 スキーマ対応
 *
 * onlyMedia / visibilityFilter / languageFilter 等のフィルタは
 * 正規化カラムを使って SQL の WHERE 句で直接フィルタする。
 * これにより LIMIT の精度が向上し、JS 側フィルタが不要になる。
 *
 * @param config — タイムライン設定。`type !== 'tag'` のときは DB を叩かず空配列を返す
 * @returns
 * - `data`: `StatusAddAppIndex[]`（`appIndex` 解決不能行は除外）
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link buildFilterConditions}
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

  // 非同期クエリの競合状態を防止するためのバージョンカウンター
  const fetchVersionRef = useRef(0)

  // 設定保存時に確実に再取得をトリガーするためのリフレッシュトークン
  const refreshToken = useConfigRefresh(config.id)

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

  const tags = tagConfig?.tags ?? EMPTY_TAGS
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
        'p', // posts テーブルのエイリアス
        { profileJoined: true },
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
  const configType = config.type
  const customQuery = config.customQuery
  const sessionTag = `tag-${configId}`

  const fetchData = useCallback(async () => {
    void refreshToken
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

    const version = ++fetchVersionRef.current
    const { conditions: filterConditions, binds: filterBinds } = filterResult

    try {
      const handle = await getSqliteDb()

      // 前回の fetchData で積んだ未処理クエリは sendRequest の
      // インプレース置換で自動的にキャンセルされるため、
      // cancelStaleRequests の明示呼び出しは不要

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')
      const tagPlaceholders = tags.map(() => '?').join(',')

      // === 第1段階: post_id + backendUrl の取得（軽量クエリ） ===
      let phase1Sql: string
      const phase1Binds: (string | number)[] = []

      if (tagMode === 'or') {
        const whereConditions = [
          `ht.normalized_name IN (${tagPlaceholders})`,
          `sv.base_url IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        phase1Sql = `
          SELECT p.post_id, MIN(sv.base_url) AS backendUrl
          FROM posts p
          INNER JOIN posts_backends pb ON p.post_id = pb.post_id
          INNER JOIN servers sv ON pb.server_id = sv.server_id
          LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
          INNER JOIN post_hashtags pht ON p.post_id = pht.post_id
          INNER JOIN hashtags ht ON pht.hashtag_id = ht.hashtag_id
          WHERE ${whereConditions.join('\n            AND ')}
          GROUP BY p.post_id
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        phase1Binds.push(
          ...tags,
          ...targetBackendUrls,
          ...filterBinds,
          queryLimit,
        )
      } else {
        const whereConditions = [
          `ht.normalized_name IN (${tagPlaceholders})`,
          `sv.base_url IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        phase1Sql = `
          SELECT p.post_id, MIN(sv.base_url) AS backendUrl
          FROM posts p
          INNER JOIN posts_backends pb ON p.post_id = pb.post_id
          INNER JOIN servers sv ON pb.server_id = sv.server_id
          LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
          INNER JOIN post_hashtags pht ON p.post_id = pht.post_id
          INNER JOIN hashtags ht ON pht.hashtag_id = ht.hashtag_id
          WHERE ${whereConditions.join('\n            AND ')}
          GROUP BY p.post_id
          HAVING COUNT(DISTINCT ht.normalized_name) = ?
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        phase1Binds.push(
          ...tags,
          ...targetBackendUrls,
          ...filterBinds,
          tags.length,
          queryLimit,
        )
      }

      // === 一括取得: Phase1 → Phase2 → Batch×7 を Worker 内で実行 ===
      // spb をパネルのバックエンドに限定し、正しい local_id / account.id を返す
      const spbFilter = buildSpbFilter(targetBackendUrls)
      const phase2BaseSql = spbFilter
        ? buildPhase2Template(spbFilter)
        : PHASE2_BASE_TEMPLATE

      const result = await handle.fetchTimeline(
        {
          batchSqls: buildScopedBatchTemplates(targetBackendUrls),
          phase1: { bind: phase1Binds, sql: phase1Sql },
          phase2BaseSql,
        },
        sessionTag,
      )

      // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
      if (!result) return

      const idRows = result.phase1Rows

      const postIds = idRows.map((row) => row[0] as number)
      const backendUrlMap = new Map<number, string>()
      for (const row of idRows) {
        if (row[1] != null) {
          backendUrlMap.set(row[0] as number, row[1] as string)
        }
      }
      if (postIds.length === 0) {
        recordDuration(result.totalDurationMs)
        if (fetchVersionRef.current !== version) return
        setStatuses([])
        return
      }

      // バッチ結果を Map に変換
      const maps = buildBatchMapsFromResults(result.batchResults)

      recordDuration(result.totalDurationMs)

      const results: SqliteStoredStatus[] = result.phase2Rows.map((row) => {
        const status = assembleStatusFromBatch(row, maps)
        const postId = row[0] as number
        status.backendUrl = backendUrlMap.get(postId) ?? status.backendUrl
        return status
      })

      // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
      if (fetchVersionRef.current !== version) return
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
    filterResult,
    queryLimit,
    recordDuration,
    refreshToken,
    sessionTag,
  ])

  // ヒント付きリスナー: 該当する変更のときだけ fetchData を実行
  const handleChange = useCallback(
    (hints: ChangeHint[]) => {
      // ヒントが空 = ヒントなし通知（ユーザー操作等）→ 常に再取得
      if (hints.length === 0) {
        fetchData()
        return
      }
      // ヒントがある場合: 自パネルに関係する変更かチェック
      const isRelevant = hints.some((hint) => {
        if (hint.backendUrl && !targetBackendUrls.includes(hint.backendUrl))
          return false
        // tag ヒントがあれば自パネルの対象タグと照合
        if (hint.tag && !tags.includes(hint.tag)) return false
        return true
      })
      if (isRelevant) {
        fetchData()
      }
    },
    [fetchData, targetBackendUrls, tags],
  )

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('posts', handleChange)
  }, [fetchData, handleChange])

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
