/**
 * Status 取得用の SQL SELECT 句・JOIN 句・フィルタ構築関数
 *
 * 正規化テーブルから Entity.Status を構築するための SQL 定数と
 * バックエンドスコープ付きクエリビルダーを集約する。
 *
 * 新スキーマ対応:
 * - 全 PK: xxx_id → id
 * - visibility_types.code → .name
 * - posts_backends → post_backend_ids
 * - profile_aliases → local_accounts.remote_account_id
 * - post_engagements ⋈ engagement_types → post_interactions (boolean flags)
 * - timeline_items ⋈ timelines ⋈ channel_kinds → timeline_entries.timeline_key
 * - posts_mentions → post_mentions
 * - custom_emojis.image_url → .url, .emoji_id → .id
 * - post_custom_emojis.emoji_id → .custom_emoji_id, usage_context 廃止
 * - profile_custom_emojis で account emojis を取得
 * - hashtags: .hashtag_id → .id, .normalized_name/.display_name → .name
 * - polls: .poll_id → .id, option_index → sort_order
 * - repost_of_post_id → reblog_of_post_id
 * - edited_at TEXT → edited_at_ms INTEGER
 * - stored_at, reblog_of_uri, has_media, is_reblog(stored) 廃止
 */

import { BATCH_INTERACTIONS_SQL, BATCH_SQL_TEMPLATES } from './statusBatch'

// ================================================================
// 定数
// ================================================================

/** クエリの最大行数上限（LIMIT 未指定時のデフォルト） */
export const MAX_QUERY_LIMIT = 2147483647

// ================================================================
// エンゲージメント CSV ビルダー (SQL 断片)
// ================================================================

/**
 * post_interactions の boolean フラグから engagements_csv を構築する SQL 式。
 * SUBSTR(..., 2) で先頭のカンマを除去し、NULLIF で空文字を NULL に変換する。
 */
const ENGAGEMENTS_CSV_EXPR = `NULLIF(SUBSTR(
      CASE WHEN pi2.is_favourited = 1 THEN ',favourite' ELSE '' END ||
      CASE WHEN pi2.is_reblogged = 1 THEN ',reblog' ELSE '' END ||
      CASE WHEN pi2.is_bookmarked = 1 THEN ',bookmark' ELSE '' END ||
      CASE WHEN pi2.is_muted = 1 THEN ',mute' ELSE '' END ||
      CASE WHEN pi2.is_pinned = 1 THEN ',pin' ELSE '' END
    , 2), '')`

// ================================================================
// SELECT 句
// ================================================================

/**
 * 正規化テーブルから Entity.Status を構築するための SELECT 句
 * post_backend_ids (spb), profiles (pr), visibility_types (vt) の JOIN が必要
 */
