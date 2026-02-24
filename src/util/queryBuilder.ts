import type {
  AccountFilter,
  BackendFilter,
  NotificationType,
  StatusTimelineType,
  TagConfig,
  TimelineConfigV2,
  VisibilityType,
} from 'types/types'

/**
 * 全通知タイプの配列
 *
 * NotificationType の全値を列挙する。
 * ALL_NOTIFICATION_TYPES_COUNT はこの配列の長さから導出する。
 */
export const ALL_NOTIFICATION_TYPES: readonly NotificationType[] = [
  'follow',
  'follow_request',
  'mention',
  'reblog',
  'favourite',
  'reaction',
  'poll_expired',
  'status',
] as const

/** 全通知タイプの数（ALL_NOTIFICATION_TYPES の長さから導出） */
const ALL_NOTIFICATION_TYPES_COUNT = ALL_NOTIFICATION_TYPES.length

/**
 * クエリが notifications テーブル（エイリアス n）を参照しているか判定する
 *
 * `n.` プレフィックス付きのカラム参照が存在する場合に true を返す。
 */
export function isNotificationQuery(query: string): boolean {
  return /\bn\.\w/.test(query)
}

/**
 * クエリが statuses 関連テーブル（エイリアス s, stt, sbt, sm, sb）を参照しているか判定する
 */
export function isStatusQuery(query: string): boolean {
  return /\b(s|stt|sbt|sm|sb)\.[a-zA-Z_]\w*/.test(query)
}

/**
 * クエリが statuses と notifications の両方のテーブルを参照しているか判定する
 *
 * OR 条件で `stt.timelineType = 'home' OR n.notification_type IN (...)` のような
 * 混合クエリを検出する。
 */
export function isMixedQuery(query: string): boolean {
  return isStatusQuery(query) && isNotificationQuery(query)
}

/**
 * WHERE 句で参照されているテーブルエイリアスを検出する
 *
 * カスタムクエリで実際に参照されているテーブルのみ JOIN するための検出に使用する。
 * 不要な JOIN を除外することで GROUP BY / ORDER BY の一時 B-Tree を削減する。
 */
export function detectReferencedAliases(whereClause: string): {
  stt: boolean
  sbt: boolean
  sm: boolean
  sb: boolean
  n: boolean
} {
  return {
    n: /\bn\.\w/.test(whereClause),
    sb: /\bsb\.\w/.test(whereClause),
    sbt: /\bsbt\.\w/.test(whereClause),
    sm: /\bsm\.\w/.test(whereClause),
    stt: /\bstt\.\w/.test(whereClause),
  }
}

/**
 * TimelineConfigV2 の UI 設定から SQL WHERE 句を構築する
 *
 * 通常の設定UIをクエリビルダとして機能させるための関数。
 * type, tagConfig, onlyMedia 等の設定を対応する SQL 条件に変換する。
 *
 * ## クエリ構造
 *
 * `(<取得するタイムライン> OR <取得する通知>) AND <メディア関係> AND <フィルター>`
 *
 * - タイムラインと通知は OR で結合（ソースの選択）
 * - メディアやフィルタは AND で適用（絞り込み）
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
  // ========================================
  // ソース条件（タイムラインと通知、OR で結合）
  // ========================================
  const sourceConditions: string[] = []

  // タイムライン種類条件
  const timelineCondition = buildTimelineTypeCondition(config)
  if (timelineCondition) {
    sourceConditions.push(timelineCondition)
  }

  // 通知タイプフィルタ（notifications テーブル側の条件）
  const notificationCondition = buildNotificationTypeCondition(
    config.notificationFilter,
  )
  if (notificationCondition) {
    sourceConditions.push(notificationCondition)
  }

  // ========================================
  // フィルタ条件（AND で絞り込み）
  // ========================================
  const filterConditions: string[] = []

  // 混合クエリかどうか（statuses 固有フィルタを NULL 許容にする判定）
  const isMixed = sourceConditions.length > 1

  // メディアフィルタ（v2: 正規化カラム使用）
  const mediaCondition = buildMediaCondition(config)
  if (mediaCondition) {
    filterConditions.push(
      isMixed ? nullTolerant(mediaCondition) : mediaCondition,
    )
  }

  // 公開範囲フィルタ
  const visibilityCondition = buildVisibilityCondition(config.visibilityFilter)
  if (visibilityCondition) {
    filterConditions.push(
      isMixed ? nullTolerant(visibilityCondition) : visibilityCondition,
    )
  }

  // 言語フィルタ（既に OR ... IS NULL を含むためそのまま）
  const languageCondition = buildLanguageCondition(config.languageFilter)
  if (languageCondition) {
    filterConditions.push(languageCondition)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    const cond = 's.is_reblog = 0'
    filterConditions.push(isMixed ? nullTolerant(cond) : cond)
  }

  // リプライ除外（IS NULL は混合クエリでも notifications 行を通すため変更不要）
  if (config.excludeReplies) {
    filterConditions.push('s.in_reply_to_id IS NULL')
  }

  // CW 付き除外
  if (config.excludeSpoiler) {
    const cond = 's.has_spoiler = 0'
    filterConditions.push(isMixed ? nullTolerant(cond) : cond)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    const cond = 's.is_sensitive = 0'
    filterConditions.push(isMixed ? nullTolerant(cond) : cond)
  }

  // アカウントフィルタ
  const accountCondition = buildAccountCondition(config.accountFilter)
  if (accountCondition) {
    filterConditions.push(
      isMixed ? nullTolerant(accountCondition) : accountCondition,
    )
  }

  // バックエンドフィルタ
  // クエリコンテキストに応じて適切なテーブル別名を使用する
  const hasTimeline = timelineCondition != null
  const hasNotification = notificationCondition != null
  const backendCondition = buildBackendFilterCondition(
    config.backendFilter,
    hasTimeline,
    hasNotification,
  )
  if (backendCondition) {
    filterConditions.push(backendCondition)
  }

  // ========================================
  // クエリの組み立て
  // (<ソース条件>) AND <フィルタ条件>
  // ========================================
  const parts: string[] = []

  if (sourceConditions.length > 0) {
    const sourcePart = sourceConditions.join(' OR ')
    // ソース条件が複数ある場合は括弧で囲む
    if (sourceConditions.length > 1) {
      parts.push(`(${sourcePart})`)
    } else {
      parts.push(sourcePart)
    }
  }

  parts.push(...filterConditions)

  if (parts.length === 0) return ''
  return parts.join(' AND ')
}

/**
 * タイムライン種類条件を構築する
 *
 * config.timelineTypes が設定されている場合はその値を使用する。
 * 未設定の場合は config.type に基づいてデフォルトを決定する。
 * tag タイプの場合はタグ条件で表現する。
 *
 * @example
 * // timelineTypes: ['home', 'local']
 * // → "stt.timelineType IN ('home','local')"
 *
 * // timelineTypes: ['home']
 * // → "stt.timelineType = 'home'"
 */
