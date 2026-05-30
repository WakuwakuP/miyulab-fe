import type { TimelineConfigV2 } from 'types/types'
import {
  buildInstanceBlockCondition,
  buildMuteCondition,
} from 'util/queryBuilder'

type FilterBuildContext = {
  conditions: string[]
  binds: (string | number)[]
  prefix: string
}

function appendMediaFilter(
  config: TimelineConfigV2,
  ctx: FilterBuildContext,
): void {
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    ctx.conditions.push(
      `(SELECT COUNT(*) FROM post_media WHERE post_id = ${ctx.prefix}id) >= ?`,
    )
    ctx.binds.push(config.minMediaCount)
  } else if (config.onlyMedia) {
    ctx.conditions.push(
      `EXISTS(SELECT 1 FROM post_media WHERE post_id = ${ctx.prefix}id)`,
    )
  }
}

function appendVisibilityFilter(
  config: TimelineConfigV2,
  ctx: FilterBuildContext,
): void {
  if (
    config.visibilityFilter != null &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    const placeholders = config.visibilityFilter.map(() => '?').join(',')
    ctx.conditions.push(
      `(SELECT name FROM visibility_types WHERE id = ${ctx.prefix}visibility_id) IN (${placeholders})`,
    )
    ctx.binds.push(...config.visibilityFilter)
  }
}

function appendLanguageFilter(
  config: TimelineConfigV2,
  ctx: FilterBuildContext,
): void {
  if (config.languageFilter != null && config.languageFilter.length > 0) {
    const placeholders = config.languageFilter.map(() => '?').join(',')
    ctx.conditions.push(
      `(${ctx.prefix}language IN (${placeholders}) OR ${ctx.prefix}language IS NULL)`,
    )
    ctx.binds.push(...config.languageFilter)
  }
}

function appendPostExclusionFilters(
  config: TimelineConfigV2,
  ctx: FilterBuildContext,
): void {
  if (config.excludeReblogs) {
    ctx.conditions.push(`${ctx.prefix}is_reblog = 0`)
  }
  if (config.excludeReplies) {
    ctx.conditions.push(`${ctx.prefix}in_reply_to_uri IS NULL`)
  }
  if (config.excludeSpoiler) {
    ctx.conditions.push(`${ctx.prefix}spoiler_text = ''`)
  }
  if (config.excludeSensitive) {
    ctx.conditions.push(`${ctx.prefix}is_sensitive = 0`)
  }
}

function appendAccountFilter(
  config: TimelineConfigV2,
  ctx: FilterBuildContext,
): void {
  if (config.accountFilter != null && config.accountFilter.accts.length > 0) {
    const placeholders = config.accountFilter.accts.map(() => '?').join(',')
    const inClause = config.accountFilter.mode === 'include' ? 'IN' : 'NOT IN'
    ctx.conditions.push(
      `(SELECT acct FROM profiles WHERE id = ${ctx.prefix}author_profile_id) ${inClause} (${placeholders})`,
    )
    ctx.binds.push(...config.accountFilter.accts)
  }
}

function appendMuteFilter(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias: string,
  options: { profileJoined?: boolean } | undefined,
  ctx: FilterBuildContext,
): void {
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    const mute = buildMuteCondition(targetBackendUrls, tableAlias, {
      profileJoined: options?.profileJoined,
    })
    ctx.conditions.push(mute.sql)
    ctx.binds.push(...mute.binds)
  }
}

function appendInstanceBlockFilter(
  config: TimelineConfigV2,
  tableAlias: string,
  options: { profileJoined?: boolean } | undefined,
  ctx: FilterBuildContext,
): void {
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    ctx.conditions.push(
      buildInstanceBlockCondition(tableAlias, {
        profileJoined: options?.profileJoined,
      }),
    )
  }
}

function warnIfFollowsOnlyUnsupported(config: TimelineConfigV2): void {
  if (config.followsOnly) {
    console.warn(
      'followsOnly filter is not yet supported: follows table does not exist',
    )
  }
}

/**
 * TimelineConfigV2 の v2 フィルタオプションから
 * SQL WHERE 句の条件配列とバインド変数を生成する。
 *
 * useFilteredTimeline / useFilteredTagTimeline / useCustomQueryTimeline
 * で共有して使用する。
 *
 * ## 生成される条件
 *
 * - has_media / media_count（メディアフィルタ）
 * - visibility（公開範囲フィルタ）
 * - language（言語フィルタ、NULL は常に表示）
 * - is_reblog（ブースト除外）
 * - in_reply_to_uri（リプライ除外）
 * - has_spoiler（CW 除外）
 * - is_sensitive（センシティブ除外）
 * - account_acct（アカウントフィルタ）
 * - muted_accounts サブクエリ（ミュート除外）
 * - blocked_instances サブクエリ（インスタンスブロック除外）
 *
 * ## 注意
 *
 * backendUrl フィルタは呼び出し元が個別に追加するため、
 * この関数では生成しない。
 *
 * @param config — v2 フィルタ（メディア・公開範囲・ミュート等）の設定
 * @param targetBackendUrls — バインド用に参照する対象インスタンス URL 一覧（ミュート / インスタンスブロック条件で使用）
 * @param tableAlias — カラム参照のプレフィックス。省略時は `'p'`（posts）
 * @param options — `profileJoined: true` のとき `pr` JOIN 前提の account 条件を生成
 * @returns
 * - `conditions`: `WHERE` に `AND` 連結する SQL 断片
 * - `binds`: 上記 `?` に対応するバインド値（`conditions` と同じ順序）
 * @see {@link useFilteredTimeline}
 * @see {@link useFilteredTagTimeline}
 */
export function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias = 'p',
  options?: {
    /** profiles テーブルが pr として JOIN されている場合 true */
    profileJoined?: boolean
  },
): { conditions: string[]; binds: (string | number)[] } {
  const ctx: FilterBuildContext = {
    binds: [],
    conditions: [],
    prefix: tableAlias ? `${tableAlias}.` : '',
  }

  appendMediaFilter(config, ctx)
  appendVisibilityFilter(config, ctx)
  appendLanguageFilter(config, ctx)
  appendPostExclusionFilters(config, ctx)
  appendAccountFilter(config, ctx)
  appendMuteFilter(config, targetBackendUrls, tableAlias, options, ctx)
  appendInstanceBlockFilter(config, tableAlias, options, ctx)
  warnIfFollowsOnlyUnsupported(config)

  return { binds: ctx.binds, conditions: ctx.conditions }
}
