import type {
  AccountFilter,
  BackendFilter,
  NotificationType,
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
  'emoji_reaction',
  'poll_expired',
  'status',
] as const

/** 全通知タイプの数（ALL_NOTIFICATION_TYPES の長さから導出） */
const ALL_NOTIFICATION_TYPES_COUNT = ALL_NOTIFICATION_TYPES.length

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
