/**
 * Status ストア — 読み取りファサード関数
 *
 * タイムライン種別・タグ・ブックマーク・カスタムクエリによる
 * Status 取得と、補完用のカラム値取得を提供する。
 */

import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
  upgradeQueryToV2,
} from 'util/queryBuilder'
import { getSqliteDb } from '../connection'
import {
  ALIAS_TO_TABLE,
  ALLOWED_COLUMN_VALUES,
  COLUMN_TABLE_OVERRIDE,
  sanitizeWhereClause,
} from '../queries/statusCustomQuery'
import { fetchStatusesByIds } from '../queries/statusFetch'
import type { SqliteStoredStatus, TimelineType } from '../queries/statusMapper'
import { MAX_QUERY_LIMIT } from '../queries/statusSelect'

/**
 * posts_reblogs 互換サブクエリ:
 * posts.reblog_of_post_id FK を利用して旧 prb エイリアスのカラムを再現する。
 */
const PRB_COMPAT_SUBQUERY =
  '(SELECT rb_src.id AS post_id, rb_tgt.object_uri AS original_uri, ' +
  "COALESCE((SELECT pr.acct FROM profiles pr WHERE pr.id = rb_src.author_profile_id), '') AS reblogger_acct, " +
  'rb_src.created_at_ms AS reblogged_at_ms ' +
  'FROM posts rb_src ' +
  'INNER JOIN posts rb_tgt ON rb_src.reblog_of_post_id = rb_tgt.id ' +
  'WHERE rb_src.reblog_of_post_id IS NOT NULL)'

// ================================================================
// タイムライン・タグ・ブックマーク取得
// ================================================================

/**
 * タイムライン種類で Status を取得
 */
export async function getStatusesByTimelineType(
  timelineType: TimelineType,
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.server_id IN (SELECT sv.id FROM servers sv WHERE sv.base_url IN (${placeholders}))`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id + timelineTypes の取得
  const phase1Sql = `
    SELECT p.id, json_group_array(DISTINCT te.timeline_key) AS timelineTypes
    FROM posts p
    INNER JOIN post_backend_ids pb ON p.id = pb.post_id
    INNER JOIN timeline_entries te ON p.id = te.post_id
    WHERE te.timeline_key = ?
      ${backendFilter}
    GROUP BY p.id
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(timelineType, limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)
  const timelineTypesMap = new Map<number, string>()
  for (const row of idRows) {
    if (row[1] != null) {
      timelineTypesMap.set(row[0] as number, row[1] as string)
    }
  }

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds, timelineTypesMap)
}

/**
 * タグで Status を取得
 */
