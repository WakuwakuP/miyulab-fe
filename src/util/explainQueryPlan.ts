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
import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
} from 'util/db/sqlite/notificationStore'
import { STATUS_BASE_JOINS, STATUS_SELECT } from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
  upgradeQueryToV2,
} from 'util/queryBuilder'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

// ================================================================
// 互換サブクエリ: 旧カラム名をカスタム WHERE 句で使えるようにする
// ================================================================

// ================================================================
// 互換サブクエリ: 旧カラム名をカスタム WHERE 句で使えるようにする
// ================================================================

const STATUS_COMPAT_FROM = `(
      SELECT p.*,
        COALESCE(sv_c.base_url, '') AS origin_backend_url,
        COALESCE(pr_c.acct, '') AS account_acct,
        '' AS account_id,
        COALESCE(vt_c.name, 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE(ps_c.favourites_count, 0) AS favourites_count,
        COALESCE(ps_c.reblogs_count, 0) AS reblogs_count,
        COALESCE(ps_c.replies_count, 0) AS replies_count
      FROM posts p
      LEFT JOIN servers sv_c ON sv_c.id = p.origin_server_id
      LEFT JOIN profiles pr_c ON pr_c.id = p.author_profile_id
      LEFT JOIN visibility_types vt_c ON vt_c.id = p.visibility_id
      LEFT JOIN post_stats ps_c ON ps_c.post_id = p.id
    ) p`

const NOTIF_COMPAT_FROM = `(
      SELECT n2.*,
        COALESCE(la_nc.backend_url, '') AS backend_url,
        COALESCE(nt_nc.name, '') AS notification_type,
        COALESCE(pr_nc.acct, '') AS account_acct
      FROM notifications n2
      LEFT JOIN local_accounts la_nc ON la_nc.id = n2.local_account_id
      LEFT JOIN notification_types nt_nc ON nt_nc.id = n2.notification_type_id
      LEFT JOIN profiles pr_nc ON pr_nc.id = n2.actor_profile_id
    ) n`

// ================================================================
// 混合クエリ用の空サブクエリ定数（useCustomQueryTimeline と同一）
// ================================================================

