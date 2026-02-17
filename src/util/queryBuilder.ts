import type { BackendFilter, TagConfig, TimelineConfigV2 } from 'types/types'

/**
 * TimelineConfigV2 の UI 設定から SQL WHERE 句を構築する
 *
 * 通常の設定UIをクエリビルダとして機能させるための関数。
 * type, tagConfig, onlyMedia, backendFilter 等の設定を対応する SQL 条件に変換する。
 *
 * backendFilter もクエリに含めることで、Advanced Query モードでも
 * ユーザーがバックエンド条件を確認・編集できるようにする。
 *
 * @param config タイムライン設定
 * @param allBackendUrls 全登録アカウントの backendUrl 配列（backendFilter 'all' 時に使用）
 */
export function buildQueryFromConfig(
  config: TimelineConfigV2,
  allBackendUrls?: string[],
): string {
  const conditions: string[] = []

  // バックエンドフィルタ
  const backendCondition = buildBackendFilterCondition(
    config.backendFilter,
    allBackendUrls,
  )
  if (backendCondition) {
    conditions.push(backendCondition)
  }

  // タイムライン種類
  if (config.type === 'tag') {
    // tag タイプはタグ条件で表現
    const tagConfig = config.tagConfig
    if (tagConfig && tagConfig.tags.length > 0) {
      conditions.push(buildTagCondition(tagConfig))
    }
  } else if (config.type === 'home') {
    conditions.push("stt.timelineType = 'home'")
  } else if (config.type === 'local') {
    conditions.push("stt.timelineType = 'local'")
  } else if (config.type === 'public') {
    conditions.push("stt.timelineType = 'public'")
  }

  // onlyMedia
  if (config.onlyMedia) {
    conditions.push("json_extract(s.json, '$.media_attachments') != '[]'")
  }

  if (conditions.length === 0) return ''
  return conditions.join(' AND ')
}

/**
 * BackendFilter から SQL 条件を構築する
 *
 * - 'all' / undefined: 条件なし（全バックエンド対象）
 * - 'single': `s.backendUrl = '...'`
 * - 'composite': `s.backendUrl IN ('...', '...')`
 */
function buildBackendFilterCondition(
  filter: BackendFilter | undefined,
  allBackendUrls?: string[],
): string {
  if (!filter || filter.mode === 'all') {
    // 'all' でも全 URL が既知なら明示的に列挙する（クエリの透明性のため）
    if (allBackendUrls && allBackendUrls.length > 0) {
      if (allBackendUrls.length === 1) {
        return `s.backendUrl = '${escapeSqlString(allBackendUrls[0])}'`
      }
      const urlList = allBackendUrls
        .map((u) => `'${escapeSqlString(u)}'`)
        .join(', ')
      return `s.backendUrl IN (${urlList})`
    }
    return ''
  }

  switch (filter.mode) {
    case 'single':
      return `s.backendUrl = '${escapeSqlString(filter.backendUrl)}'`
    case 'composite': {
      const urlList = filter.backendUrls
        .map((u) => `'${escapeSqlString(u)}'`)
        .join(', ')
      return `s.backendUrl IN (${urlList})`
    }
  }
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
 * onlyMedia, tagConfig, backendFilter を逆算対象とする。
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

  // backendFilter の検出
  const backendFilter = parseBackendFilter(query)
  if (backendFilter) {
    result.backendFilter = backendFilter
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
      tags: [singleTagMatch[1].replace(/''/g, "'")],
    }
  } else if (multiTagMatch) {
    const tags = multiTagMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
      .filter(Boolean)
    const mode = andTagMatch ? 'and' : 'or'
    result.tagConfig = { mode, tags }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * クエリ文字列から BackendFilter を逆算する（ベストエフォート）
 *
 * - `s.backendUrl = '...'` → single
 * - `s.backendUrl IN ('...', '...')` → composite（2つ以上）/ single（1つ）
 * - 条件なし → null（判定不能）
 */
function parseBackendFilter(query: string): BackendFilter | null {
  // single: s.backendUrl = '...'
  const singleMatch = query.match(/s\.backendUrl\s*=\s*'((?:''|[^'])+)'/i)
  if (singleMatch) {
    return {
      backendUrl: singleMatch[1].replace(/''/g, "'"),
      mode: 'single',
    }
  }

  // composite / single: s.backendUrl IN ('...', '...')
  // まず IN (...) の括弧内をキャプチャし、個別の URL は split で抽出する
  const inMatch = query.match(/s\.backendUrl\s+IN\s*\(([^)]+)\)/i)
  if (inMatch) {
    // 括弧内の文字列を '...' パターンで個別抽出
    const urlMatches = inMatch[1].match(/'(?:''|[^'])*'/g)
    if (urlMatches) {
      const urls = urlMatches
        .map((u) => u.replace(/^'|'$/g, '').replace(/''/g, "'"))
        .filter(Boolean)
      if (urls.length === 1) {
        return { backendUrl: urls[0], mode: 'single' }
      }
      if (urls.length > 1) {
        return { backendUrls: urls, mode: 'composite' }
      }
    }
  }

  return null
}