export async function getStatusesByTag(
  tag: string,
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.server_id IN (SELECT sv.id FROM servers sv WHERE sv.base_url IN (${placeholders}))`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id の取得
  const phase1Sql = `
    SELECT DISTINCT p.id
    FROM posts p
    INNER JOIN post_backend_ids pb ON p.id = pb.post_id
    INNER JOIN post_hashtags pht ON p.id = pht.post_id
    INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
    WHERE ht.name = LOWER(?)
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(tag, limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

/**
 * ブックマークした Status を取得
 */
export async function getBookmarkedStatuses(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const phase1Binds: (string | number)[] = []
  let backendFilter = ''
  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.server_id IN (SELECT sv.id FROM servers sv WHERE sv.base_url IN (${placeholders}))`
    phase1Binds.push(...backendUrls)
  }

  // 第1段階: post_id の取得
  const phase1Sql = `
    SELECT DISTINCT p.id
    FROM posts p
    INNER JOIN post_backend_ids pb ON p.id = pb.post_id
    INNER JOIN post_interactions pi ON p.id = pi.post_id
    WHERE pi.is_bookmarked = 1
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?;
  `
  phase1Binds.push(limit ?? MAX_QUERY_LIMIT)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

// ================================================================
// カスタムクエリ
// ================================================================

/**
 * カスタム WHERE 句で Status を取得（advanced query 用）
 *
 * limit / offset はクエリ文字列を無視して自動設定する。
 * WHERE 句は posts_timeline_types (ptt), hashtags (pbt),
 * posts (p) テーブルを参照できる。
 *
 * ※ この関数はクライアントサイド SQLite DB に対してのみ実行される。
 *   DB にはユーザー自身のデータのみが格納されており、
 *   第三者からの入力は含まれない。
 */
export async function getStatusesByCustomQuery(
  whereClause: string,
  backendUrls?: string[],
  limit?: number,
  offset?: number,
): Promise<SqliteStoredStatus[]> {
  const handle = await getSqliteDb()

  const sanitized = sanitizeWhereClause(whereClause)

  // WHERE 句で参照されているテーブルのみ JOIN する（不要な JOIN を除外）
  const refs = detectReferencedAliases(sanitized)

  // 旧スキーマのカラム名・テーブル名を v2 に変換
  const rewrittenWhere = upgradeQueryToV2(sanitized)

  const joinLines: string[] = []
  if (refs.ptt)
    joinLines.push(
      'LEFT JOIN timeline_entries ptt\n      ON p.id = ptt.post_id',
    )
  if (refs.pbt)
    joinLines.push(
      'LEFT JOIN post_hashtags pht ON p.id = pht.post_id\n      LEFT JOIN hashtags ht ON pht.hashtag_id = ht.id',
    )
  if (refs.pme)
    joinLines.push('LEFT JOIN post_mentions pme\n      ON p.id = pme.post_id')
  if (refs.prb)
    joinLines.push(
      `LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb\n      ON p.id = prb.post_id`,
    )
  if (refs.pe)
    joinLines.push('LEFT JOIN post_interactions pe\n      ON p.id = pe.post_id')

  let backendFilter = ''
  const phase1Binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND pb.server_id IN (SELECT sv.id FROM servers sv WHERE sv.base_url IN (${placeholders}))`
    phase1Binds.push(...backendUrls)
  }

  const joinsClause =
    joinLines.length > 0 ? `\n    ${joinLines.join('\n    ')}` : ''

  // 第1段階: post_id の取得（旧カラム名の後方互換性のため posts をサブクエリでラップ）
  const phase1Sql = `
    SELECT DISTINCT p.id AS post_id
    FROM (
      SELECT p_inner.*,
        COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.id = p_inner.origin_server_id), '') AS origin_backend_url,
        COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.id = p_inner.author_profile_id), '') AS account_acct,
        '' AS account_id,
        COALESCE((SELECT vt2.name FROM visibility_types vt2 WHERE vt2.id = p_inner.visibility_id), 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS favourites_count,
        COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS reblogs_count,
        COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS replies_count
      FROM posts p_inner
    ) p
    LEFT JOIN post_backend_ids pb ON p.id = pb.post_id${joinsClause}
    WHERE (${rewrittenWhere || '1=1'})
      ${backendFilter}
    ORDER BY p.created_at_ms DESC
    LIMIT ?
    OFFSET ?;
  `
  phase1Binds.push(limit ?? MAX_QUERY_LIMIT, offset ?? 0)

  const idRows = (await handle.execAsync(phase1Sql, {
    bind: phase1Binds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (number | null)[][]

  const postIds = idRows.map((row) => row[0] as number)

  // 第2段階: 詳細情報の取得
  return fetchStatusesByIds(handle, postIds)
}

/**
 * クエリの構文チェック
 *
 * EXPLAIN を使ってクエリの有効性を検証する。
 * エラーがあればメッセージを返し、問題なければ null を返す。
 */
export async function validateCustomQuery(
  whereClause: string,
): Promise<string | null> {
  if (!whereClause.trim()) return null

  // DML/DDL チェック
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(whereClause)) {
    return 'クエリに禁止されたSQL文が含まれています。WHERE句のみ使用可能です。'
  }

  const sanitized = whereClause
    .replace(/;/g, '')
    .replace(/\bLIMIT\b\s+\d+/gi, '')
    .replace(/\bOFFSET\b\s+\d+/gi, '')
    .trim()

  if (!sanitized) return null

  try {
    const handle = await getSqliteDb()

    // クエリが参照するテーブルに基づいて検証クエリを構築
    const isMixed = isMixedQuery(sanitized)
    const isNotifQuery = !isMixed && isNotificationQuery(sanitized)

    // 旧スキーマのカラム名・テーブル名を v2 に変換
    const rewritten = upgradeQueryToV2(sanitized)

    /** ptt 互換サブクエリ: timeline_entries → (post_id, timelineType) */
    const pttCompat =
      '(SELECT te2.post_id, te2.timeline_key AS timelineType FROM timeline_entries te2 WHERE te2.post_id IS NOT NULL)'

    let sql: string
    if (isMixed) {
      sql = `
        EXPLAIN
        SELECT post_id FROM (
          SELECT p.post_id, p.created_at_ms
          FROM (
            SELECT p_inner.*,
              COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.id = p_inner.origin_server_id), '') AS origin_backend_url,
              COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.id = p_inner.author_profile_id), '') AS account_acct,
              COALESCE((SELECT vt2.name FROM visibility_types vt2 WHERE vt2.id = p_inner.visibility_id), 'public') AS visibility,
              COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS favourites_count,
              COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS reblogs_count,
              COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS replies_count
            FROM posts p_inner
          ) p
          LEFT JOIN ${pttCompat} ptt
            ON p.id = ptt.post_id
          LEFT JOIN post_hashtags pht
            ON p.id = pht.post_id
          LEFT JOIN hashtags ht
            ON pht.hashtag_id = ht.id
          LEFT JOIN post_mentions pme
            ON p.id = pme.post_id
          LEFT JOIN post_backend_ids pb
            ON p.id = pb.post_id
          LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb
            ON p.id = prb.post_id
          LEFT JOIN (
            SELECT n2.*,
              COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = n2.local_account_id), '') AS backend_url,
              COALESCE((SELECT nt2.name FROM notification_types nt2 WHERE nt2.id = n2.notification_type_id), '') AS notification_type,
              COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.id = n2.actor_profile_id), '') AS account_acct
            FROM notifications n2
          ) n ON 0 = 1
          WHERE (${rewritten})
          UNION ALL
          SELECT n.id AS notification_id, n.created_at_ms
          FROM (
            SELECT n2.*,
              COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = n2.local_account_id), '') AS backend_url,
              COALESCE((SELECT nt2.name FROM notification_types nt2 WHERE nt2.id = n2.notification_type_id), '') AS notification_type,
              COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.id = n2.actor_profile_id), '') AS account_acct
            FROM notifications n2
          ) n
          LEFT JOIN (
            SELECT p2.*,
              COALESCE((SELECT sv3.base_url FROM servers sv3 WHERE sv3.id = p2.origin_server_id), '') AS origin_backend_url,
              COALESCE((SELECT pr4.acct FROM profiles pr4 WHERE pr4.id = p2.author_profile_id), '') AS account_acct
            FROM posts p2
          ) p ON 0 = 1
          LEFT JOIN ${pttCompat} ptt
            ON 0 = 1
          LEFT JOIN post_hashtags pht
            ON 0 = 1
          LEFT JOIN hashtags ht
            ON 0 = 1
          LEFT JOIN post_mentions pme
            ON 0 = 1
          LEFT JOIN post_backend_ids pb
            ON 0 = 1
          LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb
            ON 0 = 1
          WHERE (${rewritten})
        )
        LIMIT 1;
      `
    } else if (isNotifQuery) {
      sql = `
        EXPLAIN
        SELECT DISTINCT n.id
        FROM (
          SELECT n2.*,
            COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = n2.local_account_id), '') AS backend_url,
            COALESCE((SELECT nt2.name FROM notification_types nt2 WHERE nt2.id = n2.notification_type_id), '') AS notification_type,
            COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.id = n2.actor_profile_id), '') AS account_acct
          FROM notifications n2
        ) n
        WHERE (${rewritten})
        LIMIT 1;
      `
    } else {
      sql = `
        EXPLAIN
        SELECT DISTINCT p.id
        FROM (
          SELECT p_inner.*,
            COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.id = p_inner.origin_server_id), '') AS origin_backend_url,
            COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.id = p_inner.author_profile_id), '') AS account_acct,
            COALESCE((SELECT vt2.name FROM visibility_types vt2 WHERE vt2.id = p_inner.visibility_id), 'public') AS visibility,
            COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS favourites_count,
            COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS reblogs_count,
            COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.id), 0) AS replies_count
          FROM posts p_inner
        ) p
        LEFT JOIN ${pttCompat} ptt
          ON p.id = ptt.post_id
        LEFT JOIN post_hashtags pht
          ON p.id = pht.post_id
        LEFT JOIN hashtags ht
          ON pht.hashtag_id = ht.id
        LEFT JOIN post_mentions pme
          ON p.id = pme.post_id
        LEFT JOIN post_backend_ids pb
          ON p.id = pb.post_id
        LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb
          ON p.id = prb.post_id
        WHERE (${rewritten})
        LIMIT 1;
      `
    }
    await handle.execAsync(sql)
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return `クエリエラー: ${message}`
  }
}

// ================================================================
// 補完用カラム値取得
// ================================================================

/**
 * DB に保存されている全タグ名を取得する（補完用）
 */
export async function getDistinctTags(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT ht.name FROM post_hashtags pht INNER JOIN hashtags ht ON pht.hashtag_id = ht.id ORDER BY ht.name;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * DB に保存されている全タイムラインタイプを取得する（補完用）
 */
export async function getDistinctTimelineTypes(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT te.timeline_key FROM timeline_entries te ORDER BY te.timeline_key;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

export async function getDistinctColumnValues(
  table: string,
  column: string,
  maxResults = 20,
): Promise<string[]> {
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(column)) return []

  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != '' ORDER BY "${column}" LIMIT ?;`,
      { bind: [maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値をプレフィクス検索で取得する（補完用）
 *
 * エイリアス (p, pbt, pme 等) とカラム名から実テーブルを解決し、
 * 入力中のプレフィクスに一致する値を DB から検索して返す。
 */
export async function searchDistinctColumnValues(
  alias: string,
  column: string,
  prefix: string,
  maxResults = 20,
): Promise<string[]> {
  // 互換カラムのオーバーライドを優先
  const override = COLUMN_TABLE_OVERRIDE[alias]?.[column]
  let table: string
  let realColumn: string

  if (override) {
    table = override.table
    realColumn = override.column
  } else {
    const mapping = ALIAS_TO_TABLE[alias]
    if (!mapping) return []
    const col = mapping.columns[column]
    if (!col) return []
    table = mapping.table
    realColumn = col
  }

  if (!ALLOWED_COLUMN_VALUES[table]?.includes(realColumn)) return []

  try {
    const handle = await getSqliteDb()
    // LIKE でプレフィクスフィルタ（ESCAPE でワイルドカード文字を安全にエスケープ）
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${realColumn}" FROM "${table}" WHERE "${realColumn}" IS NOT NULL AND "${realColumn}" != '' AND "${realColumn}" LIKE ? ESCAPE '\\' ORDER BY "${realColumn}" LIMIT ?;`,
      { bind: [`${escaped}%`, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}
