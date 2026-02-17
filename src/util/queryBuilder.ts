import type {
  AccountFilter,
  BackendFilter,
  NotificationType,
  TagConfig,
  TimelineConfigV2,
  VisibilityType,
} from 'types/types'

/**
 * TimelineConfigV2 の UI 設定から SQL WHERE 句を構築する
 *
 * 通常の設定UIをクエリビルダとして機能させるための関数。
 * type, tagConfig, onlyMedia 等の設定を対応する SQL 条件に変換する。
 *
 * ## v2 スキーマ対応
 *
 * 正規化カラムが利用可能になったことで、以下の変更を行う:
 * - onlyMedia: json_extract → s.has_media = 1
 * - 新規フィルタ: 正規化カラムを直接参照する SQL 条件を生成
 *
 * backendUrl フィルタは Advanced Query モード時にクエリに含める。
 * applyMuteFilter / applyInstanceBlock はサブクエリを含むため、
 * Hook 側で別途追加する（クエリ文字列には含めない）。
 */
export function buildQueryFromConfig(config: TimelineConfigV2): string {
  const conditions: string[] = []

  // ========================================
  // タイムライン種類（既存ロジック）
  // ========================================
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

  // ========================================
  // メディアフィルタ（v2: 正規化カラム使用）
  // ========================================
  const mediaCondition = buildMediaCondition(config)
  if (mediaCondition) {
    conditions.push(mediaCondition)
  }

  // ========================================
  // 新規フィルタ条件
  // ========================================

  // 公開範囲フィルタ
  const visibilityCondition = buildVisibilityCondition(config.visibilityFilter)
  if (visibilityCondition) {
    conditions.push(visibilityCondition)
  }

  // 言語フィルタ
  const languageCondition = buildLanguageCondition(config.languageFilter)
  if (languageCondition) {
    conditions.push(languageCondition)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    conditions.push('s.is_reblog = 0')
  }

  // リプライ除外
  if (config.excludeReplies) {
    conditions.push('s.in_reply_to_id IS NULL')
  }

  // CW 付き除外
  if (config.excludeSpoiler) {
    conditions.push('s.has_spoiler = 0')
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    conditions.push('s.is_sensitive = 0')
  }

  // アカウントフィルタ
  const accountCondition = buildAccountCondition(config.accountFilter)
  if (accountCondition) {
    conditions.push(accountCondition)
  }

  // 通知タイプフィルタ
  const notificationCondition = buildNotificationTypeCondition(
    config.notificationFilter,
  )
  if (notificationCondition) {
    conditions.push(notificationCondition)
  }

  // バックエンドフィルタ
  const backendCondition = buildBackendFilterCondition(config.backendFilter)
  if (backendCondition) {
    conditions.push(backendCondition)
  }

  if (conditions.length === 0) return ''
  return conditions.join(' AND ')
}

/**
 * メディアフィルタ条件を構築する
 *
 * minMediaCount が設定されている場合は media_count で判定する。
 * onlyMedia のみの場合は has_media で判定する（インデックス効率が高い）。
 *
 * ## v1 → v2 の変更点
 *
 * v1: json_extract(s.json, '$.media_attachments') != '[]'
 * v2: s.has_media = 1 または s.media_count >= N
 */
function buildMediaCondition(config: TimelineConfigV2): string | null {
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    return `s.media_count >= ${Math.floor(config.minMediaCount)}`
  }
  if (config.onlyMedia) {
    return 's.has_media = 1'
  }
  return null
}

/**
 * 公開範囲フィルタ条件を構築する
 *
 * 未指定・空配列の場合は null を返す（フィルタなし）。
 * 指定された公開範囲のみを IN 句で表現する。
 *
 * @example
 * buildVisibilityCondition(['public', 'unlisted'])
 * // → "s.visibility IN ('public','unlisted')"
 */
function buildVisibilityCondition(
  filter: VisibilityType[] | undefined,
): string | null {
  if (filter == null || filter.length === 0) return null

  // 全公開範囲が指定されている場合はフィルタ不要
  if (filter.length >= 4) return null

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `s.visibility IN (${escaped})`
}

/**
 * 言語フィルタ条件を構築する
 *
 * 未指定・空配列の場合は null を返す（フィルタなし）。
 * 指定された言語コードを IN 句で表現する。
 *
 * 言語が NULL（未設定）の投稿は常に表示する。
 * これは、古いサーバーや一部の Fediverse 実装では
 * 言語情報が設定されない場合があるためである。
 *
 * @example
 * buildLanguageCondition(['ja', 'en'])
 * // → "(s.language IN ('ja','en') OR s.language IS NULL)"
 */
