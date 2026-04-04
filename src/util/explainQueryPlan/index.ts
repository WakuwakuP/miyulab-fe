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
import { formatSql } from './formatSql'
import { buildTimelineQuery } from './queryBuilders'

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

export { formatSql } from './formatSql'
export { buildTimelineQuery } from './queryBuilders'
