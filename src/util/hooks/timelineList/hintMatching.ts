/**
 * DB 変更通知のヒントマッチング
 *
 * useTimelineDataSource の subscribeToChanges から抽出した純粋関数。
 * ChangeHint がタイムラインにマッチするかを判定する。
 */

import type { ChangeHint } from 'util/db/sqlite/connection'

/**
 * ヒント配列がタイムライン設定にマッチするか判定する。
 *
 * @param hints - DB 変更通知のヒント配列
 * @param configTimelineTypes - タイムライン設定の timelineType 一覧
 * @param targetBackendUrls - 対象バックエンド URL 一覧
 * @param isLookup - lookup テーブルの場合 true（timelineType チェックをスキップ）
 */
export function hintsMatchTimeline(
  hints: ChangeHint[],
  configTimelineTypes: string[],
  targetBackendUrls: string[],
  isLookup: boolean,
): boolean {
  return hints.some((hint) => {
    // lookup テーブルの場合は timelineType チェックをスキップ
    // (lookup 対象データはどの stream から到着するか分からないため)
    if (!isLookup && hint.timelineType) {
      if (!configTimelineTypes.includes(hint.timelineType)) {
        return false
      }
    }
    if (hint.backendUrl) {
      if (!targetBackendUrls.includes(hint.backendUrl)) {
        return false
      }
    }
    return true
  })
}
