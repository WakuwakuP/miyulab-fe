/**
 * SQLite ベースの Status ストア
 *
 * Dexie の statusStore.ts と同じ公開 API を提供する。
 * JSON カラムに Entity.Status 全体をシリアライズし、
 * インデックス用カラムを正規化テーブルで管理する。
 */

import type { Entity } from 'megalodon'
import type { TimelineType } from '../database'
import { type DbHandle, getSqliteDb, notifyChange } from './connection'

// ================================================================
// 定数
// ================================================================

/** クエリの最大行数上限（LIMIT 未指定時のデフォルト） */
const MAX_QUERY_LIMIT = 2147483647

// ================================================================
// ヘルパー
// ================================================================

export function createCompositeKey(backendUrl: string, id: string): string {
  return `${backendUrl}:${id}`
}

/**
 * StoredStatus 互換の型（SQLite から組み立てる）
 */
export interface SqliteStoredStatus extends Entity.Status {
  compositeKey: string
  backendUrl: string
  timelineTypes: TimelineType[]
  belongingTags: string[]
  created_at_ms: number
  storedAt: number
}

// ================================================================
// 内部ユーティリティ
// ================================================================

function getTimelineTypes(
  handle: DbHandle,
  compositeKey: string,
): TimelineType[] {
  const rows = handle.db.exec(
    'SELECT timelineType FROM statuses_timeline_types WHERE compositeKey = ?;',
    { bind: [compositeKey], returnValue: 'resultRows' },
  ) as string[][]
  return rows.map((r) => r[0] as TimelineType)
}

function getBelongingTags(handle: DbHandle, compositeKey: string): string[] {
  const rows = handle.db.exec(
    'SELECT tag FROM statuses_belonging_tags WHERE compositeKey = ?;',
    { bind: [compositeKey], returnValue: 'resultRows' },
  ) as string[][]
  return rows.map((r) => r[0])
}

function rowToStoredStatus(
  handle: DbHandle,
  row: (string | number)[],
): SqliteStoredStatus {
  const compositeKey = row[0] as string
  const backendUrl = row[1] as string
  const created_at_ms = row[2] as number
  const storedAt = row[3] as number
  const json = row[4] as string
  const status = JSON.parse(json) as Entity.Status

  return {
    ...status,
    backendUrl,
    belongingTags: getBelongingTags(handle, compositeKey),
    compositeKey,
    created_at_ms,
    storedAt,
    timelineTypes: getTimelineTypes(handle, compositeKey),
  }
}

// ================================================================
// Public API
// ================================================================

/**
 * Entity.Status を StoredStatus 互換に変換して返す（保存は行わない）
 */
export function toStoredStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineTypes: TimelineType[],
): SqliteStoredStatus {
  return {
    ...status,
    backendUrl,
    belongingTags: status.tags.map((tag) => tag.name),
    compositeKey: createCompositeKey(backendUrl, status.id),
    created_at_ms: new Date(status.created_at).getTime(),
    storedAt: Date.now(),
    timelineTypes,
  }
}

/**
 * Status を追加または更新
 */
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, status.id)
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()

  db.exec('BEGIN;')
  try {
    // UPSERT メイン行
    db.exec(
      `INSERT INTO statuses (compositeKey, backendUrl, created_at_ms, storedAt, json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(compositeKey) DO UPDATE SET
         created_at_ms = excluded.created_at_ms,
         storedAt = excluded.storedAt,
         json = excluded.json;`,
      {
        bind: [
          compositeKey,
          backendUrl,
          created_at_ms,
          now,
          JSON.stringify(status),
        ],
      },
    )

    // timeline type を追加（重複無視）
    db.exec(
      `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
       VALUES (?, ?);`,
      { bind: [compositeKey, timelineType] },
    )

    // タグを追加
    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, t.name] },
      )
    }

    // 追加タグ（ストリーミングからのタグ指定）
    if (tag) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, tag] },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
}

/**
 * 複数の Status を一括追加（初期ロード用）
 */
