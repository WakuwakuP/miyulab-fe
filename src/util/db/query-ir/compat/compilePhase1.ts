// ============================================================
// compilePhase1 — IR コンパイラを活用した Phase1 SQL 生成
// ============================================================
//
// configToQueryPlan() が生成する QueryPlan のフィルタ群を
// compileFilterNode() で SQL フラグメントに変換し、
// 既存の fetchTimeline ワーカー API と互換性のある Phase1 SQL を構築する。
//
// 従来の手動 SQL 構築を IR ベースに置き換えるブリッジ層。

import { compileTagCombination } from '../compile'
import type { BindValue, MergeNode, QueryPlan } from '../nodes'
import type { JoinClause } from '../plan'
import { compileFilterNode } from '../translate/filterToSql'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Phase1CompileResult = {
  /** Phase1 SQL (p.id, timelineTypes, backendUrl を SELECT) */
  sql: string
  /** バインドパラメータ */
  binds: BindValue[]
}

// ---------------------------------------------------------------------------
// compilePhase1ForTimeline
// ---------------------------------------------------------------------------

/**
 * QueryPlan から fetchTimeline 互換の Phase1 SQL を生成する。
 *
 * ## SELECT カラム
 * - [0] p.id
 * - [1] json_group_array(DISTINCT te.timeline_key) AS timelineTypes
 * - [2] MIN(la.backend_url) AS backendUrl
 *
 * ## 生成される SQL の構造
 * SELECT p.id, json_group_array(...), MIN(la.backend_url)
 * FROM timeline_entries te
 * INNER JOIN posts p ON p.id = te.post_id
 * LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
 * LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
 * [IR-generated JOINs]
 * WHERE [IR-generated conditions]
 * GROUP BY p.id
 * [HAVING ...]
 * ORDER BY p.created_at_ms DESC
 * LIMIT ?
 */
export function compilePhase1ForTimeline(plan: QueryPlan): Phase1CompileResult {
  // Merge composite がある場合は OR 結合で単一 SQL に展開
  const mergeComposite = plan.composites.find((c) => c.kind === 'merge')
  if (mergeComposite && mergeComposite.kind === 'merge') {
    return compilePhase1ForMergeTimeline(plan, mergeComposite)
  }

  const sourceAlias = 'p'
  const sourceTable = plan.source.table

  // IR フィルタノードをコンパイル
  const whereConditions: string[] = []
  const allBinds: BindValue[] = []
  const allJoins: JoinClause[] = []

  for (const filter of plan.filters) {
    const compiled = compileFilterNode(filter, sourceTable, sourceAlias)
    if (compiled.sql && compiled.sql !== '1=1') {
      whereConditions.push(compiled.sql)
    }
    allBinds.push(...compiled.binds)
    allJoins.push(...compiled.joins)
  }

  // TagCombination composites
  let havingClause = ''
  for (const composite of plan.composites) {
    if (composite.kind === 'tag-combination') {
      const tagResult = compileTagCombination(composite, sourceAlias)
      allJoins.push(...tagResult.joins)
      if (tagResult.sql) {
        whereConditions.push(tagResult.sql)
      }
      allBinds.push(...tagResult.binds)
      if (tagResult.having) {
        havingClause = tagResult.having
      }
    }
  }

  // JOIN の重複排除 (alias ベース)
  // te, pbi, la は base JOINs として常に含まれるため除外
  const baseAliases = new Set(['te', 'pbi', 'la'])
  const seenAliases = new Set<string>()
  const extraJoins: JoinClause[] = []
  for (const j of allJoins) {
    if (baseAliases.has(j.alias)) continue
    if (seenAliases.has(j.alias)) continue
    seenAliases.add(j.alias)
    extraJoins.push(j)
  }

  // JOIN 文字列の構築
  const extraJoinStr = extraJoins
    .map(
      (j) =>
        `${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${j.table} ${j.alias} ON ${j.on}`,
    )
    .join('\n        ')

  // WHERE
  const whereStr =
    whereConditions.length > 0
      ? whereConditions.join('\n          AND ')
      : '1=1'

  // HAVING
  const havingStr = havingClause ? `HAVING ${havingClause}` : ''

  // LIMIT
  const limitBind = plan.pagination.limit
  const offsetStr = plan.pagination.offset
    ? `OFFSET ${plan.pagination.offset}`
    : ''

  const sql = `
        SELECT p.id, json_group_array(DISTINCT te.timeline_key) AS timelineTypes, MIN(la.backend_url) AS backendUrl
        FROM timeline_entries te
        INNER JOIN posts p ON p.id = te.post_id
        LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
        LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
        ${extraJoinStr}
        WHERE ${whereStr}
        GROUP BY p.id
        ${havingStr}
        ORDER BY p.created_at_ms DESC
        LIMIT ?
        ${offsetStr};
      `

  return {
    binds: [...allBinds, limitBind],
    sql,
  }
}

