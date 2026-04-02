// ============================================================
// Graph Executor — Output ノードエグゼキュータ
//
// 最終的な [{id, createdAtMs}] を受け取り:
// 1. sort + pagination 適用
// 2. sourceType 推定
// 3. Phase2: 詳細データ取得 (posts or notifications)
// 4. Phase3: バッチエンリッチメント
// 5. reblog 展開
// ============================================================

import type { DbExec } from '../../sqlite/queries/executionEngine'
import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
} from '../../sqlite/queries/notificationSelect'
import type { BATCH_SQL_TEMPLATES } from '../../sqlite/queries/statusBatch'
import {
  buildPhase2Template,
  buildScopedBatchTemplates,
  buildSpbFilter,
} from '../../sqlite/queries/statusSelect'
import type { OutputNodeV2 } from '../nodes'
import type { NodeOutputRow } from '../plan'
import type { GraphExecuteResult, NodeOutput } from './types'

// reblog_of_post_id のカラムインデックス (STATUS_BASE_SELECT の [25])
const REBLOG_POST_ID_COLUMN_INDEX = 25

/**
 * Output ノードを実行し、最終的な GraphExecuteResult を構築する。
 *
 * @param db - SQLite 実行ハンドル
 * @param node - Output ノード定義
 * @param input - 上流ノードの出力
 * @param backendUrls - バックエンド URL 一覧（scoped query 用）
 */
export function executeOutput(
  db: DbExec,
  node: OutputNodeV2,
  input: NodeOutput,
  backendUrls: string[],
): Omit<GraphExecuteResult, 'meta' | 'capturedVersions'> & {
  sourceType: 'post' | 'notification' | 'mixed'
} {
  // --- 1. sort + pagination ---
  let rows = [...input.rows]

  // sort
  const direction = node.sort.direction === 'ASC' ? 1 : -1
  rows.sort((a, b) => {
    const fieldA = node.sort.field === 'id' ? a.id : a.createdAtMs
    const fieldB = node.sort.field === 'id' ? b.id : b.createdAtMs
    return direction * (fieldA - fieldB)
  })

  // pagination
  const offset = node.pagination.offset ?? 0
  const limit = node.pagination.limit
  rows = rows.slice(offset, offset + limit)

  if (rows.length === 0) {
    return {
      batchResults: {},
      detailRows: [],
      sourceType: inferSourceType(input.sourceTable),
    }
  }

  // --- 2. sourceType 推定 ---
  const sourceType = inferSourceType(input.sourceTable)

  // --- 3/4. Phase2 + Phase3 実行 ---
  if (sourceType === 'notification') {
    return executeNotificationOutput(db, rows)
  }

  return executePostOutput(db, rows, backendUrls)
}

// --------------- sourceType 推定 ---------------

function inferSourceType(
  sourceTable: string,
): 'post' | 'notification' | 'mixed' {
  if (sourceTable === 'notifications') return 'notification'
  if (sourceTable === 'posts' || sourceTable === 'timeline_entries')
    return 'post'
  return 'post'
}

// --------------- Post 出力 ---------------

function executePostOutput(
  db: DbExec,
  rows: NodeOutputRow[],
  backendUrls: string[],
): Omit<GraphExecuteResult, 'meta' | 'capturedVersions'> & {
  sourceType: 'post'
} {
  let postIds = rows.map((r) => r.id)

  // Phase2: Detail Fetch
  const spbFilter = buildSpbFilter(backendUrls)
  const phase2Template = buildPhase2Template(spbFilter)
  const placeholders = postIds.map(() => '?').join(',')
  const phase2Sql = phase2Template.replaceAll('{IDS}', placeholders)

  const detailRows = db.exec(phase2Sql, {
    bind: postIds,
    returnValue: 'resultRows',
  })

  // Reblog 展開: reblog_of_post_id があれば追加 ID を収集
  const reblogIds: number[] = []
  for (const row of detailRows) {
    const rbId = row[REBLOG_POST_ID_COLUMN_INDEX] as number | null
    if (rbId != null && !postIds.includes(rbId)) {
      reblogIds.push(rbId)
    }
  }
  if (reblogIds.length > 0) {
    postIds = [...new Set([...postIds, ...reblogIds])]
  }

  // Phase3: Batch Enrichment
  const batchTemplates = buildScopedBatchTemplates(backendUrls)
  const batchResults = executeBatchQueries(db, postIds, batchTemplates)

  return {
    batchResults,
    detailRows,
    sourceType: 'post',
  }
}

// --------------- Notification 出力 ---------------

function executeNotificationOutput(
  db: DbExec,
  rows: NodeOutputRow[],
): Omit<GraphExecuteResult, 'meta' | 'capturedVersions'> & {
  sourceType: 'notification'
} {
  const notifIds = rows.map((r) => r.id)
  const placeholders = notifIds.map(() => '?').join(',')

  // NOTIFICATION_SELECT + NOTIFICATION_BASE_JOINS と同一レイアウトで取得
  // rowToStoredNotification が要求する 42 カラム行を生成する
  const sql = `
    SELECT
      ${NOTIFICATION_SELECT}
    FROM notifications n
    ${NOTIFICATION_BASE_JOINS}
    WHERE n.id IN (${placeholders})
    ORDER BY n.created_at_ms DESC
  `

  const detailRows = db.exec(sql, {
    bind: notifIds,
    returnValue: 'resultRows',
  })

  return {
    batchResults: {},
    detailRows,
    sourceType: 'notification',
  }
}

// --------------- バッチクエリ実行 ---------------

function executeBatchQueries(
  db: DbExec,
  postIds: number[],
  templates: { [K in keyof typeof BATCH_SQL_TEMPLATES]: string },
): Record<string, (string | number | null)[][]> {
  if (postIds.length === 0) return {}

  const placeholders = postIds.map(() => '?').join(',')
  const results: Record<string, (string | number | null)[][]> = {}

  for (const [key, sqlTemplate] of Object.entries(templates)) {
    const sql = sqlTemplate.replaceAll('{IDS}', placeholders)
    results[key] = db.exec(sql, {
      bind: postIds,
      returnValue: 'resultRows',
    })
  }

  return results
}