const EMPTY_N = `(SELECT
      NULL AS id, NULL AS local_account_id, NULL AS local_id,
      NULL AS notification_type_id, NULL AS actor_profile_id,
      NULL AS related_post_id, NULL AS created_at_ms,
      NULL AS is_read, NULL AS reaction_name, NULL AS reaction_url,
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

const EMPTY_PTT = '(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)'
const EMPTY_PHT = '(SELECT NULL AS post_id, NULL AS hashtag_id LIMIT 0)'
const EMPTY_HT = '(SELECT NULL AS hashtag_id, NULL AS normalized_name LIMIT 0)'
const EMPTY_PME = '(SELECT NULL AS post_id, NULL AS acct LIMIT 0)'
const EMPTY_PB =
  '(SELECT NULL AS post_id, NULL AS backendUrl, NULL AS local_id LIMIT 0)'
const EMPTY_PRB =
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
      kind: 'other',
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
    'te.timeline_key = ?',
    `la.backend_url IN (${backendPlaceholders})`,
    ...filterConditions,
  ]

  const sql = `
    SELECT ${STATUS_SELECT}
    FROM posts p
    ${STATUS_BASE_JOINS}
    INNER JOIN timeline_entries te ON p.id = te.post_id
    LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
    LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
    WHERE ${whereConditions.join('\n      AND ')}
    GROUP BY p.id
    ORDER BY p.created_at_ms DESC
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
  const tagPlaceholders = tags.map(() => 'LOWER(?)').join(',')

  const binds: (string | number)[] = []

  if (tagMode === 'or') {
    const whereConditions = [
      `ht.name IN (${tagPlaceholders})`,
      `la.backend_url IN (${backendPlaceholders})`,
      ...filterConditions,
    ]

    const sql = `
      SELECT ${STATUS_SELECT}
      FROM posts p
      ${STATUS_BASE_JOINS}
      INNER JOIN post_hashtags pht
        ON p.id = pht.post_id
      INNER JOIN hashtags ht
        ON pht.hashtag_id = ht.id
      LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
      LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
      WHERE ${whereConditions.join('\n        AND ')}
      GROUP BY p.id
      ORDER BY p.created_at_ms DESC
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
    `ht.name IN (${tagPlaceholders})`,
    `la.backend_url IN (${backendPlaceholders})`,
    ...filterConditions,
  ]

  const sql = `
    SELECT ${STATUS_SELECT}
    FROM posts p
    ${STATUS_BASE_JOINS}
    INNER JOIN post_hashtags pht
      ON p.id = pht.post_id
    INNER JOIN hashtags ht
      ON pht.hashtag_id = ht.id
    LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
    LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
    WHERE ${whereConditions.join('\n        AND ')}
    GROUP BY p.id
    HAVING COUNT(DISTINCT ht.name) = ?
    ORDER BY p.created_at_ms DESC
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
  conditions.push(`la.backend_url IN (${placeholders})`)
  binds.push(...targetBackendUrls)

  const notificationFilter = config.notificationFilter
  if (notificationFilter != null && notificationFilter.length > 0) {
    const typePlaceholders = notificationFilter.map(() => '?').join(',')
    conditions.push(`nt.name IN (${typePlaceholders})`)
    binds.push(...notificationFilter)
  }

  const whereClause = conditions.join(' AND ')
  const sql = `
    SELECT ${NOTIFICATION_SELECT}
    FROM notifications n
    ${NOTIFICATION_BASE_JOINS}
    WHERE ${whereClause}
    ORDER BY n.created_at_ms DESC
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
  const sanitized = upgradeQueryToV2(
    customQuery
      .replace(/;/g, '')
      .replace(/\bLIMIT\b\s+\d+/gi, '')
      .replace(/\bOFFSET\b\s+\d+/gi, '')
      .trim(),
  )

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
  const rewrittenWhere = sanitized.replace(
    /\bpb\.backend_url\b/g,
    'pb.backendUrl',
  )

  const statusJoinLines: string[] = []
  if (refs.ptt)
    statusJoinLines.push(
      `LEFT JOIN (SELECT te2.post_id, te2.timeline_key AS timelineType FROM timeline_entries te2 WHERE te2.post_id IS NOT NULL) ptt\n              ON p.id = ptt.post_id`,
    )
  if (refs.pbt) {
    statusJoinLines.push(
      'LEFT JOIN post_hashtags pht\n              ON p.id = pht.post_id',
    )
    statusJoinLines.push(
      'LEFT JOIN hashtags ht\n              ON pht.hashtag_id = ht.id',
    )
  }
  if (refs.pme)
    statusJoinLines.push(
      'LEFT JOIN post_mentions pme\n              ON p.id = pme.post_id',
    )
  if (refs.prb)
    statusJoinLines.push(
      `LEFT JOIN (SELECT rb_src.id AS post_id, rb_tgt.object_uri AS original_uri, COALESCE((SELECT pr.acct FROM profiles pr WHERE pr.id = rb_src.author_profile_id), '') AS reblogger_acct, rb_src.created_at_ms AS reblogged_at_ms FROM posts rb_src INNER JOIN posts rb_tgt ON rb_src.reblog_of_post_id = rb_tgt.id WHERE rb_src.reblog_of_post_id IS NOT NULL) prb\n              ON p.id = prb.post_id`,
    )
  if (refs.pe)
    statusJoinLines.push(
      'LEFT JOIN post_interactions pe\n              ON p.id = pe.post_id',
    )
  statusJoinLines.push(`LEFT JOIN ${EMPTY_N} n ON 1 = 1`)

  const statusExtraJoins =
    statusJoinLines.length > 0
      ? `\n            ${statusJoinLines.join('\n            ')}`
      : ''

  const notifDummyJoins = [
    `LEFT JOIN ${EMPTY_S} p ON 1 = 1`,
    `LEFT JOIN ${EMPTY_PTT} ptt ON 1 = 1`,
    `LEFT JOIN ${EMPTY_PHT} pht ON 1 = 1`,
    `LEFT JOIN ${EMPTY_HT} ht ON 1 = 1`,
    `LEFT JOIN ${EMPTY_PME} pme ON 1 = 1`,
    `LEFT JOIN ${EMPTY_PB} pb ON 1 = 1`,
    `LEFT JOIN ${EMPTY_PRB} prb ON 1 = 1`,
  ].join('\n            ')

  let statusMediaConditions = ''
  const statusMediaBinds: (string | number)[] = []
  if (minMediaCount != null && minMediaCount > 0) {
    statusMediaConditions +=
      '\n              AND (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= ?'
    statusMediaBinds.push(minMediaCount)
  } else if (onlyMedia) {
    statusMediaConditions +=
      '\n              AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'
  }

  const binds: (string | number)[] = [...statusMediaBinds, TIMELINE_QUERY_LIMIT]

  const rewrittenNotifWhere = sanitized

  // EXPLAIN 用に status + notification の両クエリを UNION ALL で結合
  const sql = `
    SELECT post_id, created_at_ms
    FROM (
      SELECT p.id AS post_id, p.created_at_ms
      FROM ${STATUS_COMPAT_FROM}
      ${STATUS_BASE_JOINS}${statusExtraJoins}
      WHERE (${rewrittenWhere})${statusMediaConditions}
      GROUP BY p.id
      UNION ALL
      SELECT n.id AS notification_id, n.created_at_ms
      FROM ${NOTIF_COMPAT_FROM}
      ${NOTIFICATION_BASE_JOINS}
            ${notifDummyJoins}
      WHERE (${rewrittenNotifWhere})
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
    SELECT ${NOTIFICATION_SELECT}
    FROM ${NOTIF_COMPAT_FROM}
    ${NOTIFICATION_BASE_JOINS}
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
  const rewrittenWhere = sanitized.replace(
    /\bpb\.backend_url\b/g,
    'pb.backendUrl',
  )

  const joinLines: string[] = []
  if (refs.ptt)
    joinLines.push(
      `LEFT JOIN (SELECT te2.post_id, te2.timeline_key AS timelineType FROM timeline_entries te2 WHERE te2.post_id IS NOT NULL) ptt\n          ON p.id = ptt.post_id`,
    )
  if (refs.pbt) {
    joinLines.push(
      'LEFT JOIN post_hashtags pht\n          ON p.id = pht.post_id',
    )
    joinLines.push('LEFT JOIN hashtags ht\n          ON pht.hashtag_id = ht.id')
  }
  if (refs.pme)
    joinLines.push(
      'LEFT JOIN post_mentions pme\n          ON p.id = pme.post_id',
    )
  if (refs.prb)
    joinLines.push(
      `LEFT JOIN (SELECT rb_src.id AS post_id, rb_tgt.object_uri AS original_uri, COALESCE((SELECT pr.acct FROM profiles pr WHERE pr.id = rb_src.author_profile_id), '') AS reblogger_acct, rb_src.created_at_ms AS reblogged_at_ms FROM posts rb_src INNER JOIN posts rb_tgt ON rb_src.reblog_of_post_id = rb_tgt.id WHERE rb_src.reblog_of_post_id IS NOT NULL) prb\n          ON p.id = prb.post_id`,
    )
  if (refs.pe)
    joinLines.push(
      'LEFT JOIN post_interactions pe\n          ON p.id = pe.post_id',
    )

  const joinsClause =
    joinLines.length > 0 ? `\n      ${joinLines.join('\n      ')}` : ''

  let additionalConditions = ''
  const additionalBinds: (string | number)[] = []

  if (minMediaCount != null && minMediaCount > 0) {
    additionalConditions +=
      '\n      AND (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= ?'
    additionalBinds.push(minMediaCount)
  } else if (onlyMedia) {
    additionalConditions +=
      '\n      AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'
  }

  const binds: (string | number)[] = [...additionalBinds, TIMELINE_QUERY_LIMIT]

  const sql = `
    SELECT ${STATUS_SELECT}
    FROM ${STATUS_COMPAT_FROM}
    ${STATUS_BASE_JOINS}${joinsClause}
    WHERE (${rewrittenWhere})${additionalConditions}
    GROUP BY p.id
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `

  return { binds, sql }
}
