'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
  rowToStoredNotification,
  type SqliteStoredNotification,
} from 'util/db/sqlite/notificationStore'
import {
  assembleStatusFromBatch,
  executeBatchQueries,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_BASE_SELECT,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
  rewriteLegacyColumnsForPhase1,
} from 'util/queryBuilder'
import { useConfigRefresh } from 'util/timelineRefresh'

/**
 * backendUrl から appIndex を算出するヘルパー
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

function hasUnquotedQuestionMark(query: string): boolean {
  let inSingleQuote = false

  for (let i = 0; i < query.length; i++) {
    const char = query[i]

    if (char === "'") {
      if (inSingleQuote && query[i + 1] === "'") {
        i++
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (!inSingleQuote && char === '?') {
      return true
    }
  }

  return false
}

// ================================================================
// 互換サブクエリ: 旧カラム名をカスタム WHERE 句で使えるようにする
// ================================================================

// STATUS_COMPAT_FROM は施策 A により廃止。
// 旧カラム名の書き換えは queryBuilder.ts の rewriteLegacyColumnsForPhase1() で処理する。

/** notifications 互換サブクエリ FROM 句（旧カラム名を後方互換で提供、JOIN ベース） */
const NOTIF_COMPAT_FROM = `(
      SELECT n2.*,
        COALESCE(sv_nc.base_url, '') AS backend_url,
        COALESCE(nt_nc.code, '') AS notification_type,
        COALESCE(pr_nc.acct, '') AS account_acct
      FROM notifications n2
      LEFT JOIN servers sv_nc ON sv_nc.server_id = n2.server_id
      LEFT JOIN notification_types nt_nc ON nt_nc.notification_type_id = n2.notification_type_id
      LEFT JOIN profiles pr_nc ON pr_nc.profile_id = n2.actor_profile_id
    ) n`

// ================================================================
// 混合クエリ用の空サブクエリ定数
// ================================================================

/**
 * ダミー JOIN 用の空サブクエリ定数
 *
 * 混合クエリで対向テーブルのカラムを NULL として提供するために使用する。
 * 実テーブルへの LEFT JOIN ... ON 0 = 1 はフルスキャンを引き起こすため、
 * 0行のサブクエリで代替することでスキャンを完全に回避する。
 */
const EMPTY_N = `(SELECT
      NULL AS notification_id, NULL AS server_id, NULL AS local_id,
      NULL AS notification_type_id, NULL AS actor_profile_id,
      NULL AS related_post_id, NULL AS created_at_ms,
      NULL AS stored_at, NULL AS is_read,
      NULL AS backend_url, NULL AS notification_type, NULL AS account_acct
    LIMIT 0)`

const EMPTY_S = `(SELECT
      NULL AS post_id, NULL AS object_uri, NULL AS origin_server_id,
      NULL AS author_profile_id, NULL AS created_at_ms, NULL AS stored_at,
      NULL AS visibility_id, NULL AS language, NULL AS content_html,
      NULL AS spoiler_text, NULL AS canonical_url, NULL AS has_media,
      NULL AS media_count, NULL AS is_reblog, NULL AS reblog_of_uri,
      NULL AS is_sensitive, NULL AS has_spoiler, NULL AS in_reply_to_id,
      NULL AS is_local_only, NULL AS edited_at,
      NULL AS origin_backend_url, NULL AS account_acct, NULL AS account_id,
      NULL AS visibility, NULL AS reblog_of_id,
      NULL AS favourites_count, NULL AS reblogs_count, NULL AS replies_count
    LIMIT 0)`

/** ptt 互換サブクエリ: timeline_items + timelines + channel_kinds → (post_id, timelineType) */
const PTT_COMPAT = `(SELECT ti2.post_id, ck2.code AS timelineType FROM timeline_items ti2 INNER JOIN timelines t2 ON t2.timeline_id = ti2.timeline_id INNER JOIN channel_kinds ck2 ON ck2.channel_kind_id = t2.channel_kind_id WHERE ti2.post_id IS NOT NULL)`

