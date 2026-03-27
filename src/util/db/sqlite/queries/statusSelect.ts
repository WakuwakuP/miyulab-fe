/**
 * Status 取得用の SQL SELECT 句・JOIN 句・フィルタ構築関数
 *
 * 正規化テーブルから Entity.Status を構築するための SQL 定数と
 * バックエンドスコープ付きクエリビルダーを集約する。
 */

import { BATCH_ENGAGEMENTS_SQL, BATCH_SQL_TEMPLATES } from './statusBatch'

// ================================================================
// 定数
// ================================================================

/** クエリの最大行数上限（LIMIT 未指定時のデフォルト） */
export const MAX_QUERY_LIMIT = 2147483647

// ================================================================
// SELECT 句
// ================================================================

/**
 * 正規化テーブルから Entity.Status を構築するための SELECT 句
 * posts_backends (pb), profiles (pr), visibility_types (vt) の JOIN が必要
 */
export const STATUS_SELECT = `
  p.post_id,
  COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = spb.server_id), '') AS backendUrl,
  spb.local_id AS local_id,
  p.created_at_ms,
  p.stored_at,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.code, 'public') AS visibility_code,
  p.is_sensitive,
  p.is_reblog,
  p.reblog_of_uri,
  p.in_reply_to_id,
  p.edited_at,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.locked, 0) AS author_locked,
  COALESCE(pr.bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  (SELECT group_concat(et.code, ',') FROM post_engagements pe INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id WHERE pe.post_id = p.post_id) AS engagements_csv,
  CASE WHEN p.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = p.post_id ORDER BY pm.sort_order) ELSE NULL END AS media_json,
  (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = p.post_id) AS mentions_json,
  (SELECT json_group_array(ck.code) FROM timeline_items ti INNER JOIN timelines t ON t.timeline_id = ti.timeline_id INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id WHERE ti.post_id = p.post_id) AS timelineTypes,
  (SELECT json_group_array(ht.display_name) FROM post_hashtags pht INNER JOIN hashtags ht ON pht.hashtag_id = ht.hashtag_id WHERE pht.post_id = p.post_id) AS belongingTags,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = p.post_id AND pce.usage_context = 'status') AS status_emojis_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = p.post_id AND pce.usage_context = 'account') AS account_emojis_json,
  (SELECT json_object('id', pl.poll_id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.poll_id ORDER BY po.option_index)) FROM polls pl WHERE pl.post_id = p.post_id) AS poll_json,
  rs.post_id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.code, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.locked, 0) AS rb_author_locked,
  COALESCE(rpr.bot, 0) AS rb_author_bot,
  COALESCE(rpr.actor_uri, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT group_concat(et.code, ',') FROM post_engagements pe INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id WHERE pe.post_id = rs.post_id)
    ELSE NULL
  END AS rb_engagements_csv,
  CASE WHEN rs.has_media = 1 THEN (SELECT json_group_array(json_object('id', pm.remote_media_id, 'type', COALESCE((SELECT mt.code FROM media_types mt WHERE mt.media_type_id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.url)) FROM post_media pm WHERE pm.post_id = rs.post_id ORDER BY pm.sort_order) ELSE NULL END AS rb_media_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('acct', pme.acct)) FROM posts_mentions pme WHERE pme.post_id = rs.post_id)
    ELSE NULL
  END AS rb_mentions_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rs.post_id AND pce.usage_context = 'status')
    ELSE NULL
  END AS rb_status_emojis_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.image_url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.emoji_id = ce.emoji_id WHERE pce.post_id = rs.post_id AND pce.usage_context = 'account')
    ELSE NULL
  END AS rb_account_emojis_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN (SELECT json_object('id', pl.poll_id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.poll_id ORDER BY po.option_index)) FROM polls pl WHERE pl.post_id = rs.post_id)
    ELSE NULL
  END AS rb_poll_json,
  CASE WHEN rs.post_id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id AND rpb.server_id = spb.server_id LIMIT 1),
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id ORDER BY rpb.server_id LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(pra.remote_account_id, '') AS author_account_id,
  COALESCE(rpra.remote_account_id, '') AS rb_author_account_id,
  ps.emoji_reactions_json,
  rps.emoji_reactions_json AS rb_emoji_reactions_json`

