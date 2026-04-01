// ============================================================
// QueryPlan / QueryPlanV2 → 実行用 QueryPlan (V1 形状 + enrich)
// ============================================================

import type { QueryPlan, QueryPlanV2 } from '../nodes'
import { isQueryPlanV2 } from '../nodes'
import { queryPlanV2ToQueryPlanV1 } from '../v2/v2ToV1'
import { type ConfigToNodesContext, enrichQueryPlan } from './configToNodes'

export function normalizeQueryPlanForExecution(
  plan: QueryPlan | QueryPlanV2,
  ctx: ConfigToNodesContext,
): QueryPlan {
  const v1 = isQueryPlanV2(plan) ? queryPlanV2ToQueryPlanV1(plan) : plan
  return enrichQueryPlan(v1, ctx)
}
