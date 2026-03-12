/**
 * 個別タイムラインの EXPLAIN QUERY PLAN を実行するユーティリティ
 *
 * TimelineConfigV2 に基づいてタイムライン取得クエリと同等の SQL を構築し、
 * EXPLAIN QUERY PLAN を実行して結果をフォーマットされた文字列として返す。
 *
 * 対応するクエリパターン:
 * - home / local / public: useFilteredTimeline と同等
 * - tag: useFilteredTagTimeline と同等
 * - notification: useNotifications と同等
 * - customQuery 指定時: useCustomQueryTimeline と同等
 */

import type { App, TimelineConfigV2 } from 'types/types'
import { getSqliteDb } from 'util/db/sqlite/connection'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
} from 'util/queryBuilder'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

// ================================================================
// 混合クエリ用の空サブクエリ定数（useCustomQueryTimeline と同一）
// ================================================================

const EMPTY_N = `(SELECT
      NULL AS notification_id, NULL AS backend_url,
      NULL AS notification_type, NULL AS status_id,
      NULL AS account_acct, NULL AS created_at_ms,
      NULL AS stored_at, NULL AS json
    LIMIT 0)`

const EMPTY_S = `(SELECT
      NULL AS post_id, NULL AS origin_backend_url,
      NULL AS created_at_ms, NULL AS stored_at,
      NULL AS object_uri, NULL AS account_acct, NULL AS account_id,
      NULL AS visibility, NULL AS language,
      NULL AS has_media, NULL AS media_count,
      NULL AS is_reblog, NULL AS reblog_of_id, NULL AS reblog_of_uri,
      NULL AS is_sensitive, NULL AS has_spoiler,
      NULL AS in_reply_to_id,
      NULL AS favourites_count, NULL AS reblogs_count,
      NULL AS replies_count, NULL AS json
    LIMIT 0)`

const EMPTY_STT = '(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)'
const EMPTY_SBT = '(SELECT NULL AS post_id, NULL AS tag LIMIT 0)'
const EMPTY_SM = '(SELECT NULL AS post_id, NULL AS acct LIMIT 0)'
const EMPTY_SB =
  '(SELECT NULL AS post_id, NULL AS backend_url, NULL AS local_id LIMIT 0)'
const EMPTY_SR =
  '(SELECT NULL AS post_id, NULL AS original_uri, NULL AS reblogger_acct, NULL AS reblogged_at_ms LIMIT 0)'

/**
 * タイムライン設定に対する EXPLAIN QUERY PLAN を実行し、結果を文字列で返す
 *
 * @param config - タイムライン設定
 * @param apps - 登録済みアプリ一覧（backendUrl の解決に使用）
 * @returns フォーマットされた EXPLAIN QUERY PLAN の結果文字列
 */