// ================================================================
// Phase2 バッチクエリ用の SELECT 句
// ================================================================

/**
 * Phase2-A: 相関サブクエリを除いた本体 + 1:1 JOIN の SELECT 句
 *
 * useCustomQueryTimeline.ts のインライン Phase2 でも使用するため export する。
 *
 * rowToBaseRow のレイアウト:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  stored_at        [5]  object_uri
 *   [6]  content_html    [7]  spoiler_text     [8]  canonical_url
 *   [9]  language        [10] visibility_code  [11] is_sensitive
 *   [12] is_reblog       [13] reblog_of_uri    [14] in_reply_to_id
 *   [15] edited_at       [16] author_acct      [17] author_username
 *   [18] author_display  [19] author_avatar    [20] author_header
 *   [21] author_locked   [22] author_bot       [23] author_url
 *   [24] replies_count   [25] reblogs_count    [26] favourites_count
 *   [27] rb_post_id      [28] rb_content_html  [29] rb_spoiler_text
 *   [30] rb_canonical_url [31] rb_language     [32] rb_visibility_code
 *   [33] rb_is_sensitive  [34] rb_in_reply_to_id [35] rb_edited_at
 *   [36] rb_created_at_ms [37] rb_object_uri   [38] rb_author_acct
 *   [39] rb_author_username [40] rb_author_display [41] rb_author_avatar
 *   [42] rb_author_header [43] rb_author_locked [44] rb_author_bot
 *   [45] rb_author_url   [46] rb_replies_count [47] rb_reblogs_count
 *   [48] rb_favourites_count
 *   [49] rb_local_id     [50] author_account_id [51] rb_author_account_id
 *   [52] emoji_reactions_json [53] rb_emoji_reactions_json
 */
export const STATUS_BASE_SELECT = `
  p.post_id,
  COALESCE((SELECT sv2.base_url FROM servers sv2 WHERE sv2.server_id = spb.server_id), '') AS backendUrl,
  spb.local_id AS local_id,
  p.created_at_ms,
  p.stored_at,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.code, 'public') AS visibility_code,
  p.is_sensitive,
  p.is_reblog,
  p.reblog_of_uri,
  p.in_reply_to_id,
  p.edited_at,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.locked, 0) AS author_locked,
  COALESCE(pr.bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  rs.post_id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.code, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.locked, 0) AS rb_author_locked,
  COALESCE(rpr.bot, 0) AS rb_author_bot,
  COALESCE(rpr.actor_uri, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.post_id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id AND rpb.server_id = spb.server_id LIMIT 1),
      (SELECT rpb.local_id FROM posts_backends rpb WHERE rpb.post_id = rs.post_id ORDER BY rpb.server_id LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(pra.remote_account_id, '') AS author_account_id,
  COALESCE(rpra.remote_account_id, '') AS rb_author_account_id,
  ps.emoji_reactions_json,
  rps.emoji_reactions_json AS rb_emoji_reactions_json`

// ================================================================
// フィルタ・JOIN 構築関数
// ================================================================

/**
 * spb バックエンドフィルタを構築する。
 *
 * パネルが特定のバックエンドにフィルタされている場合、spb サブクエリに
 * AND 条件を追加して、そのバックエンド群の中から MIN を取る。
 * これにより local_id / profile_aliases がパネルのバックエンドに対応する。
 *
 * backendUrls が空の場合はフィルタなし（全バックエンドから MIN を取る従来動作）。
 *
 * NOTE: バックエンド URL はアプリ設定由来であり、ユーザー入力ではないため
 * リテラル埋め込みは安全。bind パラメータ変更を避けるためこの方式を採用。
 */
export function buildSpbFilter(backendUrls: string[]): string {
  if (backendUrls.length === 0) return ''
  const quoted = backendUrls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',')
  return `AND spb_min.server_id IN (SELECT sv.server_id FROM servers sv WHERE sv.base_url IN (${quoted}))`
}

/**
 * local_account_id でスコープされたエンゲージメントバッチ SQL を構築する。
 *
 * post_engagements にはアカウントごとにお気に入り/ブースト/ブックマークが
 * 記録されるため、対象アカウントのエンゲージメントのみを返すようにフィルタする。
 *
 * @param backendUrls — 対象バックエンド URL（安全にエスケープされる）
 * @param placeholder — SQL プレースホルダ文字列。fetchTimeline 用は `'{IDS}'`、executeBatchQueries 用は `'__PH__'`
 */