export const STATUS_SELECT = `
  p.id AS post_id,
  COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = spb.local_account_id), '') AS backendUrl,
  spb.local_id AS local_id,
  p.created_at_ms,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.name, 'public') AS visibility_code,
  p.is_sensitive,
  (p.reblog_of_post_id IS NOT NULL) AS is_reblog,
  p.in_reply_to_id,
  p.edited_at_ms,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.is_locked, 0) AS author_locked,
  COALESCE(pr.is_bot, 0) AS author_bot,
  COALESCE(pr.url, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  (SELECT ${ENGAGEMENTS_CSV_EXPR} FROM post_interactions pi2 WHERE pi2.post_id = p.id LIMIT 1) AS engagements_csv,
  (SELECT json_group_array(json_object('id', pm.media_local_id, 'type', COALESCE((SELECT mt.name FROM media_types mt WHERE mt.id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.remote_url)) FROM post_media pm WHERE pm.post_id = p.id ORDER BY pm.sort_order) AS media_json,
  (SELECT json_group_array(json_object('acct', pme.acct, 'username', pme.username, 'url', pme.url)) FROM post_mentions pme WHERE pme.post_id = p.id) AS mentions_json,
  (SELECT json_group_array(tk) FROM (SELECT DISTINCT te.timeline_key AS tk FROM timeline_entries te WHERE te.post_id = p.id)) AS timelineTypes,
  (SELECT json_group_array(ht.name) FROM post_hashtags pht INNER JOIN hashtags ht ON pht.hashtag_id = ht.id WHERE pht.post_id = p.id) AS belongingTags,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.custom_emoji_id = ce.id WHERE pce.post_id = p.id) AS status_emojis_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM profile_custom_emojis prce INNER JOIN custom_emojis ce ON prce.custom_emoji_id = ce.id WHERE prce.profile_id = p.author_profile_id) AS account_emojis_json,
  (SELECT json_object('id', pl.id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.id ORDER BY po.sort_order)) FROM polls pl WHERE pl.post_id = p.id) AS poll_json,
  rs.id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.name, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at_ms AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.is_locked, 0) AS rb_author_locked,
  COALESCE(rpr.is_bot, 0) AS rb_author_bot,
  COALESCE(rpr.url, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT ${ENGAGEMENTS_CSV_EXPR} FROM post_interactions pi2 WHERE pi2.post_id = rs.id LIMIT 1)
    ELSE NULL
  END AS rb_engagements_csv,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT json_group_array(json_object('id', pm.media_local_id, 'type', COALESCE((SELECT mt.name FROM media_types mt WHERE mt.id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.remote_url)) FROM post_media pm WHERE pm.post_id = rs.id ORDER BY pm.sort_order)
    ELSE NULL
  END AS rb_media_json,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT json_group_array(json_object('acct', pme.acct, 'username', pme.username, 'url', pme.url)) FROM post_mentions pme WHERE pme.post_id = rs.id)
    ELSE NULL
  END AS rb_mentions_json,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.custom_emoji_id = ce.id WHERE pce.post_id = rs.id)
    ELSE NULL
  END AS rb_status_emojis_json,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM profile_custom_emojis prce INNER JOIN custom_emojis ce ON prce.custom_emoji_id = ce.id WHERE prce.profile_id = rs.author_profile_id)
    ELSE NULL
  END AS rb_account_emojis_json,
  CASE WHEN rs.id IS NOT NULL
    THEN (SELECT json_object('id', pl.id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.id ORDER BY po.sort_order)) FROM polls pl WHERE pl.post_id = rs.id)
    ELSE NULL
  END AS rb_poll_json,
  CASE WHEN rs.id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rs.id AND rpb.server_id = spb.server_id LIMIT 1),
      (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rs.id ORDER BY rpb.server_id LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(la_auth.remote_account_id, '') AS author_account_id,
  CASE WHEN rs.id IS NOT NULL
    THEN COALESCE(
      (SELECT la3.remote_account_id FROM post_backend_ids rpb3 INNER JOIN local_accounts la3 ON la3.id = rpb3.local_account_id WHERE rpb3.post_id = rs.id AND rpb3.server_id = spb.server_id LIMIT 1),
      '')
    ELSE ''
  END AS rb_author_account_id,
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
 *   [3]  created_at_ms   [4]  object_uri
 *   [5]  content_html    [6]  spoiler_text     [7]  canonical_url
 *   [8]  language        [9]  visibility_code  [10] is_sensitive
 *   [11] is_reblog       [12] in_reply_to_id
 *   [13] edited_at_ms    [14] author_acct      [15] author_username
 *   [16] author_display  [17] author_avatar    [18] author_header
 *   [19] author_locked   [20] author_bot       [21] author_url
 *   [22] replies_count   [23] reblogs_count    [24] favourites_count
 *   [25] rb_post_id      [26] rb_content_html  [27] rb_spoiler_text
 *   [28] rb_canonical_url [29] rb_language     [30] rb_visibility_code
 *   [31] rb_is_sensitive  [32] rb_in_reply_to_id [33] rb_edited_at
 *   [34] rb_created_at_ms [35] rb_object_uri   [36] rb_author_acct
 *   [37] rb_author_username [38] rb_author_display [39] rb_author_avatar
 *   [40] rb_author_header [41] rb_author_locked [42] rb_author_bot
 *   [43] rb_author_url   [44] rb_replies_count [45] rb_reblogs_count
 *   [46] rb_favourites_count
 *   [47] rb_local_id     [48] author_account_id [49] rb_author_account_id
 *   [50] emoji_reactions_json [51] rb_emoji_reactions_json
 */
export const STATUS_BASE_SELECT = `
  p.id AS post_id,
  COALESCE((SELECT la2.backend_url FROM local_accounts la2 WHERE la2.id = spb.local_account_id), '') AS backendUrl,
  spb.local_id AS local_id,
  p.created_at_ms,
  p.object_uri,
  COALESCE(p.content_html, '') AS content_html,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.canonical_url,
  p.language,
  COALESCE(vt.name, 'public') AS visibility_code,
  p.is_sensitive,
  (p.reblog_of_post_id IS NOT NULL) AS is_reblog,
  p.in_reply_to_id,
  p.edited_at_ms,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.is_locked, 0) AS author_locked,
  COALESCE(pr.is_bot, 0) AS author_bot,
  COALESCE(pr.url, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  rs.id AS rb_post_id,
  COALESCE(rs.content_html, '') AS rb_content_html,
  COALESCE(rs.spoiler_text, '') AS rb_spoiler_text,
  rs.canonical_url AS rb_canonical_url,
  rs.language AS rb_language,
  COALESCE(rvt.name, 'public') AS rb_visibility_code,
  rs.is_sensitive AS rb_is_sensitive,
  rs.in_reply_to_id AS rb_in_reply_to_id,
  rs.edited_at_ms AS rb_edited_at,
  rs.created_at_ms AS rb_created_at_ms,
  rs.object_uri AS rb_object_uri,
  COALESCE(rpr.acct, '') AS rb_author_acct,
  COALESCE(rpr.username, '') AS rb_author_username,
  COALESCE(rpr.display_name, '') AS rb_author_display_name,
  COALESCE(rpr.avatar_url, '') AS rb_author_avatar,
  COALESCE(rpr.header_url, '') AS rb_author_header,
  COALESCE(rpr.is_locked, 0) AS rb_author_locked,
  COALESCE(rpr.is_bot, 0) AS rb_author_bot,
  COALESCE(rpr.url, '') AS rb_author_url,
  COALESCE(rps.replies_count, 0) AS rb_replies_count,
  COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
  COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
  CASE WHEN rs.id IS NOT NULL
    THEN COALESCE(
      (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rs.id AND rpb.server_id = spb.server_id LIMIT 1),
      (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rs.id ORDER BY rpb.server_id LIMIT 1)
    )
    ELSE NULL
  END AS rb_local_id,
  COALESCE(la_auth.remote_account_id, '') AS author_account_id,
  CASE WHEN rs.id IS NOT NULL
    THEN COALESCE(
      (SELECT la3.remote_account_id FROM post_backend_ids rpb3 INNER JOIN local_accounts la3 ON la3.id = rpb3.local_account_id WHERE rpb3.post_id = rs.id AND rpb3.server_id = spb.server_id LIMIT 1),
      '')
    ELSE ''
  END AS rb_author_account_id,
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
 * これにより local_id がパネルのバックエンドに対応する。
 *
 * backendUrls が空の場合はフィルタなし（全バックエンドから MIN を取る従来動作）。
 *
 * NOTE: バックエンド URL はアプリ設定由来であり、ユーザー入力ではないため
 * リテラル埋め込みは安全。bind パラメータ変更を避けるためこの方式を採用。
 */
export function buildSpbFilter(backendUrls: string[]): string {
  if (backendUrls.length === 0) return ''
  const quoted = backendUrls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',')
  return `AND spb_min.server_id IN (SELECT la.server_id FROM local_accounts la WHERE la.backend_url IN (${quoted}))`
}

