/**
 * タイムライン設定に基づくクエリ構築ロジック
 *
 * 各 Hook (useFilteredTimeline, useFilteredTagTimeline, useNotifications,
 * useCustomQueryTimeline) のロジックを再現し、EXPLAIN QUERY PLAN 用の
 * SQL を生成する。
 */

import type { App, TimelineConfigV2 } from 'types/types'
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
import {
  EMPTY_HT,
  EMPTY_N,
  EMPTY_PB,
  EMPTY_PHT,
  EMPTY_PME,
  EMPTY_PRB,
  EMPTY_PTT,
  EMPTY_S,
  NOTIF_COMPAT_FROM,
  STATUS_COMPAT_FROM,
} from './constants'

export function buildTimelineQuery(
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

/**
 * useCustomQueryTimeline と同等のクエリを構築
 */
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

  // Status 側では nt.*/ap.* は存在しないため NULL に置換
  // （n.* は EMPTY_N ダミー JOIN で NULL 提供済み）
  const statusRewrittenWhere = rewrittenWhere.replace(
    /\b(nt|ap)\.\w+\b/g,
    'NULL',
  )

  const rewrittenNotifWhere = sanitized

  // EXPLAIN 用に status + notification の両クエリを UNION ALL で結合
  const sql = `
    SELECT post_id, created_at_ms
    FROM (
      SELECT p.id AS post_id, p.created_at_ms
      FROM ${STATUS_COMPAT_FROM}
      ${STATUS_BASE_JOINS}${statusExtraJoins}
      WHERE (${statusRewrittenWhere})${statusMediaConditions}
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
