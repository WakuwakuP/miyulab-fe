/**
 * Status ストア — カスタムクエリ実行・検証
 *
 * カスタム WHERE 句による Status 取得と、クエリの構文チェックを提供する。
 */

import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
  upgradeQueryToV2,
} from 'util/queryBuilder'
import { getSqliteDb } from '../connection'
import { sanitizeWhereClause } from '../queries/statusCustomQuery'
import { fetchStatusesByIds } from '../queries/statusFetch'
import type { SqliteStoredStatus } from '../queries/statusMapper'
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
    backendFilter = `AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))`
    phase1Binds.push(...backendUrls)
  }

  const joinsClause =
    joinLines.length > 0 ? `\n    ${joinLines.join('\n    ')}` : ''

  // 第1段階: post_id の取得（旧カラム名の後方互換性のため posts をサブクエリでラップ）
  const phase1Sql = `
    SELECT DISTINCT p.id AS post_id
    FROM (
      SELECT p_inner.*,
        COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.server_id = p_inner.origin_server_id LIMIT 1), '') AS origin_backend_url,
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
          SELECT p.id AS post_id, p.created_at_ms
          FROM (
            SELECT p_inner.*,
              COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.server_id = p_inner.origin_server_id LIMIT 1), '') AS origin_backend_url,
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
          LEFT JOIN profiles pr
            ON pr.id = p.author_profile_id
          LEFT JOIN visibility_types vt
            ON vt.id = p.visibility_id
          LEFT JOIN post_stats ps
            ON ps.post_id = p.id
          LEFT JOIN post_interactions pe
            ON pe.post_id = p.id
          LEFT JOIN (
            SELECT n2.*,
              COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = n2.local_account_id), '') AS backend_url,
              COALESCE((SELECT nt2.name FROM notification_types nt2 WHERE nt2.id = n2.notification_type_id), '') AS notification_type,
              COALESCE((SELECT pr3.acct FROM profiles pr3 WHERE pr3.id = n2.actor_profile_id), '') AS account_acct
            FROM notifications n2
          ) n ON 0 = 1
          LEFT JOIN notification_types nt ON 0 = 1
          LEFT JOIN profiles ap ON 0 = 1
          LEFT JOIN local_accounts la ON 0 = 1
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
          LEFT JOIN notification_types nt
            ON nt.id = n.notification_type_id
          LEFT JOIN profiles ap
            ON ap.id = n.actor_profile_id
          LEFT JOIN local_accounts la
            ON la.id = n.local_account_id
          LEFT JOIN (
            SELECT p2.*,
              COALESCE((SELECT la3.backend_url FROM local_accounts la3 WHERE la3.server_id = p2.origin_server_id LIMIT 1), '') AS origin_backend_url,
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
          LEFT JOIN profiles pr
            ON 0 = 1
          LEFT JOIN visibility_types vt
            ON 0 = 1
          LEFT JOIN post_stats ps
            ON 0 = 1
          LEFT JOIN post_interactions pe
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
        LEFT JOIN notification_types nt
          ON nt.id = n.notification_type_id
        LEFT JOIN profiles ap
          ON ap.id = n.actor_profile_id
        LEFT JOIN local_accounts la
          ON la.id = n.local_account_id
        WHERE (${rewritten})
        LIMIT 1;
      `
    } else {
      sql = `
        EXPLAIN
        SELECT DISTINCT p.id
        FROM (
          SELECT p_inner.*,
            COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.server_id = p_inner.origin_server_id LIMIT 1), '') AS origin_backend_url,
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
        LEFT JOIN profiles pr
          ON pr.id = p.author_profile_id
        LEFT JOIN visibility_types vt
          ON vt.id = p.visibility_id
        LEFT JOIN post_stats ps
          ON ps.post_id = p.id
        LEFT JOIN post_interactions pe
          ON pe.post_id = p.id
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