// ---------------------------------------------------------------------------
// compilePhase1ForMergeTimeline (Merge composite → OR 結合)
// ---------------------------------------------------------------------------

/**
 * MergeNode を含む QueryPlan から Phase1 SQL を生成する。
 *
 * 各 merge source のフィルタを OR 結合し、トップレベルフィルタと AND 結合した
 * 単一 SQL クエリを生成する。
 *
 * ## 例: account 2 の home + account 1 の home+local
 * WHERE ((te.timeline_key = ? AND te.local_account_id = ?)
 *    OR (te.timeline_key IN (?, ?) AND te.local_account_id = ?))
 *   AND [top-level backend-filter / moderation-filter]
 */
function compilePhase1ForMergeTimeline(
  plan: QueryPlan,
  mergeNode: MergeNode,
): Phase1CompileResult {
  const sourceAlias = 'p'
  const sourceTable = plan.source.table

  const branchSqls: string[] = []
  const allBinds: BindValue[] = []
  const allJoins: JoinClause[] = []

  // 各 merge source のフィルタを OR ブランチとしてコンパイル
  for (const source of mergeNode.sources) {
    const branchConditions: string[] = []
    for (const filter of source.filters) {
      const compiled = compileFilterNode(filter, sourceTable, sourceAlias)
      if (compiled.sql && compiled.sql !== '1=1') {
        branchConditions.push(compiled.sql)
      }
      allBinds.push(...compiled.binds)
      allJoins.push(...compiled.joins)
    }
    if (branchConditions.length > 0) {
      branchSqls.push(
        branchConditions.length === 1
          ? branchConditions[0]
          : `(${branchConditions.join(' AND ')})`,
      )
    }
  }

  // OR 結合
  const whereConditions: string[] = []
  if (branchSqls.length > 0) {
    whereConditions.push(
      branchSqls.length === 1
        ? branchSqls[0]
        : `(${branchSqls.join('\n            OR ')})`,
    )
  }

  // トップレベルフィルタ (backend-filter, moderation-filter 等)
  for (const filter of plan.filters) {
    const compiled = compileFilterNode(filter, sourceTable, sourceAlias)
    if (compiled.sql && compiled.sql !== '1=1') {
      whereConditions.push(compiled.sql)
    }
    allBinds.push(...compiled.binds)
    allJoins.push(...compiled.joins)
  }

  // TagCombination composites (merge 以外)
  let havingClause = ''
  for (const composite of plan.composites) {
    if (composite.kind === 'tag-combination') {
      const tagResult = compileTagCombination(composite, sourceAlias)
      allJoins.push(...tagResult.joins)
      if (tagResult.sql) {
        whereConditions.push(tagResult.sql)
      }
      allBinds.push(...tagResult.binds)
      if (tagResult.having) {
        havingClause = tagResult.having
      }
    }
  }

  // JOIN の重複排除
  const baseAliases = new Set(['te', 'pbi', 'la'])
  const seenAliases = new Set<string>()
  const extraJoins: JoinClause[] = []
  for (const j of allJoins) {
    if (baseAliases.has(j.alias)) continue
    if (seenAliases.has(j.alias)) continue
    seenAliases.add(j.alias)
    extraJoins.push(j)
  }

  const extraJoinStr = extraJoins
    .map(
      (j) =>
        `${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${j.table} ${j.alias} ON ${j.on}`,
    )
    .join('\n        ')

  const whereStr =
    whereConditions.length > 0
      ? whereConditions.join('\n          AND ')
      : '1=1'

  const havingStr = havingClause ? `HAVING ${havingClause}` : ''
  const limitBind = plan.pagination.limit
  const offsetStr = plan.pagination.offset
    ? `OFFSET ${plan.pagination.offset}`
    : ''

  const sql = `
        SELECT p.id, json_group_array(DISTINCT te.timeline_key) AS timelineTypes, MIN(la.backend_url) AS backendUrl
        FROM timeline_entries te
        INNER JOIN posts p ON p.id = te.post_id
        LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
        LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
        ${extraJoinStr}
        WHERE ${whereStr}
        GROUP BY p.id
        ${havingStr}
        ORDER BY p.created_at_ms DESC
        LIMIT ?
        ${offsetStr};
      `

  return {
    binds: [...allBinds, limitBind],
    sql,
  }
}

