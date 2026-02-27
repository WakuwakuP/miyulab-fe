/**
 * SQLite ベースの Status ストア（薄いラッパー）
 *
 * 書き込み操作は Worker 側の専用ハンドラに委譲し、
 * 読み取り操作のみ execAsync で直接実行する。
 *
 * notifyChange は workerClient が changedTables を元に自動発火するため、
 * このモジュールからは呼ばない。
 */

import type { Entity } from 'megalodon'
import {
  detectReferencedAliases,
  isMixedQuery,
  isNotificationQuery,
} from 'util/queryBuilder'
import type { TimelineType } from '../database'
import { getSqliteDb } from './connection'
import { createCompositeKey } from './shared'

export { createCompositeKey }

// ================================================================
// 定数
// ================================================================

/** クエリの最大行数上限（LIMIT 未指定時のデフォルト） */
const MAX_QUERY_LIMIT = 2147483647

// ================================================================
// StoredStatus 型
// ================================================================
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

/**
 * クエリ結果の1行を SqliteStoredStatus に変換する
 *
 * row レイアウト:
 *   [0] compositeKey, [1] backendUrl, [2] created_at_ms, [3] storedAt,
 *   [4] json, [5] timelineTypesJson, [6] belongingTagsJson
 *
 * timelineTypes / belongingTags は SQL 側で json_group_array() を使って
 * 集約済みの JSON 配列文字列として受け取る。
 * これにより、行ごとに個別クエリを発行する N+1 問題を解消している。
 */
function rowToStoredStatus(
  row: (string | number | null)[],
): SqliteStoredStatus {
  const compositeKey = row[0] as string
  const backendUrl = row[1] as string
  const created_at_ms = row[2] as number
  const storedAt = row[3] as number
  const json = row[4] as string
  const timelineTypesJson = row[5] as string | null
  const belongingTagsJson = row[6] as string | null
  const status = JSON.parse(json) as Entity.Status

  return {
    ...status,
    backendUrl,
    belongingTags: belongingTagsJson
      ? (JSON.parse(belongingTagsJson) as string[])
      : [],
    compositeKey,
    created_at_ms,
    storedAt,
    timelineTypes: timelineTypesJson
      ? (JSON.parse(timelineTypesJson) as TimelineType[])
      : [],
  }
}

/** timelineTypes / belongingTags を集約するサブクエリ（SELECT 句に埋め込む） */
const TIMELINE_TYPES_SUBQUERY =
  '(SELECT json_group_array(timelineType) FROM statuses_timeline_types WHERE compositeKey = s.compositeKey) AS timelineTypes'
const BELONGING_TAGS_SUBQUERY =
  '(SELECT json_group_array(tag) FROM statuses_belonging_tags WHERE compositeKey = s.compositeKey) AS belongingTags'

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
  await handle.sendCommand({
    backendUrl,
    statusJson: JSON.stringify(status),
    tag,
    timelineType,
    type: 'upsertStatus',
  })
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
  await handle.sendCommand({
    backendUrl,
    statusesJson: statuses.map((s) => JSON.stringify(s)),
    tag,
    timelineType,
    type: 'bulkUpsertStatuses',
  })
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
  await handle.sendCommand({
    backendUrl,
    statusId,
    tag,
    timelineType,
    type: 'removeFromTimeline',
  })
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
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    sourceTimelineType,
    statusId,
    tag,
    type: 'handleDeleteEvent',
  })
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
  await handle.sendCommand({
    action,
    backendUrl,
    statusId,
    type: 'updateStatusAction',
    value,
  })
}

/**
 * Status 全体を更新（編集された投稿用）
 */
