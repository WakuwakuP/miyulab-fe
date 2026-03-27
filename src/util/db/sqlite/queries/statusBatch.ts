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

/** post_id → interactions_json のバッチクエリ */
export const BATCH_INTERACTIONS_SQL = `
  SELECT pi.post_id,
    json_object(
      'is_favourited', pi.is_favourited,
      'is_reblogged', pi.is_reblogged,
      'is_bookmarked', pi.is_bookmarked,
      'is_muted', pi.is_muted,
      'is_pinned', pi.is_pinned,
      'my_reaction_name', pi.my_reaction_name,
      'my_reaction_url', pi.my_reaction_url
    ) AS interactions_json
  FROM post_interactions pi
  WHERE pi.post_id IN (__PH__)`

/** post_id → media_json のバッチクエリ */
export const BATCH_MEDIA_SQL = `
  SELECT pm.post_id,
    json_group_array(
      json_object(
        'id', pm.media_local_id,
        'type', COALESCE((SELECT mt.name FROM media_types mt WHERE mt.id = pm.media_type_id), 'unknown'),
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
    json_group_array(
      json_object('acct', pme.acct, 'username', pme.username, 'url', pme.url)
    ) AS mentions_json
  FROM post_mentions pme
  WHERE pme.post_id IN (__PH__)
  GROUP BY pme.post_id`

/** post_id → timelineTypes JSON のバッチクエリ */
export const BATCH_TIMELINE_TYPES_SQL = `
  SELECT te.post_id,
    json_group_array(te.timeline_key) AS timelineTypes
  FROM timeline_entries te
  WHERE te.post_id IN (__PH__)
  GROUP BY te.post_id`

/** post_id → belongingTags JSON のバッチクエリ */
export const BATCH_BELONGING_TAGS_SQL = `
  SELECT pht.post_id,
    json_group_array(ht.name) AS belongingTags
  FROM post_hashtags pht
  INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
  WHERE pht.post_id IN (__PH__)
  GROUP BY pht.post_id`

/** post_id → custom_emojis JSON のバッチクエリ */
export const BATCH_CUSTOM_EMOJIS_SQL = `
  SELECT pce.post_id,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM post_custom_emojis pce
  INNER JOIN custom_emojis ce ON pce.custom_emoji_id = ce.id
  WHERE pce.post_id IN (__PH__)
  GROUP BY pce.post_id`

/** post_id → poll_json のバッチクエリ */
export const BATCH_POLLS_SQL = `
  SELECT p.post_id,
    json_object(
      'id', p.id,
      'expires_at', p.expires_at,
      'expired', p.expired,
      'multiple', p.multiple,
      'votes_count', p.votes_count,
      'options', (
        SELECT json_group_array(
          json_object('title', po.title, 'votes_count', po.votes_count)
        )
        FROM poll_options po
        WHERE po.poll_id = p.id
        ORDER BY po.sort_order
      ),
      'voted', pv.voted,
      'own_votes', pv.own_votes_json
    ) AS poll_json
  FROM polls p
  LEFT JOIN poll_votes pv ON p.id = pv.poll_id AND pv.local_account_id = ?
  WHERE p.post_id IN (__PH__)`

// ================================================================
// fetchTimeline 用 SQL テンプレート（{IDS} プレースホルダ版）
// ================================================================

/** Batch SQL テンプレート群（{IDS} を post_id IN 句に置換して使用） */
export const BATCH_SQL_TEMPLATES = {
  belongingTags: `
  SELECT pht.post_id,
    json_group_array(ht.name) AS belongingTags
  FROM post_hashtags pht
  INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
  WHERE pht.post_id IN ({IDS})
  GROUP BY pht.post_id`,
  customEmojis: `
  SELECT pce.post_id,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM post_custom_emojis pce
  INNER JOIN custom_emojis ce ON pce.custom_emoji_id = ce.id
  WHERE pce.post_id IN ({IDS})
  GROUP BY pce.post_id`,
  interactions: `
  SELECT pi.post_id,
    json_object(
      'is_favourited', pi.is_favourited,
      'is_reblogged', pi.is_reblogged,
      'is_bookmarked', pi.is_bookmarked,
      'is_muted', pi.is_muted,
      'is_pinned', pi.is_pinned,
      'my_reaction_name', pi.my_reaction_name,
      'my_reaction_url', pi.my_reaction_url
    ) AS interactions_json
  FROM post_interactions pi
  WHERE pi.post_id IN ({IDS})`,
  media: `
  SELECT pm.post_id,
    json_group_array(
      json_object(
        'id', pm.media_local_id,
        'type', COALESCE((SELECT mt.name FROM media_types mt WHERE mt.id = pm.media_type_id), 'unknown'),
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
    json_group_array(
      json_object('acct', pme.acct, 'username', pme.username, 'url', pme.url)
    ) AS mentions_json
  FROM post_mentions pme
  WHERE pme.post_id IN ({IDS})
  GROUP BY pme.post_id`,
  polls: `
  SELECT p.post_id,
    json_object(
      'id', p.id,
      'expires_at', p.expires_at,
      'expired', p.expired,
      'multiple', p.multiple,
      'votes_count', p.votes_count,
      'options', (
        SELECT json_group_array(
          json_object('title', po.title, 'votes_count', po.votes_count)
        )
        FROM poll_options po
        WHERE po.poll_id = p.id
        ORDER BY po.sort_order
      ),
      'voted', pv.voted,
      'own_votes', pv.own_votes_json
    ) AS poll_json
  FROM polls p
  LEFT JOIN poll_votes pv ON p.id = pv.poll_id AND pv.local_account_id = ?
  WHERE p.post_id IN ({IDS})`,
  timelineTypes: `
  SELECT te.post_id,
    json_group_array(te.timeline_key) AS timelineTypes
  FROM timeline_entries te
  WHERE te.post_id IN ({IDS})
  GROUP BY te.post_id`,
} as const

