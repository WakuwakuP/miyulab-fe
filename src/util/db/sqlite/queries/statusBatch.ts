/**
 * バッチクエリ用の SQL 定数・型定義・実行ヘルパー
 *
 * Phase2 バッチクエリで子テーブルのデータをまとめて取得するロジックを集約する。
 */

import type { getSqliteDb } from '../connection'

// ================================================================
// SqliteHandle 型
// ================================================================

export type SqliteHandle = Awaited<ReturnType<typeof getSqliteDb>>

// ================================================================
// バッチクエリ SQL 定数（__PH__ プレースホルダ版）
// ================================================================

/** post_id → engagements_csv (例: "favourite,bookmark") のバッチクエリ */
export const BATCH_ENGAGEMENTS_SQL = `
  SELECT pe.post_id, group_concat(et.code, ',') AS engagements_csv
  FROM post_engagements pe
  INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
  WHERE pe.post_id IN (__PH__)
  GROUP BY pe.post_id`

/** post_id → media_json のバッチクエリ */
export const BATCH_MEDIA_SQL = `
  SELECT pm.post_id,
    json_group_array(
      json_object(
        'id', pm.remote_media_id,
        'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'),
        'url', pm.url,
        'preview_url', pm.preview_url,
        'description', pm.description,
        'blurhash', pm.blurhash,
        'remote_url', pm.url
      )
    ) AS media_json
  FROM post_media pm
  WHERE pm.post_id IN (__PH__)
  GROUP BY pm.post_id
  ORDER BY pm.post_id, pm.sort_order`

/** post_id → mentions_json のバッチクエリ */
export const BATCH_MENTIONS_SQL = `
  SELECT pme.post_id,
    json_group_array(json_object('acct', pme.acct)) AS mentions_json
  FROM posts_mentions pme
  WHERE pme.post_id IN (__PH__)
  GROUP BY pme.post_id`

/** post_id → timelineTypes JSON のバッチクエリ */
export const BATCH_TIMELINE_TYPES_SQL = `
  SELECT ti.post_id,
    json_group_array(ck.code) AS timelineTypes
  FROM timeline_items ti
  INNER JOIN timelines t ON t.timeline_id = ti.timeline_id
  INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
  WHERE ti.post_id IN (__PH__)
  GROUP BY ti.post_id`

/** post_id → belongingTags JSON のバッチクエリ */
export const BATCH_BELONGING_TAGS_SQL = `
  SELECT pht.post_id,
    json_group_array(ht.display_name) AS belongingTags
  FROM post_hashtags pht
  INNER JOIN hashtags ht ON pht.hashtag_id = ht.hashtag_id
  WHERE pht.post_id IN (__PH__)
  GROUP BY pht.post_id`

/** post_id → custom_emojis JSON (status / account 両方) のバッチクエリ */
export const BATCH_CUSTOM_EMOJIS_SQL = `
  SELECT pce.post_id, pce.usage_context,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.image_url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM post_custom_emojis pce
  INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id
  WHERE pce.post_id IN (__PH__)
  GROUP BY pce.post_id, pce.usage_context`

/** post_id → poll_json のバッチクエリ */
export const BATCH_POLLS_SQL = `
  SELECT pl.post_id,
    json_object(
      'id', pl.poll_id,
      'expires_at', pl.expires_at,
      'multiple', pl.multiple,
      'votes_count', pl.votes_count,
      'options', (
        SELECT json_group_array(
          json_object('title', po.title, 'votes_count', po.votes_count)
        )
        FROM poll_options po
        WHERE po.poll_id = pl.poll_id
        ORDER BY po.option_index
      )
    ) AS poll_json
  FROM polls pl
  WHERE pl.post_id IN (__PH__)`

// ================================================================
// fetchTimeline 用 SQL テンプレート（{IDS} プレースホルダ版）
// ================================================================