export async function updateStatus(
  status: Entity.Status,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusJson: JSON.stringify(status),
    type: 'updateStatus',
  })
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

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
             s.created_at_ms, s.storedAt, s.json,
             ${TIMELINE_TYPES_SUBQUERY},
             ${BELONGING_TAGS_SUBQUERY}
      FROM statuses s
      INNER JOIN statuses_timeline_types stt
        ON s.compositeKey = stt.compositeKey
      INNER JOIN statuses_backends sb
        ON s.compositeKey = sb.compositeKey
      WHERE stt.timelineType = ?
        AND sb.backendUrl IN (${placeholders})
      GROUP BY s.compositeKey
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(timelineType, ...backendUrls, limit ?? MAX_QUERY_LIMIT)
  } else {
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json,
             ${TIMELINE_TYPES_SUBQUERY},
             ${BELONGING_TAGS_SUBQUERY}
      FROM statuses s
      INNER JOIN statuses_timeline_types stt
        ON s.compositeKey = stt.compositeKey
      WHERE stt.timelineType = ?
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(timelineType, limit ?? MAX_QUERY_LIMIT)
  }

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
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

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
             s.created_at_ms, s.storedAt, s.json,
             ${TIMELINE_TYPES_SUBQUERY},
             ${BELONGING_TAGS_SUBQUERY}
      FROM statuses s
      INNER JOIN statuses_belonging_tags sbt
        ON s.compositeKey = sbt.compositeKey
      INNER JOIN statuses_backends sb
        ON s.compositeKey = sb.compositeKey
      WHERE sbt.tag = ?
        AND sb.backendUrl IN (${placeholders})
      GROUP BY s.compositeKey
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(tag, ...backendUrls, limit ?? MAX_QUERY_LIMIT)
  } else {
    sql = `
      SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json,
             ${TIMELINE_TYPES_SUBQUERY},
             ${BELONGING_TAGS_SUBQUERY}
      FROM statuses s
      INNER JOIN statuses_belonging_tags sbt
        ON s.compositeKey = sbt.compositeKey
      WHERE sbt.tag = ?
      ORDER BY s.created_at_ms DESC
      LIMIT ?;
    `
    binds.push(tag, limit ?? MAX_QUERY_LIMIT)
  }

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
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

  // SQLコメントを拒否（後続条件のコメントアウト防止）
  if (/--/.test(input) || /\/\*/.test(input)) {
    throw new Error(
      'Custom query contains SQL comments (-- or /* */). Comments are not allowed.',
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

  const sanitized = sanitizeWhereClause(whereClause)

  // WHERE 句で参照されているテーブルのみ JOIN する（不要な JOIN を除外）
  const refs = detectReferencedAliases(sanitized)
  const needSb = refs.sb || (backendUrls != null && backendUrls.length > 0)

  const joinLines: string[] = []
  if (refs.stt)
    joinLines.push(
      'LEFT JOIN statuses_timeline_types stt\n      ON s.compositeKey = stt.compositeKey',
    )
  if (refs.sbt)
    joinLines.push(
      'LEFT JOIN statuses_belonging_tags sbt\n      ON s.compositeKey = sbt.compositeKey',
    )
  if (refs.sm)
    joinLines.push(
      'LEFT JOIN statuses_mentions sm\n      ON s.compositeKey = sm.compositeKey',
    )
  if (needSb)
    joinLines.push(
      'LEFT JOIN statuses_backends sb\n      ON s.compositeKey = sb.compositeKey',
    )
  if (refs.sr)
    joinLines.push(
      'LEFT JOIN statuses_reblogs sr\n      ON s.compositeKey = sr.compositeKey',
    )

  const hasMultiRowJoin = refs.stt || refs.sbt || refs.sm || needSb
  const backendSelect = needSb
    ? 'MIN(sb.backendUrl) AS backendUrl'
    : 's.backendUrl'

  let backendFilter = ''
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    backendFilter = `AND sb.backendUrl IN (${placeholders})`
    binds.push(...backendUrls)
  }

  const joinsClause =
    joinLines.length > 0 ? `\n    ${joinLines.join('\n    ')}` : ''

  const sql = `
    SELECT s.compositeKey, ${backendSelect},
           s.created_at_ms, s.storedAt, s.json,
           ${TIMELINE_TYPES_SUBQUERY},
           ${BELONGING_TAGS_SUBQUERY}
    FROM statuses s${joinsClause}
    WHERE (${sanitized || '1=1'})
      ${backendFilter}${hasMultiRowJoin ? '\n    GROUP BY s.compositeKey' : ''}
    ORDER BY s.created_at_ms DESC
    LIMIT ?
    OFFSET ?;
  `
  binds.push(limit ?? MAX_QUERY_LIMIT, offset ?? 0)

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number | null)[][]

  return rows.map(rowToStoredStatus)
}

/**
 * テーブルカラム / エイリアス一覧（補完用）
 */
