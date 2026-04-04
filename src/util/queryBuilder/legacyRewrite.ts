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
