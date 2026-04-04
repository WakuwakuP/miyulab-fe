/**
 * Status ストア — タイムライン・タグ・ブックマーク取得
 *
 * タイムライン種別・タグ・ブックマークによる Status 取得を提供する。
 */

import { getSqliteDb } from '../connection'
import { fetchStatusesByIds } from '../queries/statusFetch'
import type { SqliteStoredStatus, TimelineType } from '../queries/statusMapper'
import { MAX_QUERY_LIMIT } from '../queries/statusSelect'

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
    backendFilter = `AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))`
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
    backendFilter = `AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))`
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
    backendFilter = `AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))`
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
