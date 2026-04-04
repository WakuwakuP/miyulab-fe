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