export async function bulkUpsertStatuses(
  statuses: Entity.Status[],
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  if (statuses.length === 0) return

  const handle = await getSqliteDb()
  const { db } = handle
  const now = Date.now()

  db.exec('BEGIN;')
  try {
    for (const status of statuses) {
      const compositeKey = createCompositeKey(backendUrl, status.id)
      const created_at_ms = new Date(status.created_at).getTime()

      db.exec(
        `INSERT INTO statuses (compositeKey, backendUrl, created_at_ms, storedAt, json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(compositeKey) DO UPDATE SET
           created_at_ms = excluded.created_at_ms,
           storedAt = excluded.storedAt,
           json = excluded.json;`,
        {
          bind: [
            compositeKey,
            backendUrl,
            created_at_ms,
            now,
            JSON.stringify(status),
          ],
        },
      )

      db.exec(
        `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
         VALUES (?, ?);`,
        { bind: [compositeKey, timelineType] },
      )

      for (const t of status.tags) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
           VALUES (?, ?);`,
          { bind: [compositeKey, t.name] },
        )
      }

      if (tag) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
           VALUES (?, ?);`,
          { bind: [compositeKey, tag] },
        )
      }
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
}

/**
 * 特定タイムラインから Status を除外（物理削除ではない）
 */
export async function removeFromTimeline(
  backendUrl: string,
  statusId: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, statusId)

  db.exec('BEGIN;')
  try {
    // タイムライン種別を削除
    db.exec(
      'DELETE FROM statuses_timeline_types WHERE compositeKey = ? AND timelineType = ?;',
      { bind: [compositeKey, timelineType] },
    )

    // tag TL 除外時は belongingTags も更新
    if (timelineType === 'tag' && tag) {
      db.exec(
        'DELETE FROM statuses_belonging_tags WHERE compositeKey = ? AND tag = ?;',
        { bind: [compositeKey, tag] },
      )

      // まだ他のタグが残っている場合は 'tag' タイプを復元
      const remainingTags = (
        db.exec(
          'SELECT COUNT(*) FROM statuses_belonging_tags WHERE compositeKey = ?;',
          { bind: [compositeKey], returnValue: 'resultRows' },
        ) as number[][]
      )[0][0]

      if (remainingTags > 0) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
           VALUES (?, 'tag');`,
          { bind: [compositeKey] },
        )
      }
    }

    // どのタイムラインにも属さなくなったら物理削除
    const remaining = (
      db.exec(
        'SELECT COUNT(*) FROM statuses_timeline_types WHERE compositeKey = ?;',
        { bind: [compositeKey], returnValue: 'resultRows' },
      ) as number[][]
    )[0][0]

    if (remaining === 0) {
      db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
        bind: [compositeKey],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
}

/**
 * delete イベントの処理
 */
export async function handleDeleteEvent(
  backendUrl: string,
  statusId: string,
  sourceTimelineType: TimelineType,
  tag?: string,
): Promise<void> {
  await removeFromTimeline(backendUrl, statusId, sourceTimelineType, tag)
}

/**
 * Status のアクション状態を更新
 */
export async function updateStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, statusId)

  db.exec('BEGIN;')
  try {
    // メイン Status の json を更新
    const rows = db.exec('SELECT json FROM statuses WHERE compositeKey = ?;', {
      bind: [compositeKey],
      returnValue: 'resultRows',
    }) as string[][]

    if (rows.length > 0) {
      const status = JSON.parse(rows[0][0]) as Entity.Status
      ;(status as Record<string, unknown>)[action] = value

      db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
        bind: [JSON.stringify(status), compositeKey],
      })

      // reblog の場合、reblog 元も更新
      if (status.reblog) {
        const reblogKey = createCompositeKey(backendUrl, status.reblog.id)
        const reblogRows = db.exec(
          'SELECT json FROM statuses WHERE compositeKey = ?;',
          { bind: [reblogKey], returnValue: 'resultRows' },
        ) as string[][]

        if (reblogRows.length > 0) {
          const reblogStatus = JSON.parse(reblogRows[0][0]) as Entity.Status
          ;(reblogStatus as Record<string, unknown>)[action] = value
          db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
            bind: [JSON.stringify(reblogStatus), reblogKey],
          })
        }
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  // この Status を reblog として持つ他の Status も更新
  const relatedRows = db.exec(
    `SELECT compositeKey, json FROM statuses WHERE backendUrl = ?;`,
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as (string | number)[][]

  const updates: { key: string; json: string }[] = []
  for (const row of relatedRows) {
    const json = JSON.parse(row[1] as string) as Entity.Status
    if (json.reblog?.id === statusId) {
      ;(json.reblog as Record<string, unknown>)[action] = value
      updates.push({ json: JSON.stringify(json), key: row[0] as string })
    }
  }

  if (updates.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const u of updates) {
        db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
          bind: [u.json, u.key],
        })
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
  }

  notifyChange('statuses')
}

/**
 * Status 全体を更新（編集された投稿用）
 */
export async function updateStatus(
  status: Entity.Status,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, status.id)
  const created_at_ms = new Date(status.created_at).getTime()
  const now = Date.now()

  // 既存確認
  const existing = db.exec(
    'SELECT compositeKey FROM statuses WHERE compositeKey = ?;',
    { bind: [compositeKey], returnValue: 'resultRows' },
  ) as string[][]

  if (existing.length === 0) return

  db.exec('BEGIN;')
  try {
    db.exec(
      `UPDATE statuses SET
         created_at_ms = ?,
         storedAt = ?,
         json = ?
       WHERE compositeKey = ?;`,
      {
        bind: [created_at_ms, now, JSON.stringify(status), compositeKey],
      },
    )

    // タグを再構築
    db.exec('DELETE FROM statuses_belonging_tags WHERE compositeKey = ?;', {
      bind: [compositeKey],
    })
    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, t.name] },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('statuses')
}

// ================================================================
// クエリ API
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
  const { db } = handle

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
      FROM statuses s
      INNER JOIN statuses_timeline_types stt
        ON s.compositeKey = stt.compositeKey
      WHERE stt.timelineType = ?
        AND s.backendUrl IN (${placeholders})
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(timelineType, ...backendUrls, limit ?? MAX_QUERY_LIMIT)
  } else {
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
      FROM statuses s
      INNER JOIN statuses_timeline_types stt
        ON s.compositeKey = stt.compositeKey
      WHERE stt.timelineType = ?
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(timelineType, limit ?? MAX_QUERY_LIMIT)
  }

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  return rows.map((row) => rowToStoredStatus(handle, row))
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
  const { db } = handle

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
      FROM statuses s
      INNER JOIN statuses_belonging_tags sbt
        ON s.compositeKey = sbt.compositeKey
      WHERE sbt.tag = ?
        AND s.backendUrl IN (${placeholders})
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(tag, ...backendUrls, limit ?? MAX_QUERY_LIMIT)
  } else {
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
      FROM statuses s
      INNER JOIN statuses_belonging_tags sbt
        ON s.compositeKey = sbt.compositeKey
      WHERE sbt.tag = ?
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(tag, limit ?? MAX_QUERY_LIMIT)
  }

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  return rows.map((row) => rowToStoredStatus(handle, row))
}

/**
 * ユーザー入力の WHERE 句をサニタイズする
 *
 * - LIMIT / OFFSET を除去（自動設定のため）
 * - データ変更系ステートメントを拒否（DROP, DELETE, INSERT, UPDATE, ALTER, CREATE）
 * - セミコロン（複文実行）を除去
 *
 * ※ この DB はクライアントサイド専用（ユーザー自身のデータのみ）のため、
 *   悪意のある第三者による攻撃リスクは低い。しかし誤操作によるデータ破損を
 *   防止するため、DML/DDL ステートメントは拒否する。
 */
function sanitizeWhereClause(input: string): string {
  // データ変更・構造変更ステートメントを検出して拒否
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(input)) {
    throw new Error(
      'Custom query contains forbidden SQL statements. Only SELECT-compatible WHERE clauses are allowed.',
    )
  }

  return (
    input
      // セミコロンを除去（複文実行防止）
      .replace(/;/g, '')
      // LIMIT/OFFSET を除去（自動設定のため）
      .replace(/\bLIMIT\b\s+\d+/gi, '')
      .replace(/\bOFFSET\b\s+\d+/gi, '')
      .trim()
  )
}

/**
 * カスタム WHERE 句で Status を取得（advanced query 用）
 *
 * limit / offset はクエリ文字列を無視して自動設定する。
 * WHERE 句は statuses_timeline_types (stt), statuses_belonging_tags (sbt),
 * statuses (s) テーブルを参照できる。
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
  const { db } = handle

  const sanitized = sanitizeWhereClause(whereClause)

  let backendFilter = ''
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND s.backendUrl IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const sql = `
    SELECT DISTINCT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
    FROM statuses s
    LEFT JOIN statuses_timeline_types stt
      ON s.compositeKey = stt.compositeKey
    LEFT JOIN statuses_belonging_tags sbt
      ON s.compositeKey = sbt.compositeKey
    WHERE (${sanitized || '1=1'})
      ${backendFilter}
    ORDER BY s.created_at_ms DESC
    LIMIT ?
    OFFSET ?;
  `
  binds.push(limit ?? MAX_QUERY_LIMIT, offset ?? 0)

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  return rows.map((row) => rowToStoredStatus(handle, row))
}

/**
 * テーブルカラム / エイリアス一覧（補完用）
 */
export const QUERY_COMPLETIONS = {
  aliases: ['s', 'stt', 'sbt'],
  columns: {
    s: ['compositeKey', 'backendUrl', 'created_at_ms', 'storedAt', 'json'],
    sbt: ['compositeKey', 'tag'],
    stt: ['compositeKey', 'timelineType'],
  },
  examples: [
    {
      description: 'ホームタイムラインを取得する',
      query: "stt.timelineType = 'home'",
    },
    {
      description: '指定タグの投稿を取得する',
      query: "sbt.tag = 'photo'",
    },
    {
      description: '複数タグのいずれかを含む投稿を取得する',
      query: "sbt.tag IN ('photo', 'art')",
    },
    {
      description: 'ローカルタイムラインで特定タグの投稿を取得する',
      query: "stt.timelineType = 'local' AND sbt.tag = 'music'",
    },
    {
      description: '特定ユーザーの投稿を取得する',
      query: "json_extract(s.json, '$.account.acct') = 'user@example.com'",
    },
    {
      description: '添付メディアが存在する投稿を取得する',
      query: "json_extract(s.json, '$.media_attachments') != '[]'",
    },
    {
      description: 'メディアが2枚以上ある投稿を取得する',
      query:
        "json_array_length(json_extract(s.json, '$.media_attachments')) >= 2",
    },
    {
      description: 'ブーストされた投稿を取得する',
      query: "json_extract(s.json, '$.reblog') IS NOT NULL",
    },
    {
      description: 'CW（Content Warning）付きの投稿を取得する',
      query: "json_extract(s.json, '$.spoiler_text') != ''",
    },
  ],
  /** json_extract の `$.` パス補完候補 */
  jsonPaths: [
    '$.id',
    '$.content',
    '$.account.acct',
    '$.account.display_name',
    '$.account.username',
    '$.account.url',
    '$.media_attachments',
    '$.reblog',
    '$.spoiler_text',
    '$.visibility',
    '$.language',
    '$.created_at',
    '$.favourites_count',
    '$.reblogs_count',
    '$.replies_count',
    '$.sensitive',
    '$.tags',
    '$.mentions',
    '$.url',
    '$.in_reply_to_id',
  ],
  keywords: [
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'IN',
    'LIKE',
    'BETWEEN',
    'IS',
    'NULL',
    'IS NOT NULL',
    'GLOB',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'DISTINCT',
    // JSON 関数
    'json_extract',
    'json_array_length',
    'json_type',
    'json_valid',
    'json_each',
    'json_group_array',
    'json_group_object',
    // 文字列関数
    'length',
    'lower',
    'upper',
    'trim',
    'substr',
    'replace',
    'instr',
    // 集約・数値関数
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'abs',
    // その他の関数
    'coalesce',
    'ifnull',
    'nullif',
    'typeof',
    'cast',
  ],
} as const

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
    const { db } = handle

    // EXPLAIN でクエリの構文チェック
    const sql = `
      EXPLAIN
      SELECT DISTINCT s.compositeKey
      FROM statuses s
      LEFT JOIN statuses_timeline_types stt
        ON s.compositeKey = stt.compositeKey
      LEFT JOIN statuses_belonging_tags sbt
        ON s.compositeKey = sbt.compositeKey
      WHERE (${sanitized})
      LIMIT 1;
    `
    db.exec(sql)
    return null
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return `クエリエラー: ${message}`
  }
}

/**
 * DB に保存されている全タグ名を取得する（補完用）
 */
export async function getDistinctTags(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const { db } = handle
    const rows = db.exec(
      'SELECT DISTINCT tag FROM statuses_belonging_tags ORDER BY tag;',
      { returnValue: 'resultRows' },
    ) as string[][]
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
    const { db } = handle
    const rows = db.exec(
      'SELECT DISTINCT timelineType FROM statuses_timeline_types ORDER BY timelineType;',
      { returnValue: 'resultRows' },
    ) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}