function buildLanguageCondition(filter: string[] | undefined): string | null {
  if (filter == null || filter.length === 0) return null

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `(s.language IN (${escaped}) OR s.language IS NULL)`
}

/**
 * アカウントフィルタ条件を構築する
 *
 * include モード: 指定アカウントの投稿のみ表示
 * exclude モード: 指定アカウントの投稿を除外
 *
 * 未指定・空配列の場合は null を返す（フィルタなし）。
 *
 * @example
 * buildAccountCondition({ mode: 'include', accts: ['user@example.com'] })
 * // → "s.account_acct IN ('user@example.com')"
 *
 * buildAccountCondition({ mode: 'exclude', accts: ['spam@example.com'] })
 * // → "s.account_acct NOT IN ('spam@example.com')"
 */
function buildAccountCondition(
  filter: AccountFilter | undefined,
): string | null {
  if (filter == null || filter.accts.length === 0) return null

  const escaped = filter.accts.map((a) => `'${escapeSqlString(a)}'`).join(',')

  if (filter.mode === 'include') {
    return `s.account_acct IN (${escaped})`
  }
  return `s.account_acct NOT IN (${escaped})`
}

/**
 * 通知タイプフィルタ条件を構築する
 *
 * 通知テーブルの notification_type カラムを使用して
 * 指定された通知タイプのみを表示する IN 句を生成する。
 *
 * @example
 * buildNotificationTypeCondition(['follow', 'favourite'])
 * // → "n.notification_type IN ('follow','favourite')"
 */
function buildNotificationTypeCondition(
  filter: NotificationType[] | undefined,
): string | null {
  if (filter == null || filter.length === 0) return null

  // 全タイプが指定されている場合はフィルタ不要
  // NotificationType は 8 種類: follow, follow_request, mention, reblog, favourite, reaction, poll_expired, status
  if (filter.length >= 8) return null

  const escaped = filter.map((t) => `'${escapeSqlString(t)}'`).join(',')
  return `n.notification_type IN (${escaped})`
}

/**
 * バックエンドフィルタ条件を構築する
 *
 * v3: statuses_backends テーブル（エイリアス sb）経由で参照する。
 *
 * - mode: 'all' → 条件なし（全バックエンド対象）
 * - mode: 'single' → sb.backendUrl = 'xxx'
 * - mode: 'composite' → sb.backendUrl IN ('xxx', 'yyy')
 */
