// ============================================================
// Query IR — PlanCompiler: QueryPlan → ExecutionPlan
// ============================================================

import { getDefaultTimeColumn } from './completion'
import type { BindValue, MergeNode, QueryPlan, TagCombination } from './nodes'
import type {
  BatchEnrichStep,
  CompiledFilter,
  DetailFetchStep,
  ExecutionPlan,
  ExecutionStep,
  IdCollectStep,
  JoinClause,
  MergeStep,
} from './plan'
import { compileFilterNode } from './translate/filterToSql'
import { buildJoinString, translateSource } from './translate/sourceToSql'

// --------------- Batch enrich queries (shared) ---------------

const POST_BATCH_QUERIES: Record<string, string> = {
  belongingTags: '{BELONGING_TAGS_QUERY}',
  customEmojis: '{CUSTOM_EMOJIS_QUERY}',
  interactions: '{INTERACTIONS_QUERY}',
  media: '{MEDIA_QUERY}',
  mentions: '{MENTIONS_QUERY}',
  polls: '{POLLS_QUERY}',
  profileEmojis: '{PROFILE_EMOJIS_QUERY}',
  timelineTypes: '{TIMELINE_TYPES_QUERY}',
}

const POST_BATCH_KEYS = [
  'media',
  'mentions',
  'customEmojis',
  'profileEmojis',
  'timelineTypes',
  'belongingTags',
  'polls',
  'interactions',
]

// --------------- Tag combination ---------------

export function compileTagCombination(
  node: TagCombination,
  sourceAlias: string,
): CompiledFilter & { having?: string } {
  if (node.tags.length === 0) {
    return { binds: [], having: undefined, joins: [], sql: '' }
  }

  const joins: JoinClause[] = [
    {
      alias: 'pht',
      on: `pht.post_id = ${sourceAlias}.id`,
      table: 'post_hashtags',
      type: 'inner',
    },
    {
      alias: 'ht',
      on: 'ht.id = pht.hashtag_id',
      table: 'hashtags',
      type: 'inner',
    },
  ]

  const placeholders = node.tags.map(() => '?').join(', ')
  const sql = `ht.name IN (${placeholders})`
  const binds = [...node.tags] as BindValue[]

  if (node.mode === 'and') {
    return {
      binds,
      having: `COUNT(DISTINCT ht.name) >= ${node.tags.length}`,
      joins,
      sql,
    }
  }

  return { binds, having: undefined, joins, sql }
}

// --------------- Single source compilation ---------------

export function compileSingleSource(plan: QueryPlan): ExecutionPlan {
  const { alias, from, orderBy } = translateSource(plan.source)
  const sourceTable = plan.source.table

  const whereConditions: string[] = []
  const allBinds: BindValue[] = []
  const allJoins: JoinClause[] = []

  for (const filter of plan.filters) {
    const compiled = compileFilterNode(filter, sourceTable, alias)
    if (compiled.sql && compiled.sql !== '1=1') {
      whereConditions.push(compiled.sql)
    }
    allBinds.push(...compiled.binds)
    allJoins.push(...compiled.joins)
  }

  // Handle TagCombination composites
  let groupByNeeded = false
  let havingClause = ''
  for (const composite of plan.composites) {
    if (composite.kind === 'tag-combination') {
      const tagResult = compileTagCombination(composite, alias)
      allJoins.push(...tagResult.joins)
      if (tagResult.sql) {
        whereConditions.push(tagResult.sql)
      }
      allBinds.push(...tagResult.binds)
      if (tagResult.having) {
        havingClause = tagResult.having
        groupByNeeded = true
      }
    }
  }

  // GROUP BY is needed when we have INNER JOINs on 1:N tables
  if (!groupByNeeded && allJoins.some((j) => j.type === 'inner')) {
    groupByNeeded = true
  }

  // Deduplicate joins by alias
  const seenAliases = new Set<string>()
  const uniqueJoins = allJoins.filter((j) => {
    if (seenAliases.has(j.alias)) return false
    seenAliases.add(j.alias)
    return true
  })

  // Build Phase 1 SQL
  const joinStr = buildJoinString(uniqueJoins)
  const whereStr =
    whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
  const groupByStr = groupByNeeded ? `GROUP BY ${alias}.id` : ''
  const havingStr = havingClause ? `HAVING ${havingClause}` : ''
  const limitStr = `LIMIT ${plan.pagination.limit}`
  const offsetStr = plan.pagination.offset
    ? `OFFSET ${plan.pagination.offset}`
    : ''

  // idColumn/timeColumn は GetIdsNode から流れてくる。AS でエイリアスして
  // 結果行は常に [id, created_at_ms] の順になることを保証する。
  const idCol = `${alias}.${plan.source.idColumn ?? 'id'}`
  const timeColName =
    plan.source.timeColumn ?? getDefaultTimeColumn(sourceTable)
  const timeCol = timeColName ? `${alias}.${timeColName}` : '0'

  const sql = [
    `SELECT ${idCol} AS id, ${timeCol} AS created_at_ms`,
    `FROM ${from}`,
    joinStr,
    whereStr,
    groupByStr,
    havingStr,
    `ORDER BY ${orderBy}`,
    limitStr,
    offsetStr,
  ]
    .filter(Boolean)
    .join(' ')

  const sourceType = sourceTable === 'notifications' ? 'notification' : 'post'
  const steps: ExecutionStep[] = []

  // Phase 1: IdCollectStep
  steps.push({
    binds: allBinds,
    source: sourceTable,
    sql,
    type: 'id-collect',
  } satisfies IdCollectStep)

  // Phase 2: DetailFetchStep
  const target = sourceType === 'notification' ? 'notifications' : 'posts'
  steps.push({
    sqlTemplate: '{DETAIL_QUERY}',
    target,
    type: 'detail-fetch',
  } satisfies DetailFetchStep)

  // Phase 3: BatchEnrichStep for posts
  if (sourceType === 'post') {
    steps.push({
      queries: POST_BATCH_QUERIES,
      type: 'batch-enrich',
    } satisfies BatchEnrichStep)
  }

  return {
    meta: {
      batchKeys: sourceType === 'post' ? POST_BATCH_KEYS : [],
      requiresReblogExpansion: sourceType === 'post',
      sourceType,
    },
    steps,
  }
}