const EMPTY_PTT = `(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)`
const EMPTY_PBT = `(SELECT NULL AS post_id, NULL AS tag LIMIT 0)`
const EMPTY_PME = `(SELECT NULL AS post_id, NULL AS acct LIMIT 0)`
const EMPTY_PB = `(SELECT NULL AS post_id, NULL AS backendUrl, NULL AS local_id LIMIT 0)`
const EMPTY_PRB = `(SELECT NULL AS post_id, NULL AS original_uri, NULL AS reblogger_acct, NULL AS reblogged_at_ms LIMIT 0)`

/**
 * カスタム SQL WHERE 句でフィルタした Status / Notification を返す Hook
 *
 * config.customQuery が設定されている場合にのみ使用される。
 * LIMIT / OFFSET は自動設定され、ユーザーが指定した値は無視される。
 *
 * クエリが posts と notifications の両方のテーブルを参照する場合（混合クエリ）、
 * UNION ALL を使用して両テーブルから結果を取得し、created_at_ms でソートして返す。
 *
 * クエリ内で `n.` プレフィックスのみが使われている場合は notifications テーブルのみ、
 * それ以外の場合は posts テーブルのみを対象にクエリを実行する。
 *
 * ## v2 スキーマ対応
 *
 * - posts_mentions (pme) テーブルを LEFT JOIN に追加
 * - onlyMedia フィルタは SQL の has_media カラムで処理（JS 側フィルタ不要）
 * - カスタムクエリモードでは applyMuteFilter / applyInstanceBlock は適用しない
 *
 * @param config — タイムライン設定。`customQuery` が空のときは DB を叩かず空配列を返す
 * @returns
 * - `data`: Status と Notification の判別付き `StatusAddAppIndex | NotificationAddAppIndex` の配列
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link useTimelineData}
 */