function buildTimelineTypeCondition(config: TimelineConfigV2): string | null {
  // tag タイプはタグ条件で表現
  if (config.type === 'tag') {
    const tagConfig = config.tagConfig
    if (tagConfig && tagConfig.tags.length > 0) {
      return buildTagCondition(tagConfig)
    }
    return null
  }

  // timelineTypes が明示的に設定されている場合はそれを使用
  if (config.timelineTypes && config.timelineTypes.length > 0) {
    if (config.timelineTypes.length === 1) {
      return `stt.timelineType = '${escapeSqlString(config.timelineTypes[0])}'`
    }
    const escaped = config.timelineTypes
      .map((t) => `'${escapeSqlString(t)}'`)
      .join(',')
    return `stt.timelineType IN (${escaped})`
  }

  // notification タイプの場合はタイムライン条件なし
  if (config.type === 'notification') {
    return null
  }

  // 未設定の場合は config.type から推定
  if (
    config.type === 'home' ||
    config.type === 'local' ||
    config.type === 'public'
  ) {
    return `stt.timelineType = '${escapeSqlString(config.type)}'`
  }

  return null
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
 * 未指定・空配列の場合は null を返す（通知を取得しない）。
 * 全タイプが指定されている場合は `n.notification_type IS NOT NULL` を返す。
 * 1タイプの場合は `=` で、2タイプ以上の場合は `IN` 句で表現する。
 * notifications テーブル（エイリアス n）を参照する。
 *
 * @example
 * buildNotificationTypeCondition(['follow'])
 * // → "n.notification_type = 'follow'"
 *
 * buildNotificationTypeCondition(['follow', 'favourite'])
 * // → "n.notification_type IN ('follow','favourite')"
 *
 * buildNotificationTypeCondition(allTypes)
 * // → "n.notification_type IS NOT NULL"
 */
function buildNotificationTypeCondition(
  filter: NotificationType[] | undefined,
): string | null {
  if (filter == null || filter.length === 0) return null

  // 全通知タイプが指定されている場合
  if (filter.length >= ALL_NOTIFICATION_TYPES_COUNT) {
    return 'n.notification_type IS NOT NULL'
  }

  // 1個の場合は = で表現
  if (filter.length === 1) {
    return `n.notification_type = '${escapeSqlString(filter[0])}'`
  }

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `n.notification_type IN (${escaped})`
}

/**
 * バックエンドフィルタ条件を構築する
 *
 * クエリコンテキストに応じて適切なテーブル別名を使用する:
 * - statuses のみ: sb.backendUrl（statuses_backends テーブル）
 * - notifications のみ: n.backendUrl（notifications テーブル）
 * - 混合: 両方の条件を OR で結合
 *
 * - mode: 'all' → 条件なし（全バックエンド対象）
 * - mode: 'single' → {alias}.backendUrl = 'xxx'
 * - mode: 'composite' → {alias}.backendUrl IN ('xxx', 'yyy')
 */
function buildBackendFilterCondition(
  filter: BackendFilter | undefined,
  hasTimeline: boolean,
  hasNotification: boolean,
): string | null {
  if (!filter || filter.mode === 'all') return null

  // コンテキストに応じたテーブル別名リスト
  const aliases: string[] = []
  if (hasTimeline || (!hasTimeline && !hasNotification)) {
    aliases.push('sb')
  }
  if (hasNotification) {
    aliases.push('n')
  }

  if (filter.mode === 'single') {
    const escaped = escapeSqlString(filter.backendUrl)
    if (aliases.length === 1) {
      return `${aliases[0]}.backendUrl = '${escaped}'`
    }
    // 混合クエリ: 両テーブルの条件を OR で結合
    return `(${aliases.map((a) => `${a}.backendUrl = '${escaped}'`).join(' OR ')})`
  }

  if (filter.mode === 'composite' && filter.backendUrls.length > 0) {
    const escapedList = filter.backendUrls
      .map((url) => `'${escapeSqlString(url)}'`)
      .join(', ')
    if (aliases.length === 1) {
      return `${aliases[0]}.backendUrl IN (${escapedList})`
    }
    // 混合クエリ: 両テーブルの条件を OR で結合
    return `(${aliases.map((a) => `${a}.backendUrl IN (${escapedList})`).join(' OR ')})`
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

/**
 * 混合クエリ（UNION ALL）で statuses 固有の条件が notifications 行を
 * フィルタアウトしないよう、NULL 許容のラッパーを付与する。
 *
 * UNION ALL の notifications サブクエリでは s.* カラムは
 * LEFT JOIN ... ON 0 = 1 により NULL になるため、
 * `s.has_media = 1` は `NULL = 1` → FALSE となり全件除外される。
 * これを防ぐため `(条件 OR s.compositeKey IS NULL)` で囲む。
 *
 * s.compositeKey が NULL ＝ notifications 行であるため、
 * notifications 行は常に通過する。
 *
 * @example
 * nullTolerant('s.has_media = 1')
 * // → "(s.has_media = 1 OR s.compositeKey IS NULL)"
 */
function nullTolerant(condition: string): string {
  return `(${condition} OR s.compositeKey IS NULL)`
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
  // timelineTypes の検出
  // ========================================
  const timelineTypeInMatch = query.match(
    /stt\.timelineType\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const timelineTypeSingleMatch = query.match(
    /stt\.timelineType\s*=\s*'([^']+)'/i,
  )

  if (timelineTypeInMatch) {
    const types = timelineTypeInMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean) as StatusTimelineType[]
    if (types.length > 0) {
      result.timelineTypes = types
    }
  } else if (timelineTypeSingleMatch) {
    result.timelineTypes = [timelineTypeSingleMatch[1] as StatusTimelineType]
  }

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
    /s\.visibility\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
    /s\.language\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
    /s\.account_acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const accountIncludeMatch = query.match(
    /s\.account_acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
    query.match(/s\.backendUrl\s*=\s*'([^']+)'/i) ??
    query.match(/n\.backendUrl\s*=\s*'([^']+)'/i)
  const backendInMatch =
    query.match(
      /sb\.backendUrl\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /s\.backendUrl\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /n\.backendUrl\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )

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
  // notificationFilter の検出
  // ========================================
  // IS NOT NULL = 全通知タイプ
  if (/n\.notification_type\s+IS\s+NOT\s+NULL/i.test(query)) {
    result.notificationFilter = [
      'follow',
      'follow_request',
      'mention',
      'reblog',
      'favourite',
      'reaction',
      'poll_expired',
      'status',
    ]
  } else {
    const notifTypeInMatch = query.match(
      /n\.notification_type\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )
    const notifTypeSingleMatch = query.match(
      /n\.notification_type\s*=\s*'([^']+)'/i,
    )

    if (notifTypeInMatch) {
      const types = notifTypeInMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
      if (types.length > 0) {
        result.notificationFilter =
          types as TimelineConfigV2['notificationFilter']
      }
    } else if (notifTypeSingleMatch) {
      result.notificationFilter = [
        notifTypeSingleMatch[1],
      ] as TimelineConfigV2['notificationFilter']
    }
  }

  // ========================================
  // タグ条件の検出（既存ロジック、変更なし）
  // ========================================
  const singleTagMatch = query.match(/sbt\.tag\s*=\s*'([^']+)'/i)
  const multiTagMatch = query.match(
    /sbt\.tag\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
 * クエリ文字列を通常UIに復元可能かどうか判定する
 *
 * パースした結果から再構築したクエリが元のクエリと一致するかを検証する。
 * Advanced Query をオフにする際の警告表示に使用する。
 *
 * @returns true = 復元可能、false = 復元不可（手編集されたクエリ等）
 */
export function canParseQuery(
  query: string,
  config: TimelineConfigV2,
): boolean {
  if (!query.trim()) return true

  const parsed = parseQueryToConfig(query)
  if (!parsed) return false

  // パース結果 + 既存 config から再構築して比較
  const rebuiltQuery = buildQueryFromConfig({
    ...config,
    ...parsed,
  })

  // 正規化して比較（スペースを統一）
  const normalize = (q: string) => q.replace(/\s+/g, ' ').trim().toLowerCase()

  return normalize(rebuiltQuery) === normalize(query)
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