// --------------- Merge node compilation ---------------

/** IdCollectStep のハッシュキーを生成（SQL + binds の文字列化）*/
function idCollectStepKey(step: IdCollectStep): string {
  return `${step.sql}\0${JSON.stringify(step.binds)}`
}

export function compileMergeNode(mergeNode: MergeNode): ExecutionPlan {
  const steps: ExecutionStep[] = []
  const stepIndices: number[] = []
  // 同一 SQL+binds の IdCollectStep を検出してインデックスを再利用
  const stepKeyMap = new Map<string, number>()

  for (const subPlan of mergeNode.sources) {
    const subResult = compileSingleSource(subPlan)
    const idStep = subResult.steps.find((s) => s.type === 'id-collect') as
      | IdCollectStep
      | undefined
    if (idStep) {
      const key = idCollectStepKey(idStep)
      const existing = stepKeyMap.get(key)
      if (existing !== undefined) {
        // 重複 SQL — 既存ステップのインデックスを再利用
        stepIndices.push(existing)
      } else {
        const idx = steps.length
        stepKeyMap.set(key, idx)
        stepIndices.push(idx)
        steps.push(idStep)
      }
    }
  }

  // Set timeLowerBound on the second step from the first
  if (steps.length >= 2) {
    const secondStep = steps[1] as IdCollectStep
    steps[1] = {
      ...secondStep,
      timeLowerBound: { column: 'createdAtMs', fromStep: 0 },
    }
  }

  // MergeStep
  steps.push({
    limit: mergeNode.limit,
    sourceStepIndices: stepIndices,
    strategy: 'interleave-by-time',
    type: 'merge',
  } satisfies MergeStep)

  // DetailFetchSteps for each unique target
  const targets = new Set(
    mergeNode.sources.map((s) =>
      s.source.table === 'notifications' ? 'notifications' : 'posts',
    ),
  )
  for (const target of targets) {
    steps.push({
      sqlTemplate: '{DETAIL_QUERY}',
      target: target as 'posts' | 'notifications',
      type: 'detail-fetch',
    } satisfies DetailFetchStep)
  }

  // BatchEnrichStep
  if (targets.has('posts')) {
    steps.push({
      queries: POST_BATCH_QUERIES,
      type: 'batch-enrich',
    } satisfies BatchEnrichStep)
  }

  return {
    meta: {
      batchKeys: targets.has('posts') ? POST_BATCH_KEYS : [],
      requiresReblogExpansion: targets.has('posts'),
      sourceType: 'mixed',
    },
    steps,
  }
}

// --------------- Main entry point ---------------

export function compileQueryPlan(plan: QueryPlan): ExecutionPlan {
  const mergeNode = plan.composites.find((c) => c.kind === 'merge')
  if (mergeNode && mergeNode.kind === 'merge') {
    return compileMergeNode(mergeNode)
  }
  return compileSingleSource(plan)
}