/** Batch SQL テンプレート群（{IDS} を post_id IN 句に置換して使用） */
export const BATCH_SQL_TEMPLATES = {
  belongingTags: `
  SELECT pht.post_id,
    json_group_array(ht.display_name) AS belongingTags
  FROM post_hashtags pht
  INNER JOIN hashtags ht ON pht.hashtag_id = ht.hashtag_id
  WHERE pht.post_id IN ({IDS})
  GROUP BY pht.post_id`,
  customEmojis: `
  SELECT pce.post_id, pce.usage_context,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.image_url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM post_custom_emojis pce
  INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id
  WHERE pce.post_id IN ({IDS})
  GROUP BY pce.post_id, pce.usage_context`,
  engagements: `
  SELECT pe.post_id, group_concat(et.code, ',') AS engagements_csv
  FROM post_engagements pe
  INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
  WHERE pe.post_id IN ({IDS})
  GROUP BY pe.post_id`,
  media: `
  SELECT pm.post_id,
    json_group_array(
      json_object(
        'id', pm.remote_media_id,
        'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'),
        'url', pm.url,
        'preview_url', pm.preview_url,
        'description', pm.description,
        'blurhash', pm.blurhash,
        'remote_url', pm.url
      )
    ) AS media_json
  FROM post_media pm
  WHERE pm.post_id IN ({IDS})
  GROUP BY pm.post_id
  ORDER BY pm.post_id, pm.sort_order`,
  mentions: `
  SELECT pme.post_id,
    json_group_array(json_object('acct', pme.acct)) AS mentions_json
  FROM posts_mentions pme
  WHERE pme.post_id IN ({IDS})
  GROUP BY pme.post_id`,
  polls: `
  SELECT pl.post_id,
    json_object(
      'id', pl.poll_id,
      'expires_at', pl.expires_at,
      'multiple', pl.multiple,
      'votes_count', pl.votes_count,
      'options', (
        SELECT json_group_array(
          json_object('title', po.title, 'votes_count', po.votes_count)
        )
        FROM poll_options po
        WHERE po.poll_id = pl.poll_id
        ORDER BY po.option_index
      )
    ) AS poll_json
  FROM polls pl
  WHERE pl.post_id IN ({IDS})`,
  timelineTypes: `
  SELECT ti.post_id,
    json_group_array(ck.code) AS timelineTypes
  FROM timeline_items ti
  INNER JOIN timelines t ON t.timeline_id = ti.timeline_id
  INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
  WHERE ti.post_id IN ({IDS})
  GROUP BY ti.post_id`,
} as const

// ================================================================
// バッチクエリ結果の型
// ================================================================

/** FetchTimelineResult.batchResults の型（Worker からの生行データ） */
export type BatchResultRows = {
  engagements: (string | number | null)[][]
  media: (string | number | null)[][]
  mentions: (string | number | null)[][]
  timelineTypes: (string | number | null)[][]
  belongingTags: (string | number | null)[][]
  customEmojis: (string | number | null)[][]
  polls: (string | number | null)[][]
}

// ================================================================
// バッチクエリ結果の Map 型
// ================================================================

export interface BatchMaps {
  engagementsMap: Map<number, string>
  mediaMap: Map<number, string>
  mentionsMap: Map<number, string>
  timelineTypesMap: Map<number, string>
  belongingTagsMap: Map<number, string>
  statusEmojisMap: Map<number, string>
  accountEmojisMap: Map<number, string>
  pollsMap: Map<number, string>
  emojiReactionsMap: Map<number, string>
}

// ================================================================
// バッチクエリ結果から Map を構築するヘルパー
// ================================================================

/**
 * FetchTimelineResult.batchResults の生行データから BatchMaps を構築する。
 *
 * executeBatchQueries 内の Map 構築ロジックと同一の変換を行う。
 * Worker 側で一括取得した結果をメインスレッドで Map に変換するために使用する。
 */
export function buildBatchMapsFromResults(
  batchResults: BatchResultRows,
): BatchMaps {
  const engagementsMap = new Map<number, string>()
  for (const row of batchResults.engagements) {
    engagementsMap.set(row[0] as number, row[1] as string)
  }

  const mediaMap = new Map<number, string>()
  for (const row of batchResults.media) {
    mediaMap.set(row[0] as number, row[1] as string)
  }

  const mentionsMap = new Map<number, string>()
  for (const row of batchResults.mentions) {
    mentionsMap.set(row[0] as number, row[1] as string)
  }

  const timelineTypesMap = new Map<number, string>()
  for (const row of batchResults.timelineTypes) {
    timelineTypesMap.set(row[0] as number, row[1] as string)
  }

  const belongingTagsMap = new Map<number, string>()
  for (const row of batchResults.belongingTags) {
    belongingTagsMap.set(row[0] as number, row[1] as string)
  }

  // emojis は usage_context ごとに分ける: [post_id, usage_context, emojis_json]
  const statusEmojisMap = new Map<number, string>()
  const accountEmojisMap = new Map<number, string>()
  for (const row of batchResults.customEmojis) {
    const postId = row[0] as number
    const context = row[1] as string
    const json = row[2] as string
    if (context === 'status') {
      statusEmojisMap.set(postId, json)
    } else if (context === 'account') {
      accountEmojisMap.set(postId, json)
    }
  }

  const pollsMap = new Map<number, string>()
  for (const row of batchResults.polls) {
    pollsMap.set(row[0] as number, row[1] as string)
  }

  // emoji_reactions は Phase2-A の基本行に含まれるため、バッチクエリ不要。
  // assembleStatusFromBatch 内で row[52] / row[53] から直接読み取る。
  const emojiReactionsMap = new Map<number, string>()

  return {
    accountEmojisMap,
    belongingTagsMap,
    emojiReactionsMap,
    engagementsMap,
    mediaMap,
    mentionsMap,
    pollsMap,
    statusEmojisMap,
    timelineTypesMap,
  }
}

