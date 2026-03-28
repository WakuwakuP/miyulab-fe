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
  return /\b(n|nt|ap)\.\w/.test(query)
}

/**
 * クエリが statuses 関連テーブル（エイリアス p, ptt, pbt, pme, pb, pr, vt, ps, ht）を参照しているか判定する
 */
export function isStatusQuery(query: string): boolean {
  return /\b(p|ptt|pbt|pme|pb|prb|pr|vt|ps|ht)\.[a-zA-Z_]\w*/.test(query)
}

/**
 * クエリが statuses と notifications の両方のテーブルを参照しているか判定する
 *
 * OR 条件で `ptt.timelineType = 'home' OR n.notification_type IN (...)` のような
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
  ptt: boolean
  pbt: boolean
  pme: boolean
  pb: boolean
  prb: boolean
  pe: boolean
  n: boolean
  pr: boolean
  vt: boolean
  ps: boolean
  ht: boolean
} {
  return {
    ht: /\bht\.\w+/.test(whereClause),
    n: /\b(n|nt|ap)\.\w+/.test(whereClause),
    pb: /\bpb\.\w+/.test(whereClause),
    pbt: /\b(pbt|pht)\.\w+/.test(whereClause),
    pe: /\bpe\.\w+/.test(whereClause),
    pme: /\bpme\.\w+/.test(whereClause),
    pr: /\bpr\.\w+/.test(whereClause),
    prb: /\bprb\.\w+/.test(whereClause),
    ps: /\bps\.\w+/.test(whereClause),
    ptt: /\bptt\.\w+/.test(whereClause),
    vt: /\bvt\.\w+/.test(whereClause),
  }
}

// ================================================================
// Phase1 クエリ最適化: 旧カラム名の自動書き換え
// ================================================================

/**
 * 互換 JOIN 定義
 *
 * STATUS_COMPAT_FROM サブクエリで暗黙的に提供されていた JOIN を、
 * 必要な場合のみ明示的に追加するためのマッピング。
 */
const COMPAT_JOINS: Record<string, string> = {
  post_stats: 'LEFT JOIN post_stats ps_c ON ps_c.post_id = p.id',
  profiles: 'LEFT JOIN profiles pr_c ON pr_c.id = p.author_profile_id',
  servers: 'LEFT JOIN servers sv_c ON sv_c.id = p.origin_server_id',
  visibility_types:
    'LEFT JOIN visibility_types vt_c ON vt_c.id = p.visibility_id',
}

/**
 * 旧カラム名 → 正規化形式への変換定義
 *
 * STATUS_COMPAT_FROM サブクエリが仮想的に提供していたカラムを、
 * 直接 JOIN + 式に変換するためのマッピング。
 *
 * pattern: 旧カラム名を検出する正規表現（\b で単語境界）
 * expression: 置換先の SQL 式
 * joinKey: 必要な JOIN の COMPAT_JOINS キー（不要なら null）
 */
const LEGACY_COLUMN_REWRITES: {
  pattern: RegExp
  expression: string
  joinKey: string | null
}[] = [
  {
    expression:
      "COALESCE((SELECT la_compat.backend_url FROM local_accounts la_compat WHERE la_compat.server_id = p.origin_server_id LIMIT 1), '')",
    joinKey: null,
    pattern: /\bp\.origin_backend_url\b/g,
  },
  {
    expression: "COALESCE(pr_c.acct, '')",
    joinKey: 'profiles',
    pattern: /\bp\.account_acct\b/g,
  },
  {
    expression: "''",
    joinKey: null,
    pattern: /\bp\.account_id\b/g,
  },
  {
    expression: "COALESCE(vt_c.name, 'public')",
    joinKey: 'visibility_types',
    pattern: /\bp\.visibility\b/g,
  },
  {
    expression: 'NULL',
    joinKey: null,
    pattern: /\bp\.reblog_of_id\b/g,
  },
  {
    expression: 'COALESCE(ps_c.favourites_count, 0)',
    joinKey: 'post_stats',
    pattern: /\bp\.favourites_count\b/g,
  },
  {
    expression: 'COALESCE(ps_c.reblogs_count, 0)',
    joinKey: 'post_stats',
    pattern: /\bp\.reblogs_count\b/g,
  },
  {
    expression: 'COALESCE(ps_c.replies_count, 0)',
    joinKey: 'post_stats',
    pattern: /\bp\.replies_count\b/g,
  },
  {
    expression: 'ht.name',
    joinKey: null,
    pattern: /\bpbt\.tag\b/g,
  },
  {
    expression: 'p.in_reply_to_uri',
    joinKey: null,
    pattern: /\bp\.in_reply_to_id\b/g,
  },
]