export async function runExplainQueryPlan(
  config: TimelineConfigV2,
  apps: App[],
): Promise<string> {
  const { binds, sql } = buildTimelineQuery(config, apps)

  if (!sql) {
    return '(No query for this timeline configuration)'
  }

  try {
    const handle = await getSqliteDb()
    const explainSql = `EXPLAIN QUERY PLAN ${sql}`
    const rows = (await handle.execAsync(explainSql, {
      bind: binds,
      returnValue: 'resultRows',
    })) as unknown[][]

    const planLines = rows.map((row) => {
      const detail = row.length >= 4 ? row[3] : String(row)
      return `  ${detail}`
    })

    const formattedSql = formatSql(sql)
    const formattedBinds = JSON.stringify(binds, null, 2)

    return [
      '-- SQL',
      formattedSql,
      '',
      '-- Bind',
      formattedBinds,
      '',
      '-- EXPLAIN QUERY PLAN',
      ...planLines,
    ].join('\n')
  } catch (e) {
    return `EXPLAIN QUERY PLAN failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ================================================================
// SQL フォーマット
// ================================================================

/**
 * SQL 文字列を読みやすい形にフォーマットする
 *
 * テンプレートリテラルの余分なインデントを除去し、
 * 空行を取り除いて先頭インデント 2 スペースに統一する。
 */
function formatSql(sql: string): string {
  const lines = sql.split('\n')

  // 空行を除いた各行の先頭スペース数を取得し、最小値を共通インデントとする
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^(\s*)/)?.[1].length ?? 0)
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0

  return lines
    .map((l) => l.slice(minIndent))
    .filter((l) => l.trim().length > 0)
    .map((l) => `  ${l}`)
    .join('\n')
}

// ================================================================
// クエリ構築（各 Hook のロジックを再現）
// ================================================================

function buildTimelineQuery(
  config: TimelineConfigV2,
  apps: App[],
): { sql: string; binds: (string | number)[] } {
  // customQuery が指定されている場合はカスタムクエリモード
  if (config.customQuery?.trim()) {
    return buildCustomQuery(config)
  }

  switch (config.type) {
    case 'home':
    case 'local':
    case 'public':
      return buildFilteredTimelineQuery(config, apps)
    case 'tag':
      return buildTagTimelineQuery(config, apps)
    case 'notification':
      return buildNotificationQuery(config, apps)
    default:
      return { binds: [], sql: '' }
  }
}

/**
 * useFilteredTimeline と同等のクエリを構築
 */
function buildFilteredTimelineQuery(
  config: TimelineConfigV2,
  apps: App[],
): { sql: string; binds: (string | number)[] } {
  const filter = normalizeBackendFilter(config.backendFilter, apps)
  const targetBackendUrls = resolveBackendUrls(filter, apps)

  if (targetBackendUrls.length === 0) {
    return { binds: [], sql: '' }
  }

  const { binds: filterBinds, conditions: filterConditions } =
    buildFilterConditions(config, targetBackendUrls)

  const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')

  const whereConditions = [
    'stt.timelineType = ?',
    `sb.backend_url IN (${backendPlaceholders})`,
    ...filterConditions,
  ]

  const sql = `
    SELECT s.post_id, MIN(sb.backend_url) AS backendUrl,
           s.created_at_ms, s.stored_at, s.json
    FROM posts s
    INNER JOIN posts_timeline_types stt
      ON s.post_id = stt.post_id
    INNER JOIN posts_backends sb
      ON s.post_id = sb.post_id
    WHERE ${whereConditions.join('\n      AND ')}
    GROUP BY s.post_id
    ORDER BY s.created_at_ms DESC
    LIMIT ?;
  `
  const binds: (string | number)[] = [
    config.type,
    ...targetBackendUrls,
    ...filterBinds,
    TIMELINE_QUERY_LIMIT,
  ]

  return { binds, sql }
}

/**
 * useFilteredTagTimeline と同等のクエリを構築
 */
function buildTagTimelineQuery(
  config: TimelineConfigV2,
  apps: App[],
): { sql: string; binds: (string | number)[] } {
  const filter = normalizeBackendFilter(config.backendFilter, apps)
  const targetBackendUrls = resolveBackendUrls(filter, apps)
  const tags = config.tagConfig?.tags ?? []
  const tagMode = config.tagConfig?.mode ?? 'or'

  if (targetBackendUrls.length === 0 || tags.length === 0) {
    return { binds: [], sql: '' }
  }

  const { binds: filterBinds, conditions: filterConditions } =
    buildFilterConditions(config, targetBackendUrls)

  const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')
  const tagPlaceholders = tags.map(() => '?').join(',')

  const binds: (string | number)[] = []

  if (tagMode === 'or') {
    const whereConditions = [
      `sbt.tag IN (${tagPlaceholders})`,
      `sb.backend_url IN (${backendPlaceholders})`,
      ...filterConditions,
    ]

    const sql = `
      SELECT s.post_id, MIN(sb.backend_url) AS backendUrl,
             s.created_at_ms, s.stored_at, s.json
      FROM posts s
      INNER JOIN posts_belonging_tags sbt
        ON s.post_id = sbt.post_id
      INNER JOIN posts_backends sb
        ON s.post_id = sb.post_id
      WHERE ${whereConditions.join('\n        AND ')}
      GROUP BY s.post_id
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(
      ...tags,
      ...targetBackendUrls,
      ...filterBinds,
      TIMELINE_QUERY_LIMIT,
    )
    return { binds, sql }
  }

  // AND mode
  const whereConditions = [
    `sbt.tag IN (${tagPlaceholders})`,
    `sb.backend_url IN (${backendPlaceholders})`,
    ...filterConditions,
  ]

  const sql = `
    SELECT s.post_id, MIN(sb.backend_url) AS backendUrl,
           s.created_at_ms, s.stored_at, s.json
    FROM posts s
    INNER JOIN posts_belonging_tags sbt
      ON s.post_id = sbt.post_id
    INNER JOIN posts_backends sb
      ON s.post_id = sb.post_id
    WHERE ${whereConditions.join('\n        AND ')}
    GROUP BY s.post_id
    HAVING COUNT(DISTINCT sbt.tag) = ?
    ORDER BY s.created_at_ms DESC
    LIMIT ?;
  `
  binds.push(
    ...tags,
    ...targetBackendUrls,
    ...filterBinds,
    tags.length,
    TIMELINE_QUERY_LIMIT,
  )
  return { binds, sql }
}

