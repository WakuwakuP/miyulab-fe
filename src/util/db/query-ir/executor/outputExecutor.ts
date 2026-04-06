// ============================================================
// Graph Executor — Output ノードエグゼキュータ
//
// 最終的な [{table, id, createdAtMs}] を受け取り:
// 1. sort + pagination 適用
// 2. rows を table でグループ化
// 3. posts → Phase2 + Phase3, notifications → 通知クエリ
// 4. displayOrder で表示順序を保持
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
import type { DisplayOrderEntry, GraphExecuteResult, NodeOutput } from './types'

// reblog_of_post_id のカラムインデックス (STATUS_BASE_SELECT の [25])
const REBLOG_POST_ID_COLUMN_INDEX = 25

/** Output ノードで受入可能なテーブル */
const SUPPORTED_TABLES = new Set(['posts', 'notifications'])

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
): Omit<GraphExecuteResult, 'capturedVersions' | 'meta' | 'nodeOutputIds'> & {
  sourceType: 'post' | 'notification' | 'mixed'
} {
  // --- 1. sort + cursor + pagination ---
  let rows = [...input.rows]

  // sort
  const direction = node.sort.direction === 'ASC' ? 1 : -1
  rows.sort((a, b) => {
    const fieldA = node.sort.field === 'id' ? a.id : a.createdAtMs
    const fieldB = node.sort.field === 'id' ? b.id : b.createdAtMs
    return direction * (fieldA - fieldB)
  })

  // cursor filter (sort 後、slice 前に適用)
  if (node.pagination.cursor) {
    const { field, value, direction: cursorDir } = node.pagination.cursor
    const getField = field === 'id'
      ? (r: (typeof rows)[number]) => r.id
      : (r: (typeof rows)[number]) => r.createdAtMs
    rows = cursorDir === 'before'
      ? rows.filter((r) => getField(r) < value)
      : rows.filter((r) => getField(r) > value)
  }

  // pagination
  const offset = node.pagination.offset ?? 0
  const limit = node.pagination.limit
  rows = rows.slice(offset, offset + limit)

  // --- 2. 未対応テーブルガード ---
  const unsupported = rows.filter((r) => !SUPPORTED_TABLES.has(r.table))
  if (unsupported.length > 0) {
    const tables = [...new Set(unsupported.map((r) => r.table))]
    throw new Error(
      `Output ノードは posts と notifications のみ対応しています。未対応テーブル: ${tables.join(', ')}`,
    )
  }

  if (rows.length === 0) {
    return {
      displayOrder: [],
      notifications: { detailRows: [] },
      posts: { batchResults: {}, detailRows: [] },
      sourceType: inferSourceType(rows),
    }
  }

  // --- 3. table でグループ化 ---
  const postRows = rows.filter((r) => r.table === 'posts')
  const notifRows = rows.filter((r) => r.table === 'notifications')

  // --- 4. displayOrder 構築 ---
  const displayOrder: DisplayOrderEntry[] = rows.map((r) => ({
    id: r.id,
    table: r.table as 'posts' | 'notifications',
  }))

  // --- 5. sourceType 推定 ---
  const sourceType = inferSourceType(rows)

  // --- 6. 各テーブルの Phase2/Phase3 実行 ---
  const postsResult =
    postRows.length > 0
      ? executePostOutput(db, postRows, backendUrls)
      : {
          batchResults: {} as Record<string, (string | number | null)[][]>,
          detailRows: [] as (string | number | null)[][],
        }
  const notifsResult =
    notifRows.length > 0
      ? executeNotificationOutput(db, notifRows)
      : { detailRows: [] as (string | number | null)[][] }

  return {
    displayOrder,
    notifications: notifsResult,
    posts: postsResult,
    sourceType,
  }
}

// --------------- sourceType 推定 ---------------

function inferSourceType(
  rows: NodeOutputRow[],
): 'post' | 'notification' | 'mixed' {
  if (rows.length === 0) return 'post'
  const tables = new Set(rows.map((r) => r.table))
  if (tables.size === 1) {
    if (tables.has('notifications')) return 'notification'
    return 'post'
  }
  return 'mixed'
}

// --------------- Post 出力 ---------------

function executePostOutput(
  db: DbExec,
  rows: NodeOutputRow[],
  backendUrls: string[],
): {
  detailRows: (string | number | null)[][]
  batchResults: Record<string, (string | number | null)[][]>
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
  }
}

// --------------- Notification 出力 ---------------

function executeNotificationOutput(
  db: DbExec,
  rows: NodeOutputRow[],
): {
  detailRows: (string | number | null)[][]
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
    detailRows,
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