/**
 * WHERE 句の旧カラム名参照を正規化形式に書き換え、必要な JOIN を返す
 *
 * STATUS_COMPAT_FROM サブクエリを廃止し `FROM posts p` を直接使用する
 * Phase1 クエリのために、WHERE 句内の旧カラム名（`p.visibility`,
 * `p.account_acct` 等）を正規化テーブルの JOIN + 式に変換する。
 *
 * これにより SQLite オプティマイザが `idx_posts_created` を
 * ORDER BY ... DESC LIMIT N に push down でき、フルテーブルスキャン +
 * TEMP B-TREE ソートを回避できる。
 *
 * @param whereClause ユーザー入力の WHERE 句（サニタイズ済み）
 * @returns rewrittenWhere: 書き換え後の WHERE 句, compatJoins: 追加すべき JOIN 句の配列
 */
export function rewriteLegacyColumnsForPhase1(whereClause: string): {
  rewrittenWhere: string
  compatJoins: string[]
} {
  let rewritten = whereClause
  const requiredJoinKeys = new Set<string>()

  for (const { pattern, expression, joinKey } of LEGACY_COLUMN_REWRITES) {
    // test() で lastIndex が進むためリセット
    pattern.lastIndex = 0
    if (pattern.test(rewritten)) {
      pattern.lastIndex = 0
      rewritten = rewritten.replace(pattern, expression)
      if (joinKey) requiredJoinKeys.add(joinKey)
    }
  }

  const compatJoins = [...requiredJoinKeys].map((key) => COMPAT_JOINS[key])

  return { compatJoins, rewrittenWhere: rewritten }
}

// ================================================================
// Phase1 クエリ最適化: 相関サブクエリのヒント条件注入
// ================================================================

/**
 * 相関サブクエリに profile_id ベースのヒント条件を注入する（施策D）
 *
 * ユーザーの WHERE 句内で、`profiles` テーブルの `acct` を介して
 * `notifications.actor_profile_id` と投稿者を比較しているパターンを検出し、
 * 冗長な `<ntf>.actor_profile_id = p.author_profile_id` 条件を注入する。
 *
 * これにより SQLite オプティマイザが `idx_notifications_type_actor
 * (notification_type_id, actor_profile_id, created_at_ms DESC)` を
 * 活用でき、相関サブクエリのコストが大幅に削減される。
 *
 * ## 注入前の EXPLAIN
 * ```
 * SEARCH ntf USING INDEX idx_notifications_type (notification_type_id=? AND created_at_ms<?)
 * SEARCH pra USING INTEGER PRIMARY KEY (rowid=?)
 * ```
 * → notification_type ごとに全通知をスキャンし、各行で profile lookup + acct 比較
 *
 * ## 注入後の EXPLAIN（期待値）
 * ```
 * SEARCH ntf USING INDEX idx_notifications_type_actor (notification_type_id=? AND actor_profile_id=?)
 * ```
 * → notification_type + actor_profile_id で即座に絞り込み
 *
 * @param whereClause rewriteLegacyColumnsForPhase1() 適用済みの WHERE 句
 * @returns ヒント注入済みの WHERE 句
 */