function buildBackendFilterCondition(
  filter: BackendFilter | undefined,
): string | null {
  if (!filter || filter.mode === 'all') return null

  if (filter.mode === 'single') {
    return `sb.backendUrl = '${escapeSqlString(filter.backendUrl)}'`
  }

  if (filter.mode === 'composite' && filter.backendUrls.length > 0) {
    const escaped = filter.backendUrls
      .map((url) => `'${escapeSqlString(url)}'`)
      .join(', ')
    return `sb.backendUrl IN (${escaped})`
  }

  return null
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

// ================================================================
// ミュート・インスタンスブロック条件
// ================================================================

/**
 * ミュートアカウント除外の SQL 条件を構築する
 *
 * Hook 側の WHERE 句に動的に追加するための関数。
 * backendUrl ごとにミュートリストが異なるため、
 * backendUrls をパラメータとして受け取る。
 *
 * @returns SQL 条件文字列とバインド変数の配列
 *
 * @example
 * const { sql, binds } = buildMuteCondition(['https://mastodon.social'])
 * // sql:   "s.account_acct NOT IN (SELECT account_acct FROM muted_accounts WHERE backendUrl IN (?))"
 * // binds: ['https://mastodon.social']
 */
export function buildMuteCondition(backendUrls: string[]): {
  sql: string
  binds: string[]
} {
  if (backendUrls.length === 0) {
    return { binds: [], sql: '1=1' }
  }

  const placeholders = backendUrls.map(() => '?').join(',')
  return {
    binds: [...backendUrls],
    sql: `s.account_acct NOT IN (
      SELECT account_acct FROM muted_accounts WHERE backendUrl IN (${placeholders})
    )`,
  }
}

/**
 * インスタンスブロック除外の SQL 条件を構築する
 *
 * blocked_instances テーブルが空の場合でもクエリは高速に実行される（空テーブルの EXISTS は即座に false）。
 *
 * @returns SQL 条件文字列（バインド変数なし、静的サブクエリ）
 *
 * @example
 * const sql = buildInstanceBlockCondition()
 * // → "NOT EXISTS (SELECT 1 FROM blocked_instances bi WHERE s.account_acct LIKE '%@' || bi.instance_domain)"
 */
export function buildInstanceBlockCondition(): string {
  return `NOT EXISTS (
    SELECT 1 FROM blocked_instances bi
    WHERE s.account_acct LIKE '%@' || REPLACE(REPLACE(bi.instance_domain, '%', '\\%'), '_', '\\_') ESCAPE '\\'
  )`
}

// ================================================================
// クエリ逆算（パーサー）
// ================================================================

/**
 * クエリ文字列から TimelineConfigV2 の UI 設定を逆算する（ベストエフォート）
 *
 * Advanced Query → 通常 UI に切り替えた際に、
 * 手編集されたクエリから可能な範囲で UI 状態を復元する。
 * 完全なパースは不要 — 認識できない場合は null を返す。
 *
 * type は変更しない（タイムラインの種類は固定値のため）。
 *
 * ## v2 スキーマ対応
 *
 * v1 形式（json_extract ベース）と v2 形式（正規化カラムベース）の
 * 両方を認識する。
 */
export function parseQueryToConfig(
  query: string,
): Partial<TimelineConfigV2> | null {
  if (!query.trim()) return null

  const result: Partial<TimelineConfigV2> = {}

  // ========================================
  // onlyMedia の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes("json_extract(s.json, '$.media_attachments') != '[]'") ||
    query.includes('s.has_media = 1')
  ) {
    result.onlyMedia = true
  }

  // ========================================
  // minMediaCount の検出
  // ========================================
  const mediaCountMatch = query.match(/s\.media_count\s*>=\s*(\d+)/i)
  if (mediaCountMatch) {
    const count = parseInt(mediaCountMatch[1], 10)
    if (count > 1) {
      result.minMediaCount = count
      // minMediaCount が設定されている場合は onlyMedia は不要
      delete result.onlyMedia
    } else if (count === 1) {
      result.onlyMedia = true
    }
  }

  // ========================================
  // visibilityFilter の検出
  // ========================================
  const visibilityMatch = query.match(
    /s\.visibility\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i,
  )
  if (visibilityMatch) {
    const visibilities = visibilityMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (visibilities.length > 0) {
      result.visibilityFilter =
        visibilities as TimelineConfigV2['visibilityFilter']
    }
  }

  // ========================================
  // languageFilter の検出
  // ========================================
  const languageMatch = query.match(
    /s\.language\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i,
  )
  if (languageMatch) {
    const languages = languageMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (languages.length > 0) {
      result.languageFilter = languages
    }
  }

  // ========================================
  // excludeReblogs の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes('s.is_reblog = 0') ||
    query.includes("json_extract(s.json, '$.reblog') IS NULL")
  ) {
    result.excludeReblogs = true
  }

  // ========================================
  // excludeReplies の検出
  // ========================================
  if (query.includes('s.in_reply_to_id IS NULL')) {
    result.excludeReplies = true
  }

  // ========================================
  // excludeSpoiler の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes('s.has_spoiler = 0') ||
    query.includes("json_extract(s.json, '$.spoiler_text') = ''")
  ) {
    result.excludeSpoiler = true
  }

  // ========================================
  // excludeSensitive の検出
  // ========================================
  if (query.includes('s.is_sensitive = 0')) {
    result.excludeSensitive = true
  }

  // ========================================
  // accountFilter の検出
  // ========================================
  const accountExcludeMatch = query.match(
    /s\.account_acct\s+NOT\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i,
  )
  const accountIncludeMatch = query.match(
    /s\.account_acct\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i,
  )

  if (accountExcludeMatch) {
    // NOT IN を先にチェック（IN のパターンにもマッチするため）
    const accts = accountExcludeMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'exclude' }
    }
  } else if (accountIncludeMatch) {
    const accts = accountIncludeMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'include' }
    }
  }

  // ========================================
  // backendFilter の検出
  // ========================================
  const backendSingleMatch =
    query.match(/sb\.backendUrl\s*=\s*'([^']+)'/i) ??
    query.match(/s\.backendUrl\s*=\s*'([^']+)'/i)
  const backendInMatch =
    query.match(/sb\.backendUrl\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i) ??
    query.match(/s\.backendUrl\s+IN\s*\(\s*((?:'[^']+'\s*,?\s*)+)\)/i)

  if (backendSingleMatch) {
    result.backendFilter = {
      backendUrl: backendSingleMatch[1].replace(/''/g, "'"),
      mode: 'single',
    }
  } else if (backendInMatch) {
    const urls = backendInMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
      .filter(Boolean)
    if (urls.length === 1) {
      result.backendFilter = { backendUrl: urls[0], mode: 'single' }
    } else if (urls.length > 1) {
      result.backendFilter = { backendUrls: urls.sort(), mode: 'composite' }
    }
  }

  // ========================================
  // タグ条件の検出（既存ロジック、変更なし）
  // ========================================
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

  // ========================================
  // 通知タイプフィルタの検出
  // ========================================
  const notificationTypeMatch = query.match(
    /n\.notification_type\s+IN\s*\(\s*([^)]+)\)/i,
  )
  if (notificationTypeMatch) {
    const types = notificationTypeMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (types.length > 0) {
      result.notificationFilter =
        types as TimelineConfigV2['notificationFilter']
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

// ================================================================
// v1 → v2 クエリ自動変換
// ================================================================

/**
 * カスタムクエリ内の v1 形式（json_extract）を v2 形式（正規化カラム）に変換する
 *
 * ベストエフォートで変換し、認識できないパターンはそのまま残す。
 * json_extract が完全に不要になるわけではなく、正規化カラムに存在しない
 * フィールド（$.content, $.url など）への json_extract は変換しない。
 *
 * @param query カスタムクエリ文字列
 * @returns 変換後のクエリ文字列
 */
export function upgradeQueryToV2(query: string): string {
  let result = query

  // v3: s.backendUrl → sb.backendUrl
  result = result.replace(/\bs\.backendUrl\b/g, 'sb.backendUrl')

  // メディア: json_extract(s.json, '$.media_attachments') != '[]'
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.media_attachments'\)\s*!=\s*'\[\]'/gi,
    's.has_media = 1',
  )

  // メディア枚数: json_array_length(json_extract(s.json, '$.media_attachments')) >= N
  result = result.replace(
    /json_array_length\(json_extract\(s\.json,\s*'\$\.media_attachments'\)\)\s*>=\s*(\d+)/gi,
    's.media_count >= $1',
  )

  // ブースト: json_extract(s.json, '$.reblog') IS NOT NULL
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.reblog'\)\s+IS\s+NOT\s+NULL/gi,
    's.is_reblog = 1',
  )

  // ブースト除外: json_extract(s.json, '$.reblog') IS NULL
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.reblog'\)\s+IS\s+NULL/gi,
    's.is_reblog = 0',
  )

  // CW: json_extract(s.json, '$.spoiler_text') != ''
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.spoiler_text'\)\s*!=\s*''/gi,
    's.has_spoiler = 1',
  )

  // CW除外: json_extract(s.json, '$.spoiler_text') = ''
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.spoiler_text'\)\s*=\s*''/gi,
    's.has_spoiler = 0',
  )

  // センシティブ: json_extract(s.json, '$.sensitive') = 1|0
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.sensitive'\)\s*=\s*(\d)/gi,
    's.is_sensitive = $1',
  )

  // 公開範囲: json_extract(s.json, '$.visibility') = 'X'
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.visibility'\)\s*=\s*'([^']+)'/gi,
    "s.visibility = '$1'",
  )

  // 言語: json_extract(s.json, '$.language') = 'X'
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.language'\)\s*=\s*'([^']+)'/gi,
    "s.language = '$1'",
  )

  // アカウント: json_extract(s.json, '$.account.acct') = 'X'
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.account\.acct'\)\s*=\s*'([^']+)'/gi,
    "s.account_acct = '$1'",
  )

  // リプライ先: json_extract(s.json, '$.in_reply_to_id') IS NOT NULL
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NOT\s+NULL/gi,
    's.in_reply_to_id IS NOT NULL',
  )

  // リプライ先: json_extract(s.json, '$.in_reply_to_id') IS NULL
  result = result.replace(
    /json_extract\(s\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NULL/gi,
    's.in_reply_to_id IS NULL',
  )

  return result
}