export const QUERY_COMPLETIONS = {
  aliases: ['s', 'stt', 'sbt', 'sm', 'sb', 'sr', 'n'],
  columns: {
    n: [
      'compositeKey',
      'backendUrl',
      'created_at_ms',
      'storedAt',
      'notification_type',
      'status_id',
      'account_acct',
      'json',
    ],
    s: [
      'compositeKey',
      'backendUrl',
      'created_at_ms',
      'storedAt',
      'uri',
      'account_acct',
      'account_id',
      'visibility',
      'language',
      'has_media',
      'media_count',
      'is_reblog',
      'reblog_of_id',
      'reblog_of_uri',
      'is_sensitive',
      'has_spoiler',
      'in_reply_to_id',
      'favourites_count',
      'reblogs_count',
      'replies_count',
      'json',
    ],
    sb: ['compositeKey', 'backendUrl', 'local_id'],
    sbt: ['compositeKey', 'tag'],
    sm: ['compositeKey', 'acct'],
    sr: ['compositeKey', 'original_uri', 'reblogger_acct', 'reblogged_at_ms'],
    stt: ['compositeKey', 'timelineType'],
  },
  examples: [
    {
      description: '特定ユーザーの投稿を取得する',
      query: "s.account_acct = 'user@example.com'",
    },
    {
      description: '添付メディアが存在する投稿を取得する',
      query: 's.has_media = 1',
    },
    {
      description: 'メディアが2枚以上ある投稿を取得する',
      query: 's.media_count >= 2',
    },
    {
      description: 'ブーストされた投稿を取得する',
      query: 's.is_reblog = 1',
    },
    {
      description: 'ブーストを除外する',
      query: 's.is_reblog = 0',
    },
    {
      description: 'CW（Content Warning）付きの投稿を取得する',
      query: 's.has_spoiler = 1',
    },
    {
      description: 'リプライを除外する',
      query: 's.in_reply_to_id IS NULL',
    },
    {
      description: '日本語の投稿のみ取得する',
      query: "s.language = 'ja'",
    },
    {
      description: '公開投稿のみ取得する',
      query: "s.visibility = 'public'",
    },
    {
      description: '未収載を含む公開投稿を取得する',
      query: "s.visibility IN ('public', 'unlisted')",
    },
    {
      description: 'ふぁぼ数が10以上の投稿を取得する',
      query: 's.favourites_count >= 10',
    },
    {
      description: '特定ユーザーへのメンションを含む投稿を取得する',
      query: "sm.acct = 'user@example.com'",
    },
    {
      description: 'ホームタイムラインを取得する',
      query: "stt.timelineType = 'home'",
    },
    {
      description: '指定タグの投稿を取得する',
      query: "sbt.tag = 'photo'",
    },
    {
      description: 'ローカルタイムラインで特定タグの投稿を取得する',
      query: "stt.timelineType = 'local' AND sbt.tag = 'music'",
    },
    {
      description: 'フォロー通知のみ取得する',
      query: "n.notification_type = 'follow'",
    },
    {
      description: 'メンション通知のみ取得する',
      query: "n.notification_type = 'mention'",
    },
    {
      description: 'お気に入りとブースト通知を取得する',
      query: "n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description: '特定ユーザーからの通知を取得する',
      query: "n.account_acct = 'user@example.com'",
    },
    {
      description:
        'ホームタイムラインとお気に入り・ブースト通知を一緒に表示する',
      query:
        "stt.timelineType = 'home' OR n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description:
        'ふぁぼ・リアクション・ブースト通知と通知元ユーザーの直後の1投稿(3分以内)をまとめて表示する',
      query:
        "n.notification_type IN ('favourite', 'reaction', 'reblog') OR EXISTS (SELECT 1 FROM notifications ntf WHERE ntf.notification_type IN ('favourite', 'reaction', 'reblog') AND ntf.account_acct = s.account_acct AND s.created_at_ms > ntf.created_at_ms AND s.created_at_ms <= ntf.created_at_ms + 180000 AND s.created_at_ms = (SELECT MIN(s2.created_at_ms) FROM statuses s2 WHERE s2.account_acct = ntf.account_acct AND s2.created_at_ms > ntf.created_at_ms AND s2.created_at_ms <= ntf.created_at_ms + 180000))",
    },
    {
      description: '特定ユーザーがリブログした投稿を取得する',
      query: "sr.reblogger_acct = 'user@example.com'",
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

    // クエリが参照するテーブルに基づいて検証クエリを構築
    const isMixed = isMixedQuery(sanitized)
    const isNotifQuery = !isMixed && isNotificationQuery(sanitized)

    let sql: string
    if (isMixed) {
      // 混合クエリ: statuses + notifications の両テーブルを UNION で検証
      // WHERE 句が両テーブルのカラムを参照するため、個別の SELECT で EXPLAIN する
      sql = `
        EXPLAIN
        SELECT compositeKey FROM (
          SELECT s.compositeKey, s.created_at_ms
          FROM statuses s
          LEFT JOIN statuses_timeline_types stt
            ON s.compositeKey = stt.compositeKey
          LEFT JOIN statuses_belonging_tags sbt
            ON s.compositeKey = sbt.compositeKey
          LEFT JOIN statuses_mentions sm
            ON s.compositeKey = sm.compositeKey
          LEFT JOIN statuses_backends sb
            ON s.compositeKey = sb.compositeKey
          LEFT JOIN statuses_reblogs sr
            ON s.compositeKey = sr.compositeKey
          -- Dummy join: n.* columns resolve to NULL so mixed WHERE clause passes
          LEFT JOIN notifications n
            ON 0 = 1
          WHERE (${sanitized})
          UNION ALL
          SELECT n.compositeKey, n.created_at_ms
          FROM notifications n
          -- Dummy joins: s.*/stt.*/sbt.*/sm.*/sb.*/sr.* columns resolve to NULL
          LEFT JOIN statuses s
            ON 0 = 1
          LEFT JOIN statuses_timeline_types stt
            ON 0 = 1
          LEFT JOIN statuses_belonging_tags sbt
            ON 0 = 1
          LEFT JOIN statuses_mentions sm
            ON 0 = 1
          LEFT JOIN statuses_backends sb
            ON 0 = 1
          LEFT JOIN statuses_reblogs sr
            ON 0 = 1
          WHERE (${sanitized})
        )
        LIMIT 1;
      `
    } else if (isNotifQuery) {
      // notifications テーブル対象のクエリ
      sql = `
        EXPLAIN
        SELECT DISTINCT n.compositeKey
        FROM notifications n
        WHERE (${sanitized})
        LIMIT 1;
      `
    } else {
      // statuses テーブル対象のクエリ（v3: statuses_backends, v5: statuses_reblogs も LEFT JOIN）
      sql = `
        EXPLAIN
        SELECT DISTINCT s.compositeKey
        FROM statuses s
        LEFT JOIN statuses_timeline_types stt
          ON s.compositeKey = stt.compositeKey
        LEFT JOIN statuses_belonging_tags sbt
          ON s.compositeKey = sbt.compositeKey
        LEFT JOIN statuses_mentions sm
          ON s.compositeKey = sm.compositeKey
        LEFT JOIN statuses_backends sb
          ON s.compositeKey = sb.compositeKey
        LEFT JOIN statuses_reblogs sr
          ON s.compositeKey = sr.compositeKey
        WHERE (${sanitized})
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

/**
 * DB に保存されている全タグ名を取得する（補完用）
 */
export async function getDistinctTags(): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      'SELECT DISTINCT tag FROM statuses_belonging_tags ORDER BY tag;',
      { returnValue: 'resultRows' },
    )) as string[][]
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
    const rows = (await handle.execAsync(
      'SELECT DISTINCT timelineType FROM statuses_timeline_types ORDER BY timelineType;',
      { returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * サンプル Status の JSON から全キーパスを再帰的に抽出する（補完用）
 *
 * 最新 N 件の Status JSON をパースし、存在するすべてのキーパスを
 * `$.key.subkey` 形式で返す。
 */
export async function getJsonKeysFromSample(
  sampleSize = 10,
): Promise<string[]> {
  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      `SELECT json FROM statuses ORDER BY created_at_ms DESC LIMIT ?;`,
      { bind: [sampleSize], returnValue: 'resultRows' },
    )) as string[][]

    const paths = new Set<string>()

    for (const row of rows) {
      try {
        const obj = JSON.parse(row[0]) as Record<string, unknown>
        collectJsonPaths(obj, '$', paths)
      } catch {
        // skip malformed JSON
      }
    }

    return Array.from(paths).sort()
  } catch {
    return []
  }
}

/** JSON オブジェクトからキーパスを再帰収集するヘルパー（最大深度 4） */
function collectJsonPaths(
  obj: unknown,
  prefix: string,
  paths: Set<string>,
  depth = 0,
): void {
  if (depth > 4 || obj == null) return

  if (Array.isArray(obj)) {
    paths.add(prefix)
    // 配列の最初の要素だけ探索（構造サンプリング）
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      collectJsonPaths(obj[0], `${prefix}[0]`, paths, depth + 1)
    }
    return
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const childPath = `${prefix}.${key}`
      const child = (obj as Record<string, unknown>)[key]
      paths.add(childPath)
      if (typeof child === 'object' && child !== null) {
        collectJsonPaths(child, childPath, paths, depth + 1)
      }
    }
    return
  }

  // プリミティブ値は末端パスとして追加済み
}

/**
 * 指定した JSON パスの値を DB からサンプル取得する（補完用）
 *
 * json_extract で値を抽出し、DISTINCT で重複排除。
 * 文字列値のみ返す（数値・null・配列/オブジェクトは除外）。
 */
export async function getDistinctJsonValues(
  jsonPath: string,
  maxResults = 20,
): Promise<string[]> {
  try {
    const handle = await getSqliteDb()

    // パスのバリデーション: $. で始まり、正しいJSONパス構文のみ許可
    // [N] (配列アクセス)、.key (オブジェクトキー) のみ許可。連続ドットや不正ブラケットを拒否
    if (!/^\$(\.[a-zA-Z_]\w*|\[\d+\])*$/.test(jsonPath)) return []

    const rows = (await handle.execAsync(
      `WITH vals AS (
         SELECT json_extract(json, ?) AS val
         FROM statuses
       )
       SELECT DISTINCT val
       FROM vals
       WHERE val IS NOT NULL AND typeof(val) = 'text' AND val != '' AND val != '[]'
       ORDER BY val
       LIMIT ?;`,
      { bind: [jsonPath, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値を DB から取得する（補完用）
 *
 * statuses テーブルの backendUrl 等の値を返す。
 */
/** 許可リスト（安全なテーブル＋カラムの組み合わせ） */
const ALLOWED_COLUMN_VALUES: Record<string, string[]> = {
  notifications: [
    'backendUrl',
    'notification_type',
    'status_id',
    'account_acct',
  ],
  statuses: [
    'backendUrl',
    'uri',
    'account_acct',
    'account_id',
    'visibility',
    'language',
  ],
  statuses_backends: ['backendUrl', 'local_id'],
  statuses_belonging_tags: ['tag'],
  statuses_mentions: ['acct'],
  statuses_reblogs: ['original_uri', 'reblogger_acct'],
  statuses_timeline_types: ['timelineType'],
}

/** エイリアスからテーブル名・カラム名へのマッピング */
export const ALIAS_TO_TABLE: Record<
  string,
  { table: string; columns: Record<string, string> }
> = {
  n: {
    columns: {
      account_acct: 'account_acct',
      backendUrl: 'backendUrl',
      notification_type: 'notification_type',
      status_id: 'status_id',
    },
    table: 'notifications',
  },
  s: {
    columns: {
      account_acct: 'account_acct',
      account_id: 'account_id',
      backendUrl: 'backendUrl',
      language: 'language',
      uri: 'uri',
      visibility: 'visibility',
    },
    table: 'statuses',
  },
  sb: {
    columns: {
      backendUrl: 'backendUrl',
      local_id: 'local_id',
    },
    table: 'statuses_backends',
  },
  sbt: {
    columns: {
      tag: 'tag',
    },
    table: 'statuses_belonging_tags',
  },
  sm: {
    columns: {
      acct: 'acct',
    },
    table: 'statuses_mentions',
  },
  sr: {
    columns: {
      original_uri: 'original_uri',
      reblogger_acct: 'reblogger_acct',
    },
    table: 'statuses_reblogs',
  },
  stt: {
    columns: {
      timelineType: 'timelineType',
    },
    table: 'statuses_timeline_types',
  },
}

export async function getDistinctColumnValues(
  table: string,
  column: string,
  maxResults = 20,
): Promise<string[]> {
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(column)) return []

  try {
    const handle = await getSqliteDb()
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${column}" FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != '' ORDER BY "${column}" LIMIT ?;`,
      { bind: [maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}

/**
 * 指定したテーブル・カラムの値をプレフィクス検索で取得する（補完用）
 *
 * エイリアス (s, sbt, sm 等) とカラム名から実テーブルを解決し、
 * 入力中のプレフィクスに一致する値を DB から検索して返す。
 */
export async function searchDistinctColumnValues(
  alias: string,
  column: string,
  prefix: string,
  maxResults = 20,
): Promise<string[]> {
  const mapping = ALIAS_TO_TABLE[alias]
  if (!mapping) return []
  const realColumn = mapping.columns[column]
  if (!realColumn) return []
  const { table } = mapping
  if (!ALLOWED_COLUMN_VALUES[table]?.includes(realColumn)) return []

  try {
    const handle = await getSqliteDb()
    // LIKE でプレフィクスフィルタ（ESCAPE でワイルドカード文字を安全にエスケープ）
    const escaped = prefix.replace(/[%_\\]/g, (c) => `\\${c}`)
    const rows = (await handle.execAsync(
      `SELECT DISTINCT "${realColumn}" FROM "${table}" WHERE "${realColumn}" IS NOT NULL AND "${realColumn}" != '' AND "${realColumn}" LIKE ? ESCAPE '\\' ORDER BY "${realColumn}" LIMIT ?;`,
      { bind: [`${escaped}%`, maxResults], returnValue: 'resultRows' },
    )) as string[][]
    return rows.map((r) => r[0])
  } catch {
    return []
  }
}
