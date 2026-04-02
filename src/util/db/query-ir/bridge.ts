// ============================================================
// Query IR — Bridge: ExecutionPlan → SerializedExecutionPlan
// ============================================================
//
// compile.ts が生成する ExecutionPlan はテンプレートプレースホルダ
// ('{DETAIL_QUERY}', '{MEDIA_QUERY}' 等) を含む。
// このモジュールはそれらを実際の SQL テンプレートに解決し、
// Worker に送信可能な SerializedExecutionPlan を生成する。

import type {
  BatchEnrichResult,
  DetailFetchResult,
  IdCollectResult,
  QueryPlanResult,
  SerializedExecutionPlan,
  SerializedStep,
} from '../sqlite/protocol'
import type { BatchMaps } from '../sqlite/queries/statusBatch'
import { BATCH_SQL_TEMPLATES } from '../sqlite/queries/statusBatch'
import type { SqliteStoredStatus } from '../sqlite/queries/statusMapper'
import { assembleStatusFromBatch } from '../sqlite/queries/statusMapper'
import {
  buildPhase2Template,
  buildScopedBatchTemplates,
  buildSpbFilter,
  PHASE2_BASE_TEMPLATE,
} from '../sqlite/queries/statusSelect'
import type { ExecutionPlan, ExecutionStep } from './plan'

// ---------------------------------------------------------------------------
// reblog_of_post_id のカラムインデックス (STATUS_BASE_SELECT の [27])
// ---------------------------------------------------------------------------
const REBLOG_POST_ID_COLUMN_INDEX = 27

// ---------------------------------------------------------------------------
// テンプレートプレースホルダ → 実 SQL マッピング
// ---------------------------------------------------------------------------

const BATCH_PLACEHOLDER_MAP: Record<string, string> = {
  '{BELONGING_TAGS_QUERY}': BATCH_SQL_TEMPLATES.belongingTags,
  '{CUSTOM_EMOJIS_QUERY}': BATCH_SQL_TEMPLATES.customEmojis,
  '{INTERACTIONS_QUERY}': BATCH_SQL_TEMPLATES.interactions,
  '{MEDIA_QUERY}': BATCH_SQL_TEMPLATES.media,
  '{MENTIONS_QUERY}': BATCH_SQL_TEMPLATES.mentions,
  '{POLLS_QUERY}': BATCH_SQL_TEMPLATES.polls,
  '{PROFILE_EMOJIS_QUERY}': BATCH_SQL_TEMPLATES.profileEmojis,
  '{TIMELINE_TYPES_QUERY}': BATCH_SQL_TEMPLATES.timelineTypes,
}

// ---------------------------------------------------------------------------
// resolvePlanTemplates
// ---------------------------------------------------------------------------

export type ResolveOptions = {
  /** バックエンド URL 一覧 (spbFilter / scoped engagement 用) */
  backendUrls?: string[]
}

/**
 * ExecutionPlan のプレースホルダを実際の SQL テンプレートに解決し、
 * Worker 送信用の SerializedExecutionPlan を返す。
 */
export function resolvePlanTemplates(
  plan: ExecutionPlan,
  options: ResolveOptions = {},
): SerializedExecutionPlan {
  const { backendUrls = [] } = options

  // backend-scoped templates
  const spbFilter = buildSpbFilter(backendUrls)
  const phase2Template = spbFilter
    ? buildPhase2Template(spbFilter)
    : PHASE2_BASE_TEMPLATE
  const scopedBatch = buildScopedBatchTemplates(backendUrls)

  const steps: SerializedStep[] = plan.steps.map((step) =>
    resolveStep(step, phase2Template, scopedBatch),
  )

  return {
    meta: {
      requiresReblogExpansion: plan.meta.requiresReblogExpansion,
      sourceType: plan.meta.sourceType,
    },
    steps,
  }
}

function resolveStep(
  step: ExecutionStep,
  phase2Template: string,
  scopedBatch: ReturnType<typeof buildScopedBatchTemplates>,
): SerializedStep {
  switch (step.type) {
    case 'id-collect':
      return {
        binds: step.binds,
        source: step.source,
        sql: step.sql,
        timeLowerBound: step.timeLowerBound,
        type: 'id-collect',
      }

    case 'merge':
      return {
        limit: step.limit,
        sourceStepIndices: step.sourceStepIndices,
        strategy: step.strategy,
        type: 'merge',
      }

    case 'detail-fetch': {
      const sqlTemplate =
        step.sqlTemplate === '{DETAIL_QUERY}'
          ? phase2Template
          : step.sqlTemplate
      return {
        reblogColumnIndex:
          step.target === 'posts' ? REBLOG_POST_ID_COLUMN_INDEX : undefined,
        sqlTemplate,
        target: step.target,
        type: 'detail-fetch',
      }
    }

    case 'batch-enrich': {
      const resolved: Record<string, string> = {}
      for (const [key, template] of Object.entries(step.queries)) {
        // プレースホルダを実 SQL に置換 (interactions は scoped 版を使用)
        if (key === 'interactions') {
          resolved[key] =
            BATCH_PLACEHOLDER_MAP[template] != null
              ? scopedBatch.interactions
              : template
        } else {
          resolved[key] = BATCH_PLACEHOLDER_MAP[template] ?? template
        }
      }
      return { queries: resolved, type: 'batch-enrich' }
    }
  }
}