export function injectProfileIdHint(whereClause: string): string {
  // Pattern: profiles <alias> ON <alias>.id = <source>.actor_profile_id
  // (後方互換: .profile_id も認識する)
  const joinPattern =
    /\bprofiles\s+(\w+)\s+ON\s+\1\.(?:profile_id|id)\s*=\s*(\w+)\.actor_profile_id\b/gi

  let result = whereClause

  for (const match of whereClause.matchAll(joinPattern)) {
    const profileAlias = match[1] // e.g., 'pra'
    const sourceAlias = match[2] // e.g., 'ntf'

    // acct 比較が存在するか確認:
    // <profileAlias>.acct = COALESCE(pr_c.acct, '')
    const acctPattern = new RegExp(
      `\\b${profileAlias}\\.acct\\s*=\\s*COALESCE\\(pr_c\\.acct,\\s*''\\)`,
      'i',
    )

    // 既にヒントが存在しないか確認
    const hintPattern = new RegExp(
      `\\b${sourceAlias}\\.actor_profile_id\\s*=\\s*p\\.author_profile_id\\b`,
      'i',
    )

    if (acctPattern.test(result) && !hintPattern.test(result)) {
      // acct 比較の直後に冗長な profile_id 条件を注入
      // $& は acctPattern にマッチした文字列をそのまま保持する
      result = result.replace(
        acctPattern,
        `$& AND ${sourceAlias}.actor_profile_id = p.author_profile_id`,
      )
    }
  }

  return result
}

/**
 * WHERE 句から通知タイプコード（ntt.code IN (...) 等）を抽出する
 *
 * 相関サブクエリの事前フィルタ（施策E）で使用する。
 * ベストエフォートで抽出し、認識できない場合は null を返す。
 *
 * @param whereClause WHERE 句
 * @returns 抽出された通知タイプコードの配列、または null
 */
export function extractNotificationTypeCodes(
  whereClause: string,
): string[] | null {
  // IN 句: ntt.code IN (...) or ntt.name IN (...)
  const inMatch = whereClause.match(
    /\b(?:ntt?|notification_types?)\.(?:code|name)\s+IN\s*\(\s*([^)]+)\s*\)/i,
  )
  if (inMatch) {
    const codes = inMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    return codes.length > 0 ? codes : null
  }

  // 単一値: ntt.code = 'favourite' or ntt.name = 'favourite'
  const singleMatch = whereClause.match(
    /\b(?:ntt?|notification_types?)\.(?:code|name)\s*=\s*'([^']+)'/i,
  )
  if (singleMatch) return [singleMatch[1]]

  return null
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
 * - onlyMedia: json_extract → p.has_media = 1
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
    const cond = 'p.is_reblog = 0'
    filterConditions.push(isMixed ? nullTolerant(cond) : cond)
  }

  // リプライ除外（IS NULL は混合クエリでも notifications 行を通すため変更不要）
  if (config.excludeReplies) {
    filterConditions.push('p.in_reply_to_uri IS NULL')
  }

  // CW 付き除外
  if (config.excludeSpoiler) {
    const cond = "p.spoiler_text = ''"
    filterConditions.push(isMixed ? nullTolerant(cond) : cond)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    const cond = 'p.is_sensitive = 0'
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
 * // → "ptt.timelineType IN ('home','local')"
 *
 * // timelineTypes: ['home']
 * // → "ptt.timelineType = 'home'"
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
      return `ptt.timelineType = '${escapeSqlString(config.timelineTypes[0])}'`
    }
    const escaped = config.timelineTypes
      .map((t) => `'${escapeSqlString(t)}'`)
      .join(',')
    return `ptt.timelineType IN (${escaped})`
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
    return `ptt.timelineType = '${escapeSqlString(config.type)}'`
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
 * v1: json_extract(p.json, '$.media_attachments') != '[]'
 * v2: p.has_media = 1 または p.media_count >= N
 */