/**
 * useNotifications と同等のクエリを構築
 */
function buildNotificationQuery(
  config: TimelineConfigV2,
  apps: App[],
): { sql: string; binds: (string | number)[] } {
  const filter = normalizeBackendFilter(config.backendFilter, apps)
  const targetBackendUrls = resolveBackendUrls(filter, apps)

  if (targetBackendUrls.length === 0) {
    return { binds: [], sql: '' }
  }

  const conditions: string[] = []
  const binds: (string | number)[] = []

  const placeholders = targetBackendUrls.map(() => '?').join(',')
  conditions.push(`backend_url IN (${placeholders})`)
  binds.push(...targetBackendUrls)

  const notificationFilter = config.notificationFilter
  if (notificationFilter != null && notificationFilter.length > 0) {
    const typePlaceholders = notificationFilter.map(() => '?').join(',')
    conditions.push(`notification_type IN (${typePlaceholders})`)
    binds.push(...notificationFilter)
  }

  const whereClause = conditions.join(' AND ')
  const sql = `
    SELECT notification_id, backend_url, created_at_ms, stored_at, json
    FROM notifications
    WHERE ${whereClause}
    ORDER BY created_at_ms DESC
    LIMIT ?;
  `
  binds.push(TIMELINE_QUERY_LIMIT)

  return { binds, sql }
}

/**
 * useCustomQueryTimeline と同等のクエリを構築
 */
/**
 * 文字列リテラル外の `?` プレースホルダーを検出する
 * （useCustomQueryTimeline の hasUnquotedQuestionMark と同一ロジック）
 */
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

function buildCustomQuery(config: TimelineConfigV2): {
  sql: string
  binds: (string | number)[]
} {
  const customQuery = config.customQuery ?? ''
  const onlyMedia = config.onlyMedia
  const minMediaCount = config.minMediaCount

  // サニタイズ
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(customQuery)) {
    return { binds: [], sql: '' }
  }
  if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
    return { binds: [], sql: '' }
  }
  const sanitized = customQuery
    .replace(/;/g, '')
    .replace(/\bLIMIT\b\s+\d+/gi, '')
    .replace(/\bOFFSET\b\s+\d+/gi, '')
    .trim()

  if (!sanitized) {
    return { binds: [], sql: '' }
  }

  // ? プレースホルダーのバインド競合を防止（文字列リテラル内は許可）
  if (hasUnquotedQuestionMark(sanitized)) {
    return { binds: [], sql: '' }
  }

  if (isMixedQuery(sanitized)) {
    return buildCustomMixedQuery(sanitized, onlyMedia, minMediaCount)
  }
  if (isNotificationQuery(sanitized)) {
    return buildCustomNotificationQuery(sanitized)
  }
  return buildCustomStatusQuery(sanitized, onlyMedia, minMediaCount)
}