export function buildScopedEngagementsSql(
  backendUrls: string[],
  placeholder = '{IDS}',
): string {
  if (backendUrls.length === 0) {
    return placeholder === '{IDS}'
      ? BATCH_SQL_TEMPLATES.engagements
      : BATCH_ENGAGEMENTS_SQL
  }
  const quoted = backendUrls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',')
  return `
  SELECT pe.post_id, group_concat(et.code, ',') AS engagements_csv
  FROM post_engagements pe
  INNER JOIN engagement_types et ON pe.engagement_type_id = et.engagement_type_id
  WHERE pe.post_id IN (${placeholder})
    AND pe.local_account_id IN (
      SELECT la.local_account_id FROM local_accounts la
      INNER JOIN servers sv ON la.server_id = sv.server_id
      WHERE sv.base_url IN (${quoted})
    )
  GROUP BY pe.post_id`
}

/**
 * local_account_id でスコープされたバッチ SQL テンプレートを構築する。
 *
 * engagements のみがスコープ対象。他のバッチクエリは共通テンプレートをそのまま使う。
 */
export function buildScopedBatchTemplates(backendUrls: string[]): {
  [K in keyof typeof BATCH_SQL_TEMPLATES]: string
} {
  return {
    ...BATCH_SQL_TEMPLATES,
    engagements: buildScopedEngagementsSql(backendUrls),
  }
}

/**
 * 正規化テーブルの基本 JOIN 句（profiles, visibility_types, posts_backends）
 *
 * spbFilter を渡すと、spb（Selected Posts Backend）のバックエンド選択を
 * 指定されたバックエンド群に限定する。パネルごとに異なるバックエンドで
 * フィルタされたタイムラインが同時に存在する場合、各パネルに正しい
 * local_id / account.id が返るようになる。
 */
export function buildStatusBaseJoins(spbFilter = ''): string {
  return `
  LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
  LEFT JOIN visibility_types vt ON p.visibility_id = vt.visibility_id
  LEFT JOIN posts_backends pb ON p.post_id = pb.post_id
  LEFT JOIN post_stats ps ON p.post_id = ps.post_id
  LEFT JOIN posts rs ON (
    (p.repost_of_post_id IS NOT NULL AND rs.post_id = p.repost_of_post_id)
    OR (p.repost_of_post_id IS NULL AND p.reblog_of_uri IS NOT NULL AND rs.object_uri = p.reblog_of_uri AND rs.object_uri != '')
  )
  LEFT JOIN profiles rpr ON rs.author_profile_id = rpr.profile_id
  LEFT JOIN visibility_types rvt ON rs.visibility_id = rvt.visibility_id
  LEFT JOIN post_stats rps ON rs.post_id = rps.post_id
  LEFT JOIN posts_backends spb
    ON spb.post_id = p.post_id
    AND spb.server_id = (
      SELECT MIN(spb_min.server_id)
      FROM posts_backends spb_min
      WHERE spb_min.post_id = p.post_id
        ${spbFilter}
    )
  LEFT JOIN profile_aliases pra ON pra.profile_id = pr.profile_id AND pra.server_id = spb.server_id
  LEFT JOIN profile_aliases rpra ON rpra.profile_id = rpr.profile_id AND rpra.server_id = spb.server_id`
}

/** フィルタなしのデフォルト JOIN（後方互換） */
export const STATUS_BASE_JOINS = buildStatusBaseJoins()

/**
 * Phase2 テンプレートを構築する。
 *
 * spbFilter を渡すと spb のバックエンド選択がフィルタされる。
 * {IDS} プレースホルダは Worker 側で post_id IN 句に置換される。
 */
export function buildPhase2Template(spbFilter = ''): string {
  return `
  SELECT ${STATUS_BASE_SELECT}
  FROM posts p
  ${buildStatusBaseJoins(spbFilter)}
  WHERE p.post_id IN ({IDS})
  GROUP BY p.post_id
  ORDER BY p.created_at_ms DESC;
`
}

/** フィルタなしのデフォルトテンプレート（後方互換） */
export const PHASE2_BASE_TEMPLATE = buildPhase2Template()
