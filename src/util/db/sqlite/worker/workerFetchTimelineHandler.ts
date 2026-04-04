/**
 * Timeline 一括取得ハンドラ
 *
 * Phase1 (ID 収集) → Phase2 (詳細取得) → Batch (関連データ) の 3 段階で
 * タイムラインデータを一括取得する。
 */

import type { FetchTimelineRequest, FetchTimelineResult } from '../protocol'
import { getDb } from './workerState'

export function handleFetchTimeline(
  msg: Omit<FetchTimelineRequest, 'id' | 'type'>,
): FetchTimelineResult {
  const db = getDb()
  const start = performance.now()

  // Phase1
  const phase1Rows = db.exec(msg.phase1.sql, {
    bind: msg.phase1.bind,
    returnValue: 'resultRows',
  }) as (string | number | null)[][]

  const postIds = phase1Rows.map(
    (row: (string | number | null)[]) => row[0] as number,
  )
  if (postIds.length === 0) {
    return {
      batchResults: {
        belongingTags: [],
        customEmojis: [],
        interactions: [],
        media: [],
        mentions: [],
        polls: [],
        profileEmojis: [],
        timelineTypes: [],
      },
      phase1Rows,
      phase2Rows: [],
      totalDurationMs: performance.now() - start,
    }
  }

  // Phase2
  const placeholders = postIds.map(() => '?').join(',')
  const phase2Sql = msg.phase2BaseSql.replaceAll('{IDS}', placeholders)
  const phase2Rows = db.exec(phase2Sql, {
    bind: postIds,
    returnValue: 'resultRows',
  }) as (string | number | null)[][]

  // reblog post_id を収集
  const reblogColIdx = msg.reblogPostIdColumnIndex ?? 25
  const reblogPostIds: number[] = []
  for (const row of phase2Rows) {
    const rbId = row[reblogColIdx] as number | null
    if (rbId !== null) reblogPostIds.push(rbId)
  }
  const allPostIds = [...new Set([...postIds, ...reblogPostIds])]
  const allPlaceholders = allPostIds.map(() => '?').join(',')

  // Batch 7本を同期実行
  const runBatch = (sql: string) =>
    db.exec(sql.replaceAll('{IDS}', allPlaceholders), {
      bind: allPostIds,
      returnValue: 'resultRows',
    }) as (string | number | null)[][]

  const batchResults = {
    belongingTags: runBatch(msg.batchSqls.belongingTags),
    customEmojis: runBatch(msg.batchSqls.customEmojis),
    interactions: runBatch(msg.batchSqls.interactions),
    media: runBatch(msg.batchSqls.media),
    mentions: runBatch(msg.batchSqls.mentions),
    polls: runBatch(msg.batchSqls.polls),
    profileEmojis: runBatch(msg.batchSqls.profileEmojis),
    timelineTypes: runBatch(msg.batchSqls.timelineTypes),
  }

  return {
    batchResults,
    phase1Rows,
    phase2Rows,
    totalDurationMs: performance.now() - start,
  }
}
