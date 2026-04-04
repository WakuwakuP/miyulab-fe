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
