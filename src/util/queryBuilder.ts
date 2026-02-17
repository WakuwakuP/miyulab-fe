import type { TagConfig, TimelineConfigV2 } from 'types/types'

/** 許可された timelineType 値のホワイトリスト */
const VALID_TIMELINE_TYPES = new Set(['home', 'local', 'public'])

/**
 * TimelineConfigV2 の UI 設定から SQL WHERE 句を構築する
 *
 * 通常の設定UIをクエリビルダとして機能させるための関数。
 * type, tagConfig, onlyMedia 等の設定を対応する SQL 条件に変換する。
 *
 * backendUrl フィルタは実行時に自動付与されるためクエリには含めない。
 */
export function buildQueryFromConfig(config: TimelineConfigV2): string {
  const conditions: string[] = []

  // タイムライン種類
  if (config.type === 'tag') {
    // tag タイプはタグ条件で表現
    const tagConfig = config.tagConfig
    if (tagConfig && tagConfig.tags.length > 0) {
      conditions.push(buildTagCondition(tagConfig))
    }
  } else if (VALID_TIMELINE_TYPES.has(config.type)) {
    // home / local / public (ホワイトリスト検証済み)
    conditions.push(`stt.timelineType = '${config.type}'`)
  }

  // onlyMedia
  if (config.onlyMedia) {
    conditions.push("json_extract(s.json, '$.media_attachments') != '[]'")
  }

  if (conditions.length === 0) return ''
  return conditions.join(' AND ')
}

/**
 * TagConfig から SQL 条件を構築する
 */
function buildTagCondition(tagConfig: TagConfig): string {
  const { mode, tags } = tagConfig

  if (tags.length === 0) return ''
  if (tags.length === 1) {
    return `sbt.tag = '${escapeSqlString(tags[0])}'`
  }

  const tagList = tags.map((t) => `'${escapeSqlString(t)}'`).join(', ')

  if (mode === 'or') {
    return `sbt.tag IN (${tagList})`
  }

  // AND mode: 全タグを含む投稿のみ (GROUP BY + HAVING は WHERE 句内では表現不可)
  // サブクエリで表現する
  return `s.compositeKey IN (
    SELECT sbt_inner.compositeKey
    FROM statuses_belonging_tags sbt_inner
    WHERE sbt_inner.tag IN (${tagList})
    GROUP BY sbt_inner.compositeKey
    HAVING COUNT(DISTINCT sbt_inner.tag) = ${tags.length}
  )`
}

/**
 * SQL 文字列リテラル内の単純なエスケープ
 */
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * クエリ文字列から TimelineConfigV2 の UI 設定を逆算する（ベストエフォート）
 *
 * Advanced Query → 通常 UI に切り替えた際に、
 * 手編集されたクエリから可能な範囲で UI 状態を復元する。
 * 完全なパースは不要 — 認識できない場合は null を返す。
 *
 * type は変更しない（タイムラインの種類は固定値のため）。
 * onlyMedia, tagConfig のみ逆算対象。
 */
export function parseQueryToConfig(
  query: string,
): Partial<TimelineConfigV2> | null {
  if (!query.trim()) return null

  const result: Partial<TimelineConfigV2> = {}

  // onlyMedia の検出
  if (query.includes("json_extract(s.json, '$.media_attachments') != '[]'")) {
    result.onlyMedia = true
  }

  // タグ条件の検出
  const singleTagMatch = query.match(/sbt\.tag\s*=\s*'([^']+)'/i)
  const multiTagMatch = query.match(
    /sbt\.tag\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i,
  )
  const andTagMatch = query.match(
    /HAVING\s+COUNT\s*\(\s*DISTINCT\s+\w+\.tag\s*\)\s*=\s*(\d+)/i,
  )

  if (singleTagMatch) {
    result.tagConfig = {
      mode: 'or',
      tags: [singleTagMatch[1]],
    }
  } else if (multiTagMatch) {
    const tags = multiTagMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    const mode = andTagMatch ? 'and' : 'or'
    result.tagConfig = { mode, tags }
  }

  return Object.keys(result).length > 0 ? result : null
}