// ================================================================
// バッチクエリ結果の型
// ================================================================

/** FetchTimelineResult.batchResults の型（Worker からの生行データ） */
export type BatchResultRows = {
  interactions: (string | number | null)[][]
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
  interactionsMap: Map<number, string>
  mediaMap: Map<number, string>
  mentionsMap: Map<number, string>
  timelineTypesMap: Map<number, string>
  belongingTagsMap: Map<number, string>
  customEmojisMap: Map<number, string>
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
  // interactions: [post_id, interactions_json]
  const interactionsMap = new Map<number, string>()
  for (const row of batchResults.interactions) {
    interactionsMap.set(row[0] as number, row[1] as string)
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

  // customEmojis: [post_id, emojis_json] — usage_context 廃止
  const customEmojisMap = new Map<number, string>()
  for (const row of batchResults.customEmojis) {
    customEmojisMap.set(row[0] as number, row[1] as string)
  }

  const pollsMap = new Map<number, string>()
  for (const row of batchResults.polls) {
    pollsMap.set(row[0] as number, row[1] as string)
  }

  // emoji_reactions は基本行に含まれるため、バッチクエリ不要。
  const emojiReactionsMap = new Map<number, string>()

  return {
    belongingTagsMap,
    customEmojisMap,
    emojiReactionsMap,
    interactionsMap,
    mediaMap,
    mentionsMap,
    pollsMap,
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
  options?: { interactionsSql?: string; localAccountId?: number },
): Promise<BatchMaps> {
  if (allPostIds.length === 0) {
    return {
      belongingTagsMap: new Map(),
      customEmojisMap: new Map(),
      emojiReactionsMap: new Map(),
      interactionsMap: new Map(),
      mediaMap: new Map(),
      mentionsMap: new Map(),
      pollsMap: new Map(),
      timelineTypesMap: new Map(),
    }
  }

  const count = allPostIds.length

  // polls は local_account_id を先頭パラメータとして追加する
  const pollsBind: (number | null)[] = [
    options?.localAccountId ?? null,
    ...allPostIds,
  ]

  // 全バッチクエリを並列実行
  // NOTE: sessionTag を渡さない。7 本のクエリが同一 sessionTag を共有すると、
  // workerClient の sendRequest インプレース置換により後続リクエストが先行を
  // キャンセル (undefined で resolve) し、"s is not iterable" エラーになる。
  const [
    interactionRows,
    mediaRows,
    mentionRows,
    timelineTypeRows,
    belongingTagRows,
    emojiRows,
    pollRows,
  ] = await Promise.all([
    handle.execAsync(
      replacePlaceholders(
        options?.interactionsSql ?? BATCH_INTERACTIONS_SQL,
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
      bind: pollsBind,
      kind: 'timeline',
      returnValue: 'resultRows',
    }) as Promise<(string | number | null)[][]>,
  ])

  // 結果を Map に変換
  const interactionsMap = new Map<number, string>()
  for (const row of interactionRows) {
    interactionsMap.set(row[0] as number, row[1] as string)
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

  // customEmojis: [post_id, emojis_json] — usage_context 廃止
  const customEmojisMap = new Map<number, string>()
  for (const row of emojiRows) {
    customEmojisMap.set(row[0] as number, row[1] as string)
  }

  const pollsMap = new Map<number, string>()
  for (const row of pollRows) {
    pollsMap.set(row[0] as number, row[1] as string)
  }

  // emoji_reactions は基本行に含まれるため、バッチクエリ不要。
  const emojiReactionsMap = new Map<number, string>()

  return {
    belongingTagsMap,
    customEmojisMap,
    emojiReactionsMap,
    interactionsMap,
    mediaMap,
    mentionsMap,
    pollsMap,
    timelineTypesMap,
  }
}