// ---------------------------------------------------------------------------
// transformQueryPlanResult — QueryPlanResult → SqliteStoredStatus[]
// ---------------------------------------------------------------------------

/**
 * QueryPlanResult のステップ結果から SqliteStoredStatus[] を組み立てる。
 *
 * 実行エンジンが返す raw rows を、既存の assembleStatusFromBatch() で
 * 同じ形式に変換する。これにより既存の UI コンポーネントとの互換性を維持する。
 */
export function transformQueryPlanResult(result: QueryPlanResult): {
  statuses: SqliteStoredStatus[]
  totalDurationMs: number
} {
  // Step 結果からタイプ別に抽出
  const idCollectResults: IdCollectResult[] = []
  let detailResult: DetailFetchResult | undefined
  let batchResult: BatchEnrichResult | undefined

  for (const sr of result.stepResults) {
    switch (sr.type) {
      case 'id-collect':
        idCollectResults.push(sr)
        break
      case 'detail-fetch':
        detailResult = sr
        break
      case 'batch-enrich':
        batchResult = sr
        break
    }
  }

  if (!detailResult || detailResult.rows.length === 0) {
    return { statuses: [], totalDurationMs: result.totalDurationMs }
  }

  // BatchEnrichResult → BatchMaps
  const maps = buildBatchMapsFromEnrichResult(batchResult)

  // Phase1 から backendUrl / timelineTypes マップを構築
  // compile.ts の Phase1 は id + created_at_ms のみ SELECT するため、
  // backendUrl と timelineTypes は detail-fetch の結果から取得する
  const backendUrlMap = new Map<number, string>()
  for (const idResult of idCollectResults) {
    for (const row of idResult.rows) {
      // row は { id, createdAtMs } の構造化型 — 追加カラムは含まない
      void row
    }
  }

  // Detail rows → SqliteStoredStatus[]
  const statuses = detailResult.rows.map((row) => {
    const status = assembleStatusFromBatch(row, maps)
    const postId = row[0] as number
    // Phase1 で取得した backendUrl で上書き
    const overrideUrl = backendUrlMap.get(postId)
    if (overrideUrl) {
      status.backendUrl = overrideUrl
    }
    return status
  })

  return { statuses, totalDurationMs: result.totalDurationMs }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildBatchMapsFromEnrichResult(
  result: BatchEnrichResult | undefined,
): BatchMaps {
  const empty = new Map<number, string>()

  if (!result) {
    return {
      belongingTagsMap: new Map(),
      customEmojisMap: new Map(),
      emojiReactionsMap: new Map(),
      interactionsMap: new Map(),
      mediaMap: new Map(),
      mentionsMap: new Map(),
      pollsMap: new Map(),
      profileEmojisMap: new Map(),
      timelineTypesMap: new Map(),
    }
  }

  return {
    belongingTagsMap: buildMapFromRows(result.results.belongingTags),
    customEmojisMap: buildMapFromRows(result.results.customEmojis),
    emojiReactionsMap: buildMapFromRows(result.results.emojiReactions) ?? empty,
    interactionsMap: buildMapFromRows(result.results.interactions),
    mediaMap: buildMapFromRows(result.results.media),
    mentionsMap: buildMapFromRows(result.results.mentions),
    pollsMap: buildMapFromRows(result.results.polls),
    profileEmojisMap: buildMapFromRows(result.results.profileEmojis),
    timelineTypesMap: buildMapFromRows(result.results.timelineTypes),
  }
}

/** batch query rows [post_id, json_string] → Map<number, string> */
function buildMapFromRows(
  rows: (string | number | null)[][] | undefined,
): Map<number, string> {
  const map = new Map<number, string>()
  if (!rows) return map
  for (const row of rows) {
    if (row[0] != null && row[1] != null) {
      map.set(row[0] as number, row[1] as string)
    }
  }
  return map
}