function buildMediaCondition(config: TimelineConfigV2): string | null {
  if (config.minMediaCount != null && config.minMediaCount > 1) {
    return `(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= ${Math.floor(config.minMediaCount)}`
  }
  if (
    config.onlyMedia ||
    (config.minMediaCount != null && config.minMediaCount > 0)
  ) {
    return 'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'
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
 * // → "p.visibility IN ('public','unlisted')"
 */
function buildVisibilityCondition(
  filter: VisibilityType[] | undefined,
): string | null {
  if (filter == null || filter.length === 0) return null

  // 全公開範囲が指定されている場合はフィルタ不要
  if (filter.length >= 4) return null

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `vt.name IN (${escaped})`
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
 * // → "(p.language IN ('ja','en') OR p.language IS NULL)"
 */
function buildLanguageCondition(filter: string[] | undefined): string | null {
  if (filter == null || filter.length === 0) return null

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `(p.language IN (${escaped}) OR p.language IS NULL)`
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
 * // → "p.account_acct IN ('user@example.com')"
 *
 * buildAccountCondition({ mode: 'exclude', accts: ['spam@example.com'] })
 * // → "p.account_acct NOT IN ('spam@example.com')"
 */
function buildAccountCondition(
  filter: AccountFilter | undefined,
): string | null {
  if (filter == null || filter.accts.length === 0) return null

  const escaped = filter.accts.map((a) => `'${escapeSqlString(a)}'`).join(',')

  if (filter.mode === 'include') {
    return `pr.acct IN (${escaped})`
  }
  return `pr.acct NOT IN (${escaped})`
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
    return 'nt.name IS NOT NULL'
  }

  // 1個の場合は = で表現
  if (filter.length === 1) {
    return `nt.name = '${escapeSqlString(filter[0])}'`
  }

  const escaped = filter.map((v) => `'${escapeSqlString(v)}'`).join(',')
  return `nt.name IN (${escaped})`
}

/**
 * バックエンドフィルタ条件を構築する
 *
 * クエリコンテキストに応じて適切なテーブル別名を使用する:
 * - statuses のみ: pb.backendUrl（posts_backends テーブル）
 * - notifications のみ: n.backend_url（notifications 互換サブクエリ）
 * - 混合: 両方の条件を OR で結合
 *
 * - mode: 'all' → 条件なし（全バックエンド対象）
 * - mode: 'single' → pb.backendUrl = 'xxx' / n.backend_url = 'xxx'
 * - mode: 'composite' → pb.backendUrl IN ('xxx', 'yyy') / n.backend_url IN (...)
 */
function buildBackendFilterCondition(
  filter: BackendFilter | undefined,
  hasTimeline: boolean,
  hasNotification: boolean,
): string | null {
  if (!filter || filter.mode === 'all') return null

  /**
   * status 用のバックエンドフィルタ条件を構築する
   * post_backend_ids + local_accounts のサブクエリで表現する
   */
  const buildStatusBackendCondition = (urls: string[]): string => {
    const escaped = urls.map((u) => `'${escapeSqlString(u)}'`).join(', ')
    if (urls.length === 1) {
      return `EXISTS(SELECT 1 FROM post_backend_ids pbi INNER JOIN local_accounts la_pbi ON la_pbi.id = pbi.local_account_id WHERE pbi.post_id = p.id AND la_pbi.backend_url = ${escaped})`
    }
    return `EXISTS(SELECT 1 FROM post_backend_ids pbi INNER JOIN local_accounts la_pbi ON la_pbi.id = pbi.local_account_id WHERE pbi.post_id = p.id AND la_pbi.backend_url IN (${escaped}))`
  }

  /**
   * notification 用のバックエンドフィルタ条件を構築する
   * NOTIFICATION_BASE_JOINS で提供される la エイリアスを使用する
   */
  const buildNotifBackendCondition = (urls: string[]): string => {
    const escaped = urls.map((u) => `'${escapeSqlString(u)}'`).join(', ')
    if (urls.length === 1) {
      return `la.backend_url = ${escaped}`
    }
    return `la.backend_url IN (${escaped})`
  }

  const urls =
    filter.mode === 'single' ? [filter.backendUrl] : filter.backendUrls
  if (urls.length === 0) return null

  const parts: string[] = []
  if (hasTimeline || (!hasTimeline && !hasNotification)) {
    parts.push(buildStatusBackendCondition(urls))
  }
  if (hasNotification) {
    parts.push(buildNotifBackendCondition(urls))
  }

  if (parts.length === 1) return parts[0]
  return `(${parts.join(' OR ')})`
}

/**
 * TagConfig から SQL 条件を構築する
 */
function buildTagCondition(tagConfig: TagConfig): string {
  const { mode, tags } = tagConfig

  if (tags.length === 0) return ''
  if (tags.length === 1) {
    return `ht.name = '${escapeSqlString(tags[0].toLowerCase())}'`
  }

  const tagList = tags
    .map((t) => `'${escapeSqlString(t.toLowerCase())}'`)
    .join(', ')

  if (mode === 'or') {
    return `ht.name IN (${tagList})`
  }

  // AND mode: 全タグを含む投稿のみ (GROUP BY + HAVING は WHERE 句内では表現不可)
  // サブクエリで表現する
  return `p.id IN (
    SELECT pht_inner.post_id
    FROM post_hashtags pht_inner
    INNER JOIN hashtags ht_inner ON pht_inner.hashtag_id = ht_inner.id
    WHERE ht_inner.normalized_name IN (${tagList})
    GROUP BY pht_inner.post_id
    HAVING COUNT(DISTINCT ht_inner.normalized_name) = ${tags.length}
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
 * UNION ALL の notifications サブクエリでは p.* カラムは
 * LEFT JOIN ... ON 0 = 1 により NULL になるため、
 * `p.has_media = 1` は `NULL = 1` → FALSE となり全件除外される。
 * これを防ぐため `(条件 OR p.id IS NULL)` で囲む。
 *
 * p.id が NULL ＝ notifications 行であるため、
 * notifications 行は常に通過する。
 *
 * @example
 * nullTolerant('p.is_reblog = 0')
 * // → "(p.is_reblog = 0 OR p.id IS NULL)"
 */
function nullTolerant(condition: string): string {
  return `(${condition} OR p.id IS NULL)`
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
 * @param tableAlias カラム参照に付けるテーブルエイリアス（デフォルト: 'p'）。
 *   posts テーブルのエイリアスを指定する。
 * @param options.profileJoined profiles テーブルが pr として JOIN されている場合 true。
 *   true の場合は pr.acct を直接参照し、サブクエリを省略する。
 * @returns SQL 条件文字列とバインド変数の配列
 *
 * @example
 * const { sql, binds } = buildMuteCondition(['https://mastodon.social'])
 * // sql:   "(SELECT acct FROM profiles WHERE id = p.author_profile_id) NOT IN (...)"
 *
 * const { sql, binds } = buildMuteCondition(['https://mastodon.social'], 'p', { profileJoined: true })
 * // sql:   "pr.acct NOT IN (...)"
 */
export function buildMuteCondition(
  backendUrls: string[],
  tableAlias = 'p',
  options?: { profileJoined?: boolean },
): {
  sql: string
  binds: string[]
} {
  if (backendUrls.length === 0) {
    return { binds: [], sql: '1=1' }
  }

  const hosts = backendUrls.map((url) => new URL(url).host)
  const prefix = tableAlias ? `${tableAlias}.` : ''
  const placeholders = hosts.map(() => '?').join(',')
  const acctExpr = options?.profileJoined
    ? 'pr.acct'
    : `(SELECT acct FROM profiles WHERE id = ${prefix}author_profile_id)`
  return {
    binds: [...hosts],
    sql: `${acctExpr}
  NOT IN (
      SELECT account_acct FROM muted_accounts WHERE server_id IN (SELECT sv.id FROM servers sv WHERE sv.host IN (${placeholders}))
    )`,
  }
}

/**
 * インスタンスブロック除外の SQL 条件を構築する
 *
 * blocked_instances テーブルが空の場合でもクエリは高速に実行される（空テーブルの EXISTS は即座に false）。
 *
 * @param tableAlias カラム参照に付けるテーブルエイリアス（デフォルト: 'p'）。
 *   posts テーブルのエイリアスを指定する。
 * @param options.profileJoined profiles テーブルが pr として JOIN されている場合 true。
 *   true の場合は substr/instr でドメインを抽出し、blocked_instances の PRIMARY KEY で
 *   インデックス検索する最適化パスを使用する。
 * @returns SQL 条件文字列（バインド変数なし、静的サブクエリ）
 *
 * @example
 * const sql = buildInstanceBlockCondition('p', { profileJoined: true })
 * // → "NOT EXISTS (SELECT 1 FROM blocked_instances bi WHERE bi.instance_domain = substr(pr.acct, instr(pr.acct, '@') + 1))"
 */
export function buildInstanceBlockCondition(
  tableAlias = 'p',
  options?: { profileJoined?: boolean },
): string {
  const prefix = tableAlias ? `${tableAlias}.` : ''
  if (options?.profileJoined) {
    return `NOT EXISTS (
    SELECT 1 FROM blocked_instances bi
    WHERE bi.instance_domain = substr(pr.acct, instr(pr.acct, '@') + 1)
  )`
  }
  return `NOT EXISTS (
    SELECT 1 FROM blocked_instances bi
    WHERE (SELECT acct FROM profiles WHERE id = ${prefix}author_profile_id) LIKE '%@' || REPLACE(REPLACE(bi.instance_domain, '%', '\\%'), '_', '\\_') ESCAPE '\\'
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
    /ptt\.timelineType\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const timelineTypeSingleMatch = query.match(
    /ptt\.timelineType\s*=\s*'([^']+)'/i,
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
    query.includes("json_extract(p.json, '$.media_attachments') != '[]'") ||
    query.includes('p.has_media = 1') ||
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+post_media\b/i.test(query)
  ) {
    result.onlyMedia = true
  }

  // ========================================
  // minMediaCount の検出（v2 + 旧形式）
  // ========================================
  const mediaCountMatchV2 = query.match(
    /\(\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+post_media\b[^)]*\)\s*>=\s*(\d+)/i,
  )
  const mediaCountMatch = query.match(/p\.media_count\s*>=\s*(\d+)/i)
  const mediaCountResult = mediaCountMatchV2 ?? mediaCountMatch
  if (mediaCountResult) {
    const count = parseInt(mediaCountResult[1], 10)
    if (count > 1) {
      result.minMediaCount = count
      // minMediaCount が設定されている場合は onlyMedia は不要
      delete result.onlyMedia
    } else if (count === 1) {
      result.onlyMedia = true
    }
  }

  // ========================================
  // visibilityFilter の検出（v2 + 旧形式）
  // ========================================
  const visibilityMatchV2 = query.match(
    /vt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const visibilityMatch = query.match(
    /p\.visibility\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const visibilityResult = visibilityMatchV2 ?? visibilityMatch
  if (visibilityResult) {
    const visibilities = visibilityResult[1]
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
    /p\.language\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
    query.includes('p.is_reblog = 0') ||
    query.includes("json_extract(p.json, '$.reblog') IS NULL")
  ) {
    result.excludeReblogs = true
  }

  // ========================================
  // excludeReplies の検出（v2 + 旧形式）
  // ========================================
  if (
    query.includes('p.in_reply_to_uri IS NULL') ||
    query.includes('p.in_reply_to_id IS NULL')
  ) {
    result.excludeReplies = true
  }

  // ========================================
  // excludeSpoiler の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes('p.has_spoiler = 0') ||
    query.includes("p.spoiler_text = ''") ||
    query.includes("json_extract(p.json, '$.spoiler_text') = ''")
  ) {
    result.excludeSpoiler = true
  }

  // ========================================
  // excludeSensitive の検出
  // ========================================
  if (query.includes('p.is_sensitive = 0')) {
    result.excludeSensitive = true
  }

  // ========================================
  // accountFilter の検出（v2 + 旧形式）
  // ========================================
  const accountExcludeMatch =
    query.match(
      /pr\.acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.account_acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )
  const accountIncludeMatch =
    query.match(
      /pr\.acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.account_acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
    query.match(/la\.backend_url\s*=\s*'([^']+)'/i) ??
    query.match(/pb\.(?:backend_url|backendUrl)\s*=\s*'([^']+)'/i) ??
    query.match(/p\.origin_backend_url\s*=\s*'([^']+)'/i) ??
    query.match(/n\.backend_url\s*=\s*'([^']+)'/i)
  const backendInMatch =
    query.match(
      /la\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /pb\.(?:backend_url|backendUrl)\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.origin_backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /n\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
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
  // notificationFilter の検出（v2 + 旧形式）
  // ========================================
  // IS NOT NULL = 全通知タイプ
  if (
    /nt\.name\s+IS\s+NOT\s+NULL/i.test(query) ||
    /n\.notification_type\s+IS\s+NOT\s+NULL/i.test(query)
  ) {
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
    const notifTypeInMatch =
      query.match(
        /nt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
      ) ??
      query.match(
        /n\.notification_type\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
      )
    const notifTypeSingleMatch =
      query.match(/nt\.name\s*=\s*'([^']+)'/i) ??
      query.match(/n\.notification_type\s*=\s*'([^']+)'/i)

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
  const singleTagMatch = query.match(
    /(?:pbt\.tag|ht\.(?:name|normalized_name))\s*=\s*'([^']+)'/i,
  )
  const multiTagMatch = query.match(
    /(?:pbt\.tag|ht\.(?:name|normalized_name))\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const andTagMatch = query.match(
    /HAVING\s+COUNT\s*\(\s*DISTINCT\s+\w+\.(?:tag|normalized_name)\s*\)\s*=\s*(\d+)/i,
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

  // v7→v13: p.backendUrl / p.origin_backend_url / pb.backend_url → pb.backendUrl
  result = result.replace(/\bp\.backendUrl\b/g, 'pb.backendUrl')
  result = result.replace(/\bp\.origin_backend_url\b/g, 'pb.backendUrl')
  result = result.replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

  // DB正規化: pbt.tag → ht.name (posts_belonging_tags → hashtags)
  result = result.replace(/\bpbt\.tag\b/g, 'ht.name')
  result = result.replace(/\bposts_belonging_tags\b/g, 'post_hashtags')

  // notification_types: code → name (v2 スキーマでカラム名変更)
  result = result.replace(/\bntt\.code\b/g, 'ntt.name')
  result = result.replace(
    /\bnotification_types\.code\b/g,
    'notification_types.name',
  )

  // メディア: json_extract(p.json, '$.media_attachments') != '[]'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.media_attachments'\)\s*!=\s*'\[\]'/gi,
    'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // メディア枚数: json_array_length(json_extract(p.json, '$.media_attachments')) >= N
  result = result.replace(
    /json_array_length\(json_extract\(p\.json,\s*'\$\.media_attachments'\)\)\s*>=\s*(\d+)/gi,
    '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  )

  // ブースト: json_extract(p.json, '$.reblog') IS NOT NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.reblog'\)\s+IS\s+NOT\s+NULL/gi,
    'p.is_reblog = 1',
  )

  // ブースト除外: json_extract(p.json, '$.reblog') IS NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.reblog'\)\s+IS\s+NULL/gi,
    'p.is_reblog = 0',
  )

  // CW: json_extract(p.json, '$.spoiler_text') != ''
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.spoiler_text'\)\s*!=\s*''/gi,
    "p.spoiler_text != ''",
  )

  // CW除外: json_extract(p.json, '$.spoiler_text') = ''
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.spoiler_text'\)\s*=\s*''/gi,
    "p.spoiler_text = ''",
  )

  // センシティブ: json_extract(p.json, '$.sensitive') = 1|0
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.sensitive'\)\s*=\s*(\d)/gi,
    'p.is_sensitive = $1',
  )

  // 公開範囲: json_extract(p.json, '$.visibility') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.visibility'\)\s*=\s*'([^']+)'/gi,
    "p.visibility = '$1'",
  )

  // 言語: json_extract(p.json, '$.language') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.language'\)\s*=\s*'([^']+)'/gi,
    "p.language = '$1'",
  )

  // アカウント: json_extract(p.json, '$.account.acct') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.account\.acct'\)\s*=\s*'([^']+)'/gi,
    "p.account_acct = '$1'",
  )

  // リプライ先: json_extract(p.json, '$.in_reply_to_id') IS NOT NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NOT\s+NULL/gi,
    'p.in_reply_to_uri IS NOT NULL',
  )

  // リプライ先: json_extract(p.json, '$.in_reply_to_id') IS NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NULL/gi,
    'p.in_reply_to_uri IS NULL',
  )

  // v1→v2 PK名変更: notification_types.notification_type_id → .id
  result = result.replace(
    /\bnotification_types\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.notification_type_id\b/gi,
    'notification_types $1 ON $1.id',
  )

  // v1→v2 PK名変更: profiles.profile_id → .id
  result = result.replace(
    /\bprofiles\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.profile_id\b/gi,
    'profiles $1 ON $1.id',
  )

  // v1→v2 PK名変更: posts.post_id → .id
  result = result.replace(
    /\bposts\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.post_id\b/gi,
    'posts $1 ON $1.id',
  )

  // ================================================================
  // Phantom column 変換（v2 中間形式 → v2 ネイティブ形式）
  // json_extract 変換後に実行する
  // ================================================================

  // p.has_media = 1 → EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)
  result = result.replace(
    /\bp\.has_media\s*=\s*1\b/g,
    'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // p.has_media = 0 → NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)
  result = result.replace(
    /\bp\.has_media\s*=\s*0\b/g,
    'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // p.media_count >= N → (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= N
  result = result.replace(
    /\bp\.media_count\s*>=\s*(\d+)/g,
    '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  )

  // p.has_spoiler = 1 → p.spoiler_text != ''
  result = result.replace(/\bp\.has_spoiler\s*=\s*1\b/g, "p.spoiler_text != ''")

  // p.has_spoiler = 0 → p.spoiler_text = ''
  result = result.replace(/\bp\.has_spoiler\s*=\s*0\b/g, "p.spoiler_text = ''")

  // ================================================================
  // Notification compat column 変換
  // NOTIFICATION_BASE_JOINS で nt, la, ap が利用可能
  // ================================================================

  // n.notification_type IS NOT NULL → nt.name IS NOT NULL
  result = result.replace(
    /\bn\.notification_type\s+IS\s+NOT\s+NULL\b/gi,
    'nt.name IS NOT NULL',
  )

  // n.notification_type IN (...) → nt.name IN (...)
  result = result.replace(/\bn\.notification_type(\s+IN\s*\()/gi, 'nt.name$1')

  // n.notification_type = 'X' → nt.name = 'X'
  result = result.replace(/\bn\.notification_type(\s*=\s*)/g, 'nt.name$1')

  // n.account_acct → ap.acct
  result = result.replace(/\bn\.account_acct\b/g, 'ap.acct')

  // n.backend_url → la.backend_url
  // ※ pb.backend_url → pb.backendUrl の変換より後に実行する
  result = result.replace(/\bn\.backend_url\b/g, 'la.backend_url')

  return result
}
