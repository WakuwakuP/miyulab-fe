/**
 * ストリーミング差分取得のための純粋ヘルパー関数
 *
 * useTimelineStreamingController / useTimelineScrollbackController から使用される
 * カーソル構築・changedTables 集約ロジックを純粋関数として切り出し、
 * 単体テスト可能な形で提供する。
 */

import type { PaginationCursor } from 'util/db/query-ir/nodes'
import type { ChangeHint } from 'util/db/sqlite/connection'

import { CURSOR_MARGIN_MS } from './itemHelpers'

/**
 * ChangeHint 配列から changedTables を集約して Set にまとめる。
 *
 * 複数の hint が異なる changedTables を持つ場合、すべてを union する。
 * changedTables が undefined の hint は無視する。
 */
export function aggregateChangedTables(
  hints: ChangeHint[],
): ReadonlySet<string> {
  const result = new Set<string>()
  for (const hint of hints) {
    if (hint.changedTables) {
      for (const table of hint.changedTables) {
        result.add(table)
      }
    }
  }
  return result
}

/**
 * ストリーミング差分取得用のカーソルを構築する。
 *
 * - newestMs > 0 → created_at_ms カーソル (CURSOR_MARGIN_MS 分の安全マージン付き)
 * - newestMs === 0 かつ newestId > 0 → id カーソル
 * - いずれも 0 → undefined (カーソルなしフルページ取得)
 */
export function buildStreamingCursor(state: {
  newestId: number
  newestMs: number
}): PaginationCursor | undefined {
  if (state.newestMs > 0) {
    return {
      direction: 'after',
      field: 'created_at_ms',
      value: state.newestMs - CURSOR_MARGIN_MS,
    }
  }
  if (state.newestId > 0) {
    return {
      direction: 'after',
      field: 'id',
      value: state.newestId,
    }
  }
  return undefined
}
