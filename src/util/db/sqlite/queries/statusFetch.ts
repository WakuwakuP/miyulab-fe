/**
 * ID ベースの詳細取得ロジック
 *
 * 2段階クエリ戦略の第2段階で使用する共通ヘルパー。
 * post_id リストから完全な投稿データを取得する。
 */

import type { SqliteHandle } from './statusBatch'
import { executeBatchQueries } from './statusBatch'
import type { SqliteStoredStatus } from './statusMapper'
import { assembleStatusFromBatch } from './statusMapper'
import { STATUS_BASE_JOINS, STATUS_BASE_SELECT } from './statusSelect'

/**
 * post_id のリストから完全な投稿データを取得する（バッチクエリ版）
 *
 * 2段階クエリ戦略の第2段階で使用する共通ヘルパー。
 * 第1段階でフィルタ済みの post_id を受け取り、詳細情報を返す。
 *
 * 従来は 1 つの SQL に ~13 個の相関サブクエリを埋め込んでいたが、
 * 本実装では本体クエリ (Phase2-A) + 7 個の子テーブルバッチクエリに分解し、
 * JS 側でマージする。これにより約 1,050 回 → 8 回にクエリ回数を削減する。
 */
export async function fetchStatusesByIds(
  handle: SqliteHandle,
  postIds: number[],
  timelineTypesMap?: Map<number, string>,
): Promise<SqliteStoredStatus[]> {
  if (postIds.length === 0) return []

  // Phase2-A: 本体 + 1:1 JOIN (相関サブクエリなし)
  const placeholders = postIds.map(() => '?').join(',')
  const baseSql = `
    SELECT ${STATUS_BASE_SELECT}
    FROM posts p
      ${STATUS_BASE_JOINS}
    WHERE p.id IN (${placeholders})
    GROUP BY p.id
    ORDER BY p.created_at_ms DESC;
  `
  const baseRows = (await handle.execAsync(baseSql, {
    bind: postIds,
    kind: 'timeline',
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  if (baseRows.length === 0) return []

  // リブログ元の post_id を収集し、全 post_id のリストを作成
  const reblogPostIds: number[] = []
  for (const row of baseRows) {
    const rbPostId = row[27] as number | null // rb_post_id
    if (rbPostId !== null) {
      reblogPostIds.push(rbPostId)
    }
  }

  // 重複を排除した全 post_id (親 + リブログ元)
  const allPostIds = [...new Set([...postIds, ...reblogPostIds])]

  // Phase2-B〜H: 子テーブルのバッチクエリを並列実行
  const maps = await executeBatchQueries(handle, allPostIds)

  // 外部から渡された timelineTypesMap があればバッチ結果を上書き
  if (timelineTypesMap) {
    for (const [id, types] of timelineTypesMap) {
      maps.timelineTypesMap.set(id, types)
    }
  }

  // JS 側マージ: 基本行 + バッチ Map → SqliteStoredStatus
  return baseRows.map((row) => assembleStatusFromBatch(row, maps))
}