// ================================================================
// バッチクエリ実行ヘルパー
// ================================================================

/**
 * プレースホルダ文字列 __PH__ を実際の (?, ?, ...) に置換する
 */
export function replacePlaceholders(sql: string, count: number): string {
  const ph = Array.from({ length: count }, () => '?').join(',')
  return sql.replace('__PH__', ph)
}

/**
 * allPostIds に対して子テーブルのバッチクエリをまとめて実行し、
 * post_id をキーとした Map 群を返す。
 *
 * 親投稿とリブログ元投稿の post_id を両方含めた allPostIds を渡すことで、
 * 1 回のバッチクエリで両方のデータを取得できる。
 */
export async function executeBatchQueries(
  handle: SqliteHandle,
  allPostIds: number[],
  options?: { engagementsSql?: string },
): Promise<BatchMaps> {
  if (allPostIds.length === 0) {
    return {
      accountEmojisMap: new Map(),
      belongingTagsMap: new Map(),
      emojiReactionsMap: new Map(),
      engagementsMap: new Map(),
      mediaMap: new Map(),
      mentionsMap: new Map(),
      pollsMap: new Map(),
      statusEmojisMap: new Map(),
      timelineTypesMap: new Map(),
    }
  }

  const count = allPostIds.length

  // 全バッチクエリを並列実行
  // NOTE: sessionTag を渡さない。7 本のクエリが同一 sessionTag を共有すると、
  // workerClient の sendRequest インプレース置換により後続リクエストが先行を
  // キャンセル (undefined で resolve) し、"s is not iterable" エラーになる。
  const [
    engagementRows,
    mediaRows,
    mentionRows,
    timelineTypeRows,
    belongingTagRows,
    emojiRows,
    pollRows,
  ] = await Promise.all([
    handle.execAsync(
      replacePlaceholders(
        options?.engagementsSql ?? BATCH_ENGAGEMENTS_SQL,
        count,
      ),
      {
        bind: allPostIds,
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    ) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_MEDIA_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_MENTIONS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_TIMELINE_TYPES_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_BELONGING_TAGS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_CUSTOM_EMOJIS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
    handle.execAsync(replacePlaceholders(BATCH_POLLS_SQL, count), {
      bind: allPostIds,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
  ])

  // 結果を Map に変換
  const engagementsMap = new Map<number, string>()
  for (const row of engagementRows) {
    engagementsMap.set(row[0] as number, row[1] as string)
  }

  const mediaMap = new Map<number, string>()
  for (const row of mediaRows) {
    mediaMap.set(row[0] as number, row[1] as string)
  }

  const mentionsMap = new Map<number, string>()
  for (const row of mentionRows) {
    mentionsMap.set(row[0] as number, row[1] as string)
  }

  const timelineTypesMap = new Map<number, string>()
  for (const row of timelineTypeRows) {
    timelineTypesMap.set(row[0] as number, row[1] as string)
  }

  const belongingTagsMap = new Map<number, string>()
  for (const row of belongingTagRows) {
    belongingTagsMap.set(row[0] as number, row[1] as string)
  }

  // emojis は usage_context ごとに分ける: [post_id, usage_context, emojis_json]
  const statusEmojisMap = new Map<number, string>()
  const accountEmojisMap = new Map<number, string>()
  for (const row of emojiRows) {
    const postId = row[0] as number
    const context = row[1] as string
    const json = row[2] as string
    if (context === 'status') {
      statusEmojisMap.set(postId, json)
    } else if (context === 'account') {
      accountEmojisMap.set(postId, json)
    }
  }

  const pollsMap = new Map<number, string>()
  for (const row of pollRows) {
    pollsMap.set(row[0] as number, row[1] as string)
  }

  // emoji_reactions は Phase2-A の基本行に含まれるため、バッチクエリ不要。
  // assembleStatusFromBatch 内で row[52] / row[53] から直接読み取る。
  const emojiReactionsMap = new Map<number, string>()

  return {
    accountEmojisMap,
    belongingTagsMap,
    emojiReactionsMap,
    engagementsMap,
    mediaMap,
    mentionsMap,
    pollsMap,
    statusEmojisMap,
    timelineTypesMap,
  }
}