// ---------------------------------------------------------------------------
// compilePhase1ForTagTimeline
// ---------------------------------------------------------------------------

/**
 * QueryPlan からタグタイムライン用の Phase1 SQL を生成する。
 *
 * ## SELECT カラム
 * - [0] p.id
 * - [1] MIN(la.backend_url) AS backendUrl
 *
 * ## 標準タイムラインとの差分
 * - timeline_entries を使わず posts から直接クエリ
 * - timeline_key の json_group_array カラムなし
 * - TagCombination composite でハッシュタグ JOIN + HAVING を生成
 */
export function compilePhase1ForTagTimeline(
  plan: QueryPlan,
): Phase1CompileResult {
  const sourceAlias = 'p'
  const sourceTable = plan.source.table

  // IR フィルタノードをコンパイル
  const whereConditions: string[] = []
  const allBinds: BindValue[] = []
  const allJoins: JoinClause[] = []

  for (const filter of plan.filters) {
    const compiled = compileFilterNode(filter, sourceTable, sourceAlias)
    if (compiled.sql && compiled.sql !== '1=1') {
      whereConditions.push(compiled.sql)
    }
    allBinds.push(...compiled.binds)
    allJoins.push(...compiled.joins)
  }

  // TagCombination composites
  let havingClause = ''
  for (const composite of plan.composites) {
    if (composite.kind === 'tag-combination') {
      const tagResult = compileTagCombination(composite, sourceAlias)
      allJoins.push(...tagResult.joins)
      if (tagResult.sql) {
        whereConditions.push(tagResult.sql)
      }
      allBinds.push(...tagResult.binds)
      if (tagResult.having) {
        havingClause = tagResult.having
      }
    }
  }

  // JOIN の重複排除 (alias ベース)
  // pbi, la は base JOINs として常に含まれるため除外
  const baseAliases = new Set(['pbi', 'la'])
  const seenAliases = new Set<string>()
  const extraJoins: JoinClause[] = []
  for (const j of allJoins) {
    if (baseAliases.has(j.alias)) continue
    if (seenAliases.has(j.alias)) continue
    seenAliases.add(j.alias)
    extraJoins.push(j)
  }

  // JOIN 文字列の構築
  const extraJoinStr = extraJoins
    .map(
      (j) =>
        `${j.type === 'inner' ? 'INNER' : 'LEFT'} JOIN ${j.table} ${j.alias} ON ${j.on}`,
    )
    .join('\n        ')

  // WHERE
  const whereStr =
    whereConditions.length > 0
      ? whereConditions.join('\n          AND ')
      : '1=1'

  // HAVING
  const havingStr = havingClause ? `HAVING ${havingClause}` : ''

  // LIMIT
  const limitBind = plan.pagination.limit
  const offsetStr = plan.pagination.offset
    ? `OFFSET ${plan.pagination.offset}`
    : ''

  const sql = `
        SELECT p.id, MIN(la.backend_url) AS backendUrl
        FROM posts p
        LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
        LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
        ${extraJoinStr}
        WHERE ${whereStr}
        GROUP BY p.id
        ${havingStr}
        ORDER BY p.created_at_ms DESC
        LIMIT ?
        ${offsetStr};
      `

  return {
    binds: [...allBinds, limitBind],
    sql,
  }
}

// ---------------------------------------------------------------------------
// compilePhase1ForNotifications (future use)
// ---------------------------------------------------------------------------

/**
 * 通知タイムライン用の Phase1 SQL を生成する。
 * (useFilteredTimeline では notification は別 hook に委譲するため、
 *  ここでは将来の拡張用として空実装)
 */
export function compilePhase1ForNotifications(
  _plan: QueryPlan,
): Phase1CompileResult {
  return { binds: [], sql: '' }
}
