'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredNotification } from 'util/db/sqlite/notificationStore'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
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
// 混合クエリ用の空サブクエリ定数
// ================================================================

/**
 * ダミー JOIN 用の空サブクエリ定数
 *
 * 混合クエリ（UNION ALL）で対向テーブルのカラムを NULL として提供するために使用する。
 * 実テーブルへの LEFT JOIN ... ON 0 = 1 はフルスキャンを引き起こすため、
 * 0行のサブクエリで代替することでスキャンを完全に回避する。
 */
const EMPTY_N = `(SELECT
      NULL AS compositeKey, NULL AS backendUrl,
      NULL AS notification_type, NULL AS status_id,
      NULL AS account_acct, NULL AS created_at_ms,
      NULL AS storedAt, NULL AS json
    LIMIT 0)`

const EMPTY_S = `(SELECT
      NULL AS compositeKey, NULL AS backendUrl,
      NULL AS created_at_ms, NULL AS storedAt,
      NULL AS uri, NULL AS account_acct, NULL AS account_id,
      NULL AS visibility, NULL AS language,
      NULL AS has_media, NULL AS media_count,
      NULL AS is_reblog, NULL AS reblog_of_id, NULL AS reblog_of_uri,
      NULL AS is_sensitive, NULL AS has_spoiler,
      NULL AS in_reply_to_id,
      NULL AS favourites_count, NULL AS reblogs_count,
      NULL AS replies_count, NULL AS json
    LIMIT 0)`

const EMPTY_STT = `(SELECT NULL AS compositeKey, NULL AS timelineType LIMIT 0)`
const EMPTY_SBT = `(SELECT NULL AS compositeKey, NULL AS tag LIMIT 0)`
const EMPTY_SM = `(SELECT NULL AS compositeKey, NULL AS acct LIMIT 0)`
const EMPTY_SB = `(SELECT NULL AS compositeKey, NULL AS backendUrl, NULL AS local_id LIMIT 0)`