/**
 * local_account_id でスコープされたエンゲージメント SQL を構築する。
 *
 * post_interactions にはアカウントごとにお気に入り/ブースト/ブックマーク等が
 * boolean フラグで記録されるため、対象アカウントのフラグのみを返すようにフィルタする。
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
      ? BATCH_SQL_TEMPLATES.interactions
      : BATCH_INTERACTIONS_SQL
  }
  const quoted = backendUrls.map((u) => `'${u.replace(/'/g, "''")}'`).join(',')
  return `
  SELECT pi.post_id,
    NULLIF(SUBSTR(
      CASE WHEN pi.is_favourited = 1 THEN ',favourite' ELSE '' END ||
      CASE WHEN pi.is_reblogged = 1 THEN ',reblog' ELSE '' END ||
      CASE WHEN pi.is_bookmarked = 1 THEN ',bookmark' ELSE '' END ||
      CASE WHEN pi.is_muted = 1 THEN ',mute' ELSE '' END ||
      CASE WHEN pi.is_pinned = 1 THEN ',pin' ELSE '' END
    , 2), '') AS engagements_csv
  FROM post_interactions pi
  WHERE pi.post_id IN (${placeholder})
    AND pi.local_account_id IN (
      SELECT la.id FROM local_accounts la
      WHERE la.backend_url IN (${quoted})
    )`
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
    interactions: buildScopedEngagementsSql(backendUrls),
  }
}

/**
 * 正規化テーブルの基本 JOIN 句（profiles, visibility_types, post_backend_ids, local_accounts）
 *
 * spbFilter を渡すと、spb（Selected Posts Backend）のバックエンド選択を
 * 指定されたバックエンド群に限定する。パネルごとに異なるバックエンドで
 * フィルタされたタイムラインが同時に存在する場合、各パネルに正しい
 * local_id / account.id が返るようになる。
 */
export function buildStatusBaseJoins(spbFilter = ''): string {
  return `
  LEFT JOIN profiles pr ON p.author_profile_id = pr.id
  LEFT JOIN visibility_types vt ON p.visibility_id = vt.id
  LEFT JOIN post_backend_ids pb ON p.id = pb.post_id
  LEFT JOIN post_stats ps ON p.id = ps.post_id
  LEFT JOIN posts rs ON p.reblog_of_post_id IS NOT NULL AND rs.id = p.reblog_of_post_id
  LEFT JOIN profiles rpr ON rs.author_profile_id = rpr.id
  LEFT JOIN visibility_types rvt ON rs.visibility_id = rvt.id
  LEFT JOIN post_stats rps ON rs.id = rps.post_id
  LEFT JOIN post_backend_ids spb
    ON spb.post_id = p.id
    AND spb.server_id = (
      SELECT MIN(spb_min.server_id)
      FROM post_backend_ids spb_min
      WHERE spb_min.post_id = p.id
        ${spbFilter}
    )
  LEFT JOIN local_accounts la_auth ON la_auth.id = spb.local_account_id`
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
  WHERE p.id IN ({IDS})
  GROUP BY p.id
  ORDER BY p.created_at_ms DESC;
`
}

/** フィルタなしのデフォルトテンプレート（後方互換） */
export const PHASE2_BASE_TEMPLATE = buildPhase2Template()
