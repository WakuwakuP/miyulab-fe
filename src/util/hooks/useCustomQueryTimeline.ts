'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
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
  rowToStoredStatus,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_SELECT,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
} from 'util/queryBuilder'

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

/** posts 互換サブクエリ FROM 句（旧カラム名を後方互換で提供） */
const STATUS_COMPAT_FROM = `(
      SELECT p.*,
        COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p.origin_server_id), '') AS origin_backend_url,
        COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p.author_profile_id), '') AS account_acct,
        '' AS account_id,
        COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p.visibility_id), 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS favourites_count,
        COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS reblogs_count,
        COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p.post_id), 0) AS replies_count
      FROM posts p
    ) s`

/** notifications 互換サブクエリ FROM 句（旧カラム名を後方互換で提供） */
const NOTIF_COMPAT_FROM = `(
      SELECT n2.*,
        COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = n2.server_id), '') AS backend_url,
        COALESCE((SELECT nt2.code FROM notification_types nt2 WHERE nt2.notification_type_id = n2.notification_type_id), '') AS notification_type,
        COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.profile_id = n2.actor_profile_id), '') AS account_acct
      FROM notifications n2
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

/** stt 互換サブクエリ: timeline_items + timelines + channel_kinds → (post_id, timelineType) */
const STT_COMPAT = `(SELECT ti2.post_id, ck2.code AS timelineType FROM timeline_items ti2 INNER JOIN timelines t2 ON t2.timeline_id = ti2.timeline_id INNER JOIN channel_kinds ck2 ON ck2.channel_kind_id = t2.channel_kind_id WHERE ti2.post_id IS NOT NULL)`

const EMPTY_STT = `(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)`
const EMPTY_SBT = `(SELECT NULL AS post_id, NULL AS tag LIMIT 0)`
const EMPTY_SM = `(SELECT NULL AS post_id, NULL AS acct LIMIT 0)`
const EMPTY_SB = `(SELECT NULL AS post_id, NULL AS backendUrl, NULL AS local_id LIMIT 0)`
const EMPTY_SR = `(SELECT NULL AS post_id, NULL AS original_uri, NULL AS reblogger_acct, NULL AS reblogged_at_ms LIMIT 0)`

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
 * - posts_mentions (sm) テーブルを LEFT JOIN に追加
 * - onlyMedia フィルタは SQL の has_media カラムで処理（JS 側フィルタ不要）
 * - カスタムクエリモードでは applyMuteFilter / applyInstanceBlock は適用しない
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
    if (!customQuery.trim()) {
      setResults([])
      return
    }

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
        // 混合クエリ: statuses + notifications を別々に取得して JS で統合
        // ============================
        const refs = detectReferencedAliases(sanitized)
        // sb. 参照を pb. に書き換え（STATUS_BASE_JOINS が pb を提供）
        const rewrittenWhere = sanitized
          .replace(/\bsb\./g, 'pb.')
          .replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

        // --- Status sub-query ---
        const statusJoinLines: string[] = []
        if (refs.stt)
          statusJoinLines.push(
            `LEFT JOIN ${STT_COMPAT} stt\n              ON s.post_id = stt.post_id`,
          )
        if (refs.sbt)
          statusJoinLines.push(
            'LEFT JOIN posts_belonging_tags sbt\n              ON s.post_id = sbt.post_id',
          )
        if (refs.sm)
          statusJoinLines.push(
            'LEFT JOIN posts_mentions sm\n              ON s.post_id = sm.post_id',
          )
        if (refs.sr)
          statusJoinLines.push(
            'LEFT JOIN posts_reblogs sr\n              ON s.post_id = sr.post_id',
          )
        if (refs.pe)
          statusJoinLines.push(
            'LEFT JOIN post_engagements pe\n              ON s.post_id = pe.post_id',
          )
        // n.* は空サブクエリでダミー提供（実テーブルスキャンを回避）
        statusJoinLines.push(`LEFT JOIN ${EMPTY_N} n ON 1 = 1`)

        const statusExtraJoins =
          statusJoinLines.length > 0
            ? `\n            ${statusJoinLines.join('\n            ')}`
            : ''

        let statusMediaConditions = ''
        const statusMediaBinds: (string | number)[] = []
        if (minMediaCount != null && minMediaCount > 0) {
          statusMediaConditions += '\n              AND s.media_count >= ?'
          statusMediaBinds.push(minMediaCount)
        } else if (onlyMedia) {
          statusMediaConditions += '\n              AND s.has_media = 1'
        }

        const statusSql = `
          SELECT ${STATUS_SELECT}
          FROM ${STATUS_COMPAT_FROM}
          ${STATUS_BASE_JOINS}${statusExtraJoins}
          WHERE (${rewrittenWhere})${statusMediaConditions}
          GROUP BY s.post_id
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `

        // --- Notification sub-query ---
        const notifDummyJoins = [
          `LEFT JOIN ${EMPTY_S} s ON 1 = 1`,
          `LEFT JOIN ${EMPTY_STT} stt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SBT} sbt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SM} sm ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SB} sb ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SR} sr ON 1 = 1`,
        ].join('\n            ')

        const notifSql = `
          SELECT ${NOTIFICATION_SELECT}
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
            ${notifDummyJoins}
          WHERE (${sanitized})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const statusRows = (await handle.execAsync(statusSql, {
          bind: [...statusMediaBinds, queryLimit],
          returnValue: 'resultRows',
        })) as (string | number | null)[][]
        const notifRows = (await handle.execAsync(notifSql, {
          bind: [queryLimit],
          returnValue: 'resultRows',
        })) as (string | number | null)[][]
        recordDuration(performance.now() - start)

        const statusResults = statusRows.map((row) => ({
          ...rowToStoredStatus(row),
          _type: 'status' as const,
        }))
        const notifResults = notifRows.map((row) => ({
          ...rowToStoredNotification(row),
          _type: 'notification' as const,
        }))

        const mixed = [...statusResults, ...notifResults]
          .sort((a, b) => b.created_at_ms - a.created_at_ms)
          .slice(0, queryLimit)

        setResults(mixed)
      } else if (queryMode === 'notification') {
        // ============================
        // Notifications クエリ
        // ============================
        const binds: (string | number)[] = [queryLimit]

        const sql = `
          SELECT ${NOTIFICATION_SELECT}
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
          WHERE (${sanitized})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.execAsync(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number | null)[][]
        recordDuration(performance.now() - start)

        const notifResults = rows.map((row) => ({
          ...rowToStoredNotification(row),
          _type: 'notification' as const,
        }))

        setResults(notifResults)
      } else {
        // ============================
        // Statuses クエリ
        // ============================
        // 参照されているテーブルのみ JOIN する（不要な JOIN を除外）
        const refs = detectReferencedAliases(sanitized)
        // sb. 参照を pb. に書き換え（STATUS_BASE_JOINS が pb を提供）
        const rewrittenWhere = sanitized
          .replace(/\bsb\./g, 'pb.')
          .replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

        const joinLines: string[] = []
        if (refs.stt)
          joinLines.push(
            `LEFT JOIN ${STT_COMPAT} stt\n            ON s.post_id = stt.post_id`,
          )
        if (refs.sbt)
          joinLines.push(
            'LEFT JOIN posts_belonging_tags sbt\n            ON s.post_id = sbt.post_id',
          )
        if (refs.sm)
          joinLines.push(
            'LEFT JOIN posts_mentions sm\n            ON s.post_id = sm.post_id',
          )
        if (refs.sr)
          joinLines.push(
            'LEFT JOIN posts_reblogs sr\n            ON s.post_id = sr.post_id',
          )
        if (refs.pe)
          joinLines.push(
            'LEFT JOIN post_engagements pe\n            ON s.post_id = pe.post_id',
          )

        const joinsClause =
          joinLines.length > 0
            ? `\n          ${joinLines.join('\n          ')}`
            : ''

        // onlyMedia フィルタを SQL 条件として追加
        let additionalConditions = ''
        const additionalBinds: (string | number)[] = []

        if (minMediaCount != null && minMediaCount > 0) {
          additionalConditions += '\n          AND s.media_count >= ?'
          additionalBinds.push(minMediaCount)
        } else if (onlyMedia) {
          additionalConditions += '\n          AND s.has_media = 1'
        }

        const binds: (string | number)[] = [...additionalBinds, queryLimit]

        // backendUrl フィルタはクエリ自体に含まれるため自動付与しない
        const sql = `
          SELECT ${STATUS_SELECT}
          FROM ${STATUS_COMPAT_FROM}
          ${STATUS_BASE_JOINS}${joinsClause}
          WHERE (${rewrittenWhere})${additionalConditions}
          GROUP BY s.post_id
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.execAsync(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number | null)[][]
        recordDuration(performance.now() - start)

        const statusResults = rows.map((row) => ({
          ...rowToStoredStatus(row),
          _type: 'status' as const,
        }))

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
  ])

  useEffect(() => {
    fetchData()
    // 監視するテーブルはクエリモードに応じて決定
    const unsubStatuses =
      queryMode !== 'notification' ? subscribe('posts', fetchData) : undefined
    const unsubNotifications =
      queryMode !== 'status' ? subscribe('notifications', fetchData) : undefined
    return () => {
      unsubStatuses?.()
      unsubNotifications?.()
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