/**
 * カスタム SQL WHERE 句でフィルタした Status / Notification を返す Hook
 *
 * config.customQuery が設定されている場合にのみ使用される。
 * LIMIT / OFFSET は自動設定され、ユーザーが指定した値は無視される。
 *
 * クエリが statuses と notifications の両方のテーブルを参照する場合（混合クエリ）、
 * UNION ALL を使用して両テーブルから結果を取得し、created_at_ms でソートして返す。
 *
 * クエリ内で `n.` プレフィックスのみが使われている場合は notifications テーブルのみ、
 * それ以外の場合は statuses テーブルのみを対象にクエリを実行する。
 *
 * ## v2 スキーマ対応
 *
 * - statuses_mentions (sm) テーブルを LEFT JOIN に追加
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
        // 混合クエリ: statuses + notifications を UNION ALL で結合
        // ============================
        // 不要な JOIN を除外し、ダミー JOIN は空サブクエリで代替する
        // （実テーブルへの ON 0 = 1 はフルスキャンを引き起こすため）
        const refs = detectReferencedAliases(sanitized)

        // statuses サブクエリ: 参照されているテーブルのみ実 JOIN
        const statusJoinLines: string[] = []
        if (refs.stt)
          statusJoinLines.push(
            'LEFT JOIN statuses_timeline_types stt\n              ON s.compositeKey = stt.compositeKey',
          )
        if (refs.sbt)
          statusJoinLines.push(
            'LEFT JOIN statuses_belonging_tags sbt\n              ON s.compositeKey = sbt.compositeKey',
          )
        if (refs.sm)
          statusJoinLines.push(
            'LEFT JOIN statuses_mentions sm\n              ON s.compositeKey = sm.compositeKey',
          )
        if (refs.sb)
          statusJoinLines.push(
            'LEFT JOIN statuses_backends sb\n              ON s.compositeKey = sb.compositeKey',
          )
        // n.* は空サブクエリでダミー提供（実テーブルスキャンを回避）
        statusJoinLines.push(`LEFT JOIN ${EMPTY_N} n ON 1 = 1`)

        const statusJoinsClause =
          statusJoinLines.length > 0
            ? `\n            ${statusJoinLines.join('\n            ')}`
            : ''

        const hasMultiRowJoin = refs.stt || refs.sbt || refs.sm || refs.sb
        const backendSelect = refs.sb ? 'MIN(sb.backendUrl)' : 's.backendUrl'
        const groupByClause = hasMultiRowJoin
          ? '\n            GROUP BY s.compositeKey'
          : ''

        // notifications サブクエリ: s.*/stt.*/sbt.*/sm.*/sb.* は空サブクエリで提供
        const notifDummyJoins = [
          `LEFT JOIN ${EMPTY_S} s ON 1 = 1`,
          `LEFT JOIN ${EMPTY_STT} stt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SBT} sbt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SM} sm ON 1 = 1`,
          `LEFT JOIN ${EMPTY_SB} sb ON 1 = 1`,
        ].join('\n            ')

        // statuses サブクエリ用のメディアフィルタ条件
        let statusMediaConditions = ''
        const statusMediaBinds: (string | number)[] = []
        if (minMediaCount != null && minMediaCount > 0) {
          statusMediaConditions += '\n              AND s.media_count >= ?'
          statusMediaBinds.push(minMediaCount)
        } else if (onlyMedia) {
          statusMediaConditions += '\n              AND s.has_media = 1'
        }

        const binds: (string | number)[] = [...statusMediaBinds, queryLimit]

        const sql = `
          SELECT compositeKey, backendUrl, created_at_ms, storedAt, json, _type
          FROM (
            SELECT s.compositeKey, ${backendSelect} AS backendUrl,
                   s.created_at_ms, s.storedAt, s.json,
                   'status' AS _type
            FROM statuses s${statusJoinsClause}
            WHERE (${sanitized})${statusMediaConditions}${groupByClause}
            UNION ALL
            SELECT n.compositeKey, n.backendUrl,
                   n.created_at_ms, n.storedAt, n.json,
                   'notification' AS _type
            FROM notifications n
            ${notifDummyJoins}
            WHERE (${sanitized})
          )
          ORDER BY created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.execAsync(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const mixed = rows.map((row) => {
          const type = row[5] as string
          if (type === 'notification') {
            const notification = JSON.parse(row[4] as string)
            return {
              ...notification,
              _type: 'notification' as const,
              backendUrl: row[1] as string,
              compositeKey: row[0] as string,
              created_at_ms: row[2] as number,
              storedAt: row[3] as number,
            }
          }
          const status = JSON.parse(row[4] as string)
          return {
            ...status,
            _type: 'status' as const,
            backendUrl: row[1] as string,
            belongingTags: [],
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
            timelineTypes: [],
          }
        })

        setResults(mixed)
      } else if (queryMode === 'notification') {
        // ============================
        // Notifications クエリ
        // ============================
        const binds: (string | number)[] = [queryLimit]

        const sql = `
          SELECT n.compositeKey, n.backendUrl,
                 n.created_at_ms, n.storedAt, n.json
          FROM notifications n
          WHERE (${sanitized})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.execAsync(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const notifResults = rows.map((row) => {
          const notification = JSON.parse(row[4] as string)
          return {
            ...notification,
            _type: 'notification' as const,
            backendUrl: row[1] as string,
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
          }
        })

        setResults(notifResults)
      } else {
        // ============================
        // Statuses クエリ
        // ============================
        // 参照されているテーブルのみ JOIN する（不要な JOIN を除外）
        const refs = detectReferencedAliases(sanitized)

        const joinLines: string[] = []
        if (refs.stt)
          joinLines.push(
            'LEFT JOIN statuses_timeline_types stt\n            ON s.compositeKey = stt.compositeKey',
          )
        if (refs.sbt)
          joinLines.push(
            'LEFT JOIN statuses_belonging_tags sbt\n            ON s.compositeKey = sbt.compositeKey',
          )
        if (refs.sm)
          joinLines.push(
            'LEFT JOIN statuses_mentions sm\n            ON s.compositeKey = sm.compositeKey',
          )
        if (refs.sb)
          joinLines.push(
            'LEFT JOIN statuses_backends sb\n            ON s.compositeKey = sb.compositeKey',
          )

        const hasMultiRowJoin = refs.stt || refs.sbt || refs.sm || refs.sb
        const backendSelect = refs.sb
          ? 'MIN(sb.backendUrl) AS backendUrl'
          : 's.backendUrl'
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
          SELECT s.compositeKey, ${backendSelect},
                 s.created_at_ms, s.storedAt, s.json
          FROM statuses s${joinsClause}
          WHERE (${sanitized})${additionalConditions}${hasMultiRowJoin ? '\n          GROUP BY s.compositeKey' : ''}
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.execAsync(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const statusResults = rows.map((row) => {
          const status = JSON.parse(row[4] as string)
          return {
            ...status,
            _type: 'status' as const,
            backendUrl: row[1] as string,
            belongingTags: [],
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
            timelineTypes: [],
          }
        })

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
      queryMode !== 'notification'
        ? subscribe('statuses', fetchData)
        : undefined
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