function buildCustomMixedQuery(
  sanitized: string,
  onlyMedia: boolean | undefined,
  minMediaCount: number | undefined,
): { sql: string; binds: (string | number)[] } {
  const refs = detectReferencedAliases(sanitized)

  const statusJoinLines: string[] = []
  if (refs.stt)
    statusJoinLines.push(
      'LEFT JOIN posts_timeline_types stt\n              ON s.post_id = stt.post_id',
    )
  if (refs.sbt)
    statusJoinLines.push(
      'LEFT JOIN posts_belonging_tags sbt\n              ON s.post_id = sbt.post_id',
    )
  if (refs.sm)
    statusJoinLines.push(
      'LEFT JOIN posts_mentions sm\n              ON s.post_id = sm.post_id',
    )
  if (refs.sb)
    statusJoinLines.push(
      'LEFT JOIN posts_backends sb\n              ON s.post_id = sb.post_id',
    )
  if (refs.sr)
    statusJoinLines.push(
      'LEFT JOIN posts_reblogs sr\n              ON s.post_id = sr.post_id',
    )
  statusJoinLines.push(`LEFT JOIN ${EMPTY_N} n ON 1 = 1`)

  const statusJoinsClause =
    statusJoinLines.length > 0
      ? `\n            ${statusJoinLines.join('\n            ')}`
      : ''

  const hasMultiRowJoin = refs.stt || refs.sbt || refs.sm || refs.sb
  const backendSelect = refs.sb ? 'MIN(sb.backend_url)' : 's.origin_backend_url'
  const groupByClause = hasMultiRowJoin
    ? '\n            GROUP BY s.post_id'
    : ''

  const notifDummyJoins = [
    `LEFT JOIN ${EMPTY_S} s ON 1 = 1`,
    `LEFT JOIN ${EMPTY_STT} stt ON 1 = 1`,
    `LEFT JOIN ${EMPTY_SBT} sbt ON 1 = 1`,
    `LEFT JOIN ${EMPTY_SM} sm ON 1 = 1`,
    `LEFT JOIN ${EMPTY_SB} sb ON 1 = 1`,
    `LEFT JOIN ${EMPTY_SR} sr ON 1 = 1`,
  ].join('\n            ')

  let statusMediaConditions = ''
  const statusMediaBinds: (string | number)[] = []
  if (minMediaCount != null && minMediaCount > 0) {
    statusMediaConditions += '\n              AND s.media_count >= ?'
    statusMediaBinds.push(minMediaCount)
  } else if (onlyMedia) {
    statusMediaConditions += '\n              AND s.has_media = 1'
  }

  const binds: (string | number)[] = [...statusMediaBinds, TIMELINE_QUERY_LIMIT]

  const sql = `
    SELECT post_id, backendUrl, created_at_ms, stored_at, json, _type
    FROM (
      SELECT s.post_id, ${backendSelect} AS backendUrl,
             s.created_at_ms, s.stored_at, s.json,
             'status' AS _type
      FROM posts s${statusJoinsClause}
      WHERE (${sanitized})${statusMediaConditions}${groupByClause}
      UNION ALL
      SELECT n.notification_id, n.backend_url,
             n.created_at_ms, n.stored_at, n.json,
             'notification' AS _type
      FROM notifications n
      ${notifDummyJoins}
      WHERE (${sanitized})
    )
    ORDER BY created_at_ms DESC
    LIMIT ?;
  `

  return { binds, sql }
}

function buildCustomNotificationQuery(sanitized: string): {
  sql: string
  binds: (string | number)[]
} {
  const binds: (string | number)[] = [TIMELINE_QUERY_LIMIT]
  const sql = `
    SELECT n.notification_id, n.backend_url,
           n.created_at_ms, n.stored_at, n.json
    FROM notifications n
    WHERE (${sanitized})
    ORDER BY n.created_at_ms DESC
    LIMIT ?;
  `
  return { binds, sql }
}

function buildCustomStatusQuery(
  sanitized: string,
  onlyMedia: boolean | undefined,
  minMediaCount: number | undefined,
): { sql: string; binds: (string | number)[] } {
  const refs = detectReferencedAliases(sanitized)

  const joinLines: string[] = []
  if (refs.stt)
    joinLines.push(
      'LEFT JOIN posts_timeline_types stt\n          ON s.post_id = stt.post_id',
    )
  if (refs.sbt)
    joinLines.push(
      'LEFT JOIN posts_belonging_tags sbt\n          ON s.post_id = sbt.post_id',
    )
  if (refs.sm)
    joinLines.push(
      'LEFT JOIN posts_mentions sm\n          ON s.post_id = sm.post_id',
    )
  if (refs.sb)
    joinLines.push(
      'LEFT JOIN posts_backends sb\n          ON s.post_id = sb.post_id',
    )
  if (refs.sr)
    joinLines.push(
      'LEFT JOIN posts_reblogs sr\n          ON s.post_id = sr.post_id',
    )

  const hasMultiRowJoin = refs.stt || refs.sbt || refs.sm || refs.sb
  const backendSelect = refs.sb
    ? 'MIN(sb.backend_url) AS backendUrl'
    : 's.origin_backend_url'
  const joinsClause =
    joinLines.length > 0 ? `\n      ${joinLines.join('\n      ')}` : ''

  let additionalConditions = ''
  const additionalBinds: (string | number)[] = []

  if (minMediaCount != null && minMediaCount > 0) {
    additionalConditions += '\n      AND s.media_count >= ?'
    additionalBinds.push(minMediaCount)
  } else if (onlyMedia) {
    additionalConditions += '\n      AND s.has_media = 1'
  }

  const binds: (string | number)[] = [...additionalBinds, TIMELINE_QUERY_LIMIT]

  const sql = `
    SELECT s.post_id, ${backendSelect},
           s.created_at_ms, s.stored_at, s.json
    FROM posts s${joinsClause}
    WHERE (${sanitized})${additionalConditions}${hasMultiRowJoin ? '\n      GROUP BY s.post_id' : ''}
    ORDER BY s.created_at_ms DESC
    LIMIT ?;
  `

  return { binds, sql }
}