export function useCustomQueryTimeline(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const [results, setResults] = useState<
    (
      | (SqliteStoredStatus & { _type: 'status' })
      | (SqliteStoredNotification & { _type: 'notification' })
    )[]
  >([])
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

  const customQuery = config.customQuery ?? ''
  const onlyMedia = config.onlyMedia
  const minMediaCount = config.minMediaCount

  const queryMode = useMemo(() => {
    if (isMixedQuery(customQuery)) return 'mixed' as const
    if (isNotificationQuery(customQuery)) return 'notification' as const
    return 'status' as const
  }, [customQuery])

  const fetchData = useCallback(async () => {
    void refreshToken
    if (!customQuery.trim()) {
      setResults([])
      return
    }

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()

      // サニタイズ: DML/DDL拒否, セミコロン除去, LIMIT/OFFSET除去
      const forbidden =
        /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
      if (forbidden.test(customQuery)) {
        console.error('Custom query contains forbidden SQL statements.')
        setResults([])
        return
      }
      // SQLコメントも拒否（後続の backendUrl 条件のコメントアウト防止）
      if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
        console.error('Custom query contains SQL comments.')
        setResults([])
        return
      }
      const sanitized = customQuery
        .replace(/;/g, '')
        .replace(/\bLIMIT\b\s+\d+/gi, '')
        .replace(/\bOFFSET\b\s+\d+/gi, '')
        .trim()

      if (!sanitized) {
        setResults([])
        return
      }

      // ? プレースホルダーのバインド競合を防止（文字列リテラル内は許可）
      if (hasUnquotedQuestionMark(sanitized)) {
        console.error('Custom query must not contain ? placeholders.')
        setResults([])
        return
      }

      if (queryMode === 'mixed') {
        // ============================
        // 混合クエリ: 2段階クエリ戦略
        // Phase1: 軽量な ID + created_at_ms のみ取得
        // Phase2: 取得した ID から詳細情報をフェッチ
        // ============================
        const refs = detectReferencedAliases(sanitized)
        // pb.backend_url → pb.backendUrl 書き換え
        const pbRewritten = sanitized.replace(
          /\bpb\.backend_url\b/g,
          'pb.backendUrl',
        )
        // 施策 A+B: 旧カラム名を正規化形式に書き換え、必要な互換 JOIN を導出
        const { rewrittenWhere, compatJoins } =
          rewriteLegacyColumnsForPhase1(pbRewritten)

        // --- Phase1: Status ID 取得（STATUS_BASE_JOINS を除外して軽量化） ---
        const statusPhase1JoinLines: string[] = []
        // 施策 A: 旧カラム参照に必要な互換 JOIN を追加
        statusPhase1JoinLines.push(...compatJoins)
        // pb は参照されている場合のみ JOIN（1:N のため GROUP BY が必要になる）
        if (refs.pb)
          statusPhase1JoinLines.push(
            'LEFT JOIN posts_backends pb ON p.post_id = pb.post_id',
          )
        // 1:N JOIN が存在する場合のみ GROUP BY が必要
        const statusHasMultiRowJoin =
          refs.pb || refs.ptt || refs.pbt || refs.pme || refs.prb || refs.pe
        if (refs.ptt)
          statusPhase1JoinLines.push(
            `LEFT JOIN ${PTT_COMPAT} ptt\n              ON p.post_id = ptt.post_id`,
          )
        if (refs.pbt)
          statusPhase1JoinLines.push(
            'LEFT JOIN posts_belonging_tags pbt\n              ON p.post_id = pbt.post_id',
          )
        if (refs.pme)
          statusPhase1JoinLines.push(
            'LEFT JOIN posts_mentions pme\n              ON p.post_id = pme.post_id',
          )
        if (refs.prb)
          statusPhase1JoinLines.push(
            'LEFT JOIN posts_reblogs prb\n              ON p.post_id = prb.post_id',
          )
        if (refs.pe)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_engagements pe\n              ON p.post_id = pe.post_id',
          )
        statusPhase1JoinLines.push(`LEFT JOIN ${EMPTY_N} n ON 1 = 1`)

        const statusPhase1Joins = `\n            ${statusPhase1JoinLines.join('\n            ')}`

        let statusMediaConditions = ''
        const statusMediaBinds: (string | number)[] = []
        if (minMediaCount != null && minMediaCount > 0) {
          statusMediaConditions += '\n              AND p.media_count >= ?'
          statusMediaBinds.push(minMediaCount)
        } else if (onlyMedia) {
          statusMediaConditions += '\n              AND p.has_media = 1'
        }

        // 施策 A: サブクエリ廃止 → FROM posts p 直接参照
        // 1:N JOIN がなければ GROUP BY 不要 → idx_posts_created で ORDER BY + LIMIT early termination が効く
        const statusGroupBy = statusHasMultiRowJoin
          ? '\n          GROUP BY p.post_id'
          : ''
        const statusPhase1Sql = `
          SELECT p.post_id, p.created_at_ms
          FROM posts p${statusPhase1Joins}
          WHERE (${rewrittenWhere})${statusMediaConditions}${statusGroupBy}
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `

        // --- Phase1: Notification ID 取得 ---
        const notifDummyJoins = [
          `LEFT JOIN ${EMPTY_S} p ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PTT} ptt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PBT} pbt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PME} pme ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PB} pb ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PRB} prb ON 1 = 1`,
        ].join('\n            ')

        const rewrittenNotifWhere = sanitized

        const notifPhase1Sql = `
          SELECT n.notification_id, n.created_at_ms
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
            ${notifDummyJoins}
          WHERE (${rewrittenNotifWhere})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        // Phase1 実行
        const { result: statusIdRowsRaw, durationMs: statusPhase1Dur } =
          await handle.execAsyncTimed(statusPhase1Sql, {
            bind: [...statusMediaBinds, queryLimit],
            kind: 'timeline',
            returnValue: 'resultRows',
          })
        const statusIdRows = statusIdRowsRaw as (string | number | null)[][]
        const { result: notifIdRowsRaw, durationMs: notifPhase1Dur } =
          await handle.execAsyncTimed(notifPhase1Sql, {
            bind: [queryLimit],
            kind: 'timeline',
            returnValue: 'resultRows',
          })
        const notifIdRows = notifIdRowsRaw as (string | number | null)[][]

        // Phase1 結果を統合・ソートして上位 queryLimit 件を選定
        const statusIds = statusIdRows.map((row) => ({
          created_at_ms: row[1] as number,
          id: row[0] as number,
          type: 'status' as const,
        }))
        const notifIds = notifIdRows.map((row) => ({
          created_at_ms: row[1] as number,
          id: row[0] as number,
          type: 'notification' as const,
        }))
        const merged = [...statusIds, ...notifIds]
          .sort((a, b) => b.created_at_ms - a.created_at_ms)
          .slice(0, queryLimit)

        const postIdsToFetch = merged
          .filter((m) => m.type === 'status')
          .map((m) => m.id)
        const notifIdsToFetch = merged
          .filter((m) => m.type === 'notification')
          .map((m) => m.id)

        // --- Phase2: 詳細情報取得 (バッチクエリ版) ---
        let statusResults: (SqliteStoredStatus & { _type: 'status' })[] = []
        let statusPhase2Dur = 0
        if (postIdsToFetch.length > 0) {
          const placeholders = postIdsToFetch.map(() => '?').join(',')
          const statusBaseSql = `
            SELECT ${STATUS_BASE_SELECT}
            FROM posts p
            ${STATUS_BASE_JOINS}
            WHERE p.post_id IN (${placeholders})
            GROUP BY p.post_id
            ORDER BY p.created_at_ms DESC;
          `
          const { result: statusBaseRowsRaw, durationMs: dur } =
            await handle.execAsyncTimed(statusBaseSql, {
              bind: postIdsToFetch,
              kind: 'timeline',
              returnValue: 'resultRows',
            })
          const statusBaseRows = statusBaseRowsRaw as (
            | string
            | number
            | null
          )[][]

          // リブログ元の post_id を収集
          const reblogPostIds: number[] = []
          for (const row of statusBaseRows) {
            const rbPostId = row[27] as number | null
            if (rbPostId !== null) reblogPostIds.push(rbPostId)
          }
          const allPostIds = [...new Set([...postIdsToFetch, ...reblogPostIds])]

          // 子テーブルバッチクエリを並列実行
          const maps = await executeBatchQueries(handle, allPostIds)

          statusPhase2Dur = dur
          statusResults = statusBaseRows.map((row) => ({
            ...assembleStatusFromBatch(row, maps),
            _type: 'status' as const,
          }))
        }

        let notifResults: (SqliteStoredNotification & {
          _type: 'notification'
        })[] = []
        let notifPhase2Dur = 0
        if (notifIdsToFetch.length > 0) {
          const placeholders = notifIdsToFetch.map(() => '?').join(',')
          const notifDetailSql = `
            SELECT ${NOTIFICATION_SELECT}
            FROM ${NOTIF_COMPAT_FROM}
            ${NOTIFICATION_BASE_JOINS}
            WHERE n.notification_id IN (${placeholders})
            ORDER BY n.created_at_ms DESC;
          `
          const { result: notifDetailRowsRaw, durationMs: dur } =
            await handle.execAsyncTimed(notifDetailSql, {
              bind: notifIdsToFetch,
              kind: 'timeline',
              returnValue: 'resultRows',
            })
          notifPhase2Dur = dur
          const notifDetailRows = notifDetailRowsRaw as (
            | string
            | number
            | null
          )[][]
          notifResults = notifDetailRows.map((row) => ({
            ...rowToStoredNotification(row),
            _type: 'notification' as const,
          }))
        }

        recordDuration(
          statusPhase1Dur + notifPhase1Dur + statusPhase2Dur + notifPhase2Dur,
        )

        const mixed = [...statusResults, ...notifResults]
          .sort((a, b) => b.created_at_ms - a.created_at_ms)
          .slice(0, queryLimit)

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(mixed)
      } else if (queryMode === 'notification') {
        // ============================
        // Notifications クエリ
        // ============================
        const binds: (string | number)[] = [queryLimit]

        const rewrittenNotifWhere = sanitized

        const sql = `
          SELECT ${NOTIFICATION_SELECT}
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
          WHERE (${rewrittenNotifWhere})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const { result: rowsRaw, durationMs } = await handle.execAsyncTimed(
          sql,
          {
            bind: binds,
            kind: 'timeline',
            returnValue: 'resultRows',
          },
        )
        const rows = rowsRaw as (string | number | null)[][]
        recordDuration(durationMs)

        const notifResults = rows.map((row) => ({
          ...rowToStoredNotification(row),
          _type: 'notification' as const,
        }))

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(notifResults)
      } else {
        // ============================
        // Statuses クエリ: 2段階クエリ戦略
        // ============================
        const refs = detectReferencedAliases(sanitized)
        // pb.backend_url → pb.backendUrl 書き換え
        const pbRewritten = sanitized.replace(
          /\bpb\.backend_url\b/g,
          'pb.backendUrl',
        )
        // 施策 A+B: 旧カラム名を正規化形式に書き換え、必要な互換 JOIN を導出
        const { rewrittenWhere, compatJoins } =
          rewriteLegacyColumnsForPhase1(pbRewritten)

        const joinLines: string[] = []
        // 施策 A: 旧カラム参照に必要な互換 JOIN を追加
        joinLines.push(...compatJoins)
        // pb は参照されている場合のみ JOIN（1:N のため DISTINCT が必要になる）
        if (refs.pb)
          joinLines.push(
            'LEFT JOIN posts_backends pb ON p.post_id = pb.post_id',
          )
        // 1:N JOIN が存在する場合のみ DISTINCT が必要
        const hasMultiRowJoin =
          refs.pb || refs.ptt || refs.pbt || refs.pme || refs.prb || refs.pe
        if (refs.ptt)
          joinLines.push(
            `LEFT JOIN ${PTT_COMPAT} ptt\n            ON p.post_id = ptt.post_id`,
          )
        if (refs.pbt)
          joinLines.push(
            'LEFT JOIN posts_belonging_tags pbt\n            ON p.post_id = pbt.post_id',
          )
        if (refs.pme)
          joinLines.push(
            'LEFT JOIN posts_mentions pme\n            ON p.post_id = pme.post_id',
          )
        if (refs.prb)
          joinLines.push(
            'LEFT JOIN posts_reblogs prb\n            ON p.post_id = prb.post_id',
          )
        if (refs.pe)
          joinLines.push(
            'LEFT JOIN post_engagements pe\n            ON p.post_id = pe.post_id',
          )

        const joinsClause = `\n          ${joinLines.join('\n          ')}`

        let additionalConditions = ''
        const additionalBinds: (string | number)[] = []

        if (minMediaCount != null && minMediaCount > 0) {
          additionalConditions += '\n          AND p.media_count >= ?'
          additionalBinds.push(minMediaCount)
        } else if (onlyMedia) {
          additionalConditions += '\n          AND p.has_media = 1'
        }

        // Phase1: 軽量な post_id のみ取得（施策 A: サブクエリ廃止）
        // 1:N JOIN がなければ DISTINCT 不要 → idx_posts_created で ORDER BY + LIMIT early termination が効く
        const selectClause = hasMultiRowJoin
          ? 'SELECT DISTINCT p.post_id'
          : 'SELECT p.post_id'
        const phase1Sql = `
          ${selectClause}
          FROM posts p${joinsClause}
          WHERE (${rewrittenWhere})${additionalConditions}
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        const phase1Binds: (string | number)[] = [
          ...additionalBinds,
          queryLimit,
        ]

        const { result: idRowsRaw, durationMs: phase1Duration } =
          await handle.execAsyncTimed(phase1Sql, {
            bind: phase1Binds,
            kind: 'timeline',
            returnValue: 'resultRows',
          })
        const idRows = idRowsRaw as (number | null)[][]

        const postIds = idRows.map((row) => row[0] as number)

        if (postIds.length === 0) {
          recordDuration(phase1Duration)
          if (fetchVersionRef.current !== version) return
          setResults([])
          return
        }

        // Phase2: 詳細情報取得 (バッチクエリ版)
        const placeholders = postIds.map(() => '?').join(',')
        const phase2BaseSql = `
          SELECT ${STATUS_BASE_SELECT}
          FROM posts p
          ${STATUS_BASE_JOINS}
          WHERE p.post_id IN (${placeholders})
          GROUP BY p.post_id
          ORDER BY p.created_at_ms DESC;
        `

        const { result: baseRowsRaw, durationMs: phase2Duration } =
          await handle.execAsyncTimed(phase2BaseSql, {
            bind: postIds,
            kind: 'timeline',
            returnValue: 'resultRows',
          })
        const baseRows = baseRowsRaw as (string | number | null)[][]

        // リブログ元の post_id を収集
        const reblogPostIds: number[] = []
        for (const row of baseRows) {
          const rbPostId = row[27] as number | null
          if (rbPostId !== null) reblogPostIds.push(rbPostId)
        }
        const allPostIds = [...new Set([...postIds, ...reblogPostIds])]

        // 子テーブルバッチクエリを並列実行
        const maps = await executeBatchQueries(handle, allPostIds)

        recordDuration(phase1Duration + phase2Duration)

        const statusResults = baseRows.map((row) => ({
          ...assembleStatusFromBatch(row, maps),
          _type: 'status' as const,
        }))

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(statusResults)
      }
    } catch (e) {
      console.error('useCustomQueryTimeline query error:', e)
    }
  }, [
    customQuery,
    onlyMedia,
    minMediaCount,
    queryMode,
    queryLimit,
    recordDuration,
    refreshToken,
  ])

  // 施策 C: subscribe コールバックのデバウンス (500ms)
  // connection.ts の 80ms デバウンスに加え、Hook レベルでも
  // ストリーミングバーストによる重複クエリ実行を抑制する
  const debouncedFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  useEffect(() => {
    fetchData() // 初回は即時実行

    // subscribe コールバック用のデバウンスラッパー
    const debouncedFetch = () => {
      if (debouncedFetchTimerRef.current != null) {
        clearTimeout(debouncedFetchTimerRef.current)
      }
      debouncedFetchTimerRef.current = setTimeout(() => {
        debouncedFetchTimerRef.current = null
        fetchData()
      }, 500)
    }

    // 監視するテーブルはクエリモードに応じて決定
    const unsubStatuses =
      queryMode !== 'notification'
        ? subscribe('posts', debouncedFetch)
        : undefined
    const unsubNotifications =
      queryMode !== 'status'
        ? subscribe('notifications', debouncedFetch)
        : undefined
    return () => {
      unsubStatuses?.()
      unsubNotifications?.()
      if (debouncedFetchTimerRef.current != null) {
        clearTimeout(debouncedFetchTimerRef.current)
        debouncedFetchTimerRef.current = null
      }
    }
  }, [fetchData, queryMode])

  const data = useMemo(
    () =>
      results
        .map((item) => ({
          ...item,
          appIndex: resolveAppIndex(item.backendUrl, apps),
        }))
        .filter((item) => item.appIndex !== -1),
    [results, apps],
  )

  return { data, loadMore, queryDuration }
}
