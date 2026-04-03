// ============================================================
// Flat Fetch — SQL 定数
//
// リブログ JOIN なしの軽量 Post SELECT と、
// 相関サブクエリなしの軽量 Notification SELECT を定義する。
// ============================================================

import { buildSpbFilter } from '../../sqlite/queries/statusSelect'

// ================================================================
// Post コア SELECT（30 カラム、リブログ JOIN なし）
// ================================================================

/**
 * フラットフェッチ用の Post SELECT カラムリスト
 *
 * STATUS_BASE_SELECT (52カラム) からリブログ親の JOIN とカラムを除去し、
 * author_profile_id を追加した軽量版。
 *
 * カラムレイアウト:
 *   [0]  post_id          [1]  object_uri        [2]  canonical_url
 *   [3]  content_html     [4]  created_at_ms     [5]  edited_at_ms
 *   [6]  language         [7]  is_sensitive       [8]  spoiler_text
 *   [9]  in_reply_to_id   [10] reblog_of_post_id [11] is_reblog
 *   [12] is_local_only    [13] visibility_code
 *   [14] author_profile_id
 *   [15] author_acct      [16] author_username   [17] author_display_name
 *   [18] author_avatar    [19] author_header     [20] author_locked
 *   [21] author_bot       [22] author_url
 *   [23] replies_count    [24] reblogs_count     [25] favourites_count
 *   [26] emoji_reactions_json
 *   [27] backendUrl       [28] local_id          [29] author_account_id
 */
export const POST_FLAT_SELECT = `
  p.id AS post_id,
  p.object_uri,
  p.canonical_url,
  COALESCE(p.content_html, '') AS content_html,
  p.created_at_ms,
  p.edited_at_ms,
  p.language,
  p.is_sensitive,
  COALESCE(p.spoiler_text, '') AS spoiler_text,
  p.in_reply_to_uri AS in_reply_to_id,
  p.reblog_of_post_id,
  (p.reblog_of_post_id IS NOT NULL) AS is_reblog,
  p.is_local_only,
  COALESCE(vt.name, 'public') AS visibility_code,
  pr.id AS author_profile_id,
  COALESCE(pr.acct, '') AS author_acct,
  COALESCE(pr.username, '') AS author_username,
  COALESCE(pr.display_name, '') AS author_display_name,
  COALESCE(pr.avatar_url, '') AS author_avatar,
  COALESCE(pr.header_url, '') AS author_header,
  COALESCE(pr.is_locked, 0) AS author_locked,
  COALESCE(pr.is_bot, 0) AS author_bot,
  COALESCE(pr.actor_uri, '') AS author_url,
  COALESCE(ps.replies_count, 0) AS replies_count,
  COALESCE(ps.reblogs_count, 0) AS reblogs_count,
  COALESCE(ps.favourites_count, 0) AS favourites_count,
  ps.emoji_reactions_json,
  COALESCE(la_auth.backend_url, '') AS backendUrl,
  COALESCE(spb.local_id, '') AS local_id,
  COALESCE(la_auth.remote_account_id, '') AS author_account_id`

// ================================================================
// Post コア JOIN（5 JOIN、リブログなし）
// ================================================================

/**
 * フラットフェッチ用の Post JOIN 句を構築する。
 *
 * STATUS_BASE_JOINS (10+ JOIN) からリブログ関連の JOIN を除去した軽量版。
 * spbFilter でバックエンドスコープを適用可能。
 */
export function buildPostFlatJoins(spbFilter = ''): string {
  return `
  LEFT JOIN profiles pr ON p.author_profile_id = pr.id
  LEFT JOIN visibility_types vt ON p.visibility_id = vt.id
  LEFT JOIN post_stats ps ON p.id = ps.post_id
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

/**
 * フラットフェッチ用の Post クエリを構築する。
 *
 * @param backendUrls — バックエンドURL一覧（scoped query 用）
 * @param postIds — 取得対象の投稿ID一覧
 */
export function buildPostFlatQuery(
  backendUrls: string[],
  postIds: number[],
): { sql: string; bind: number[] } {
  const spbFilter = buildSpbFilter(backendUrls)
  const joins = buildPostFlatJoins(spbFilter)
  const placeholders = postIds.map(() => '?').join(',')
  const sql = `
    SELECT ${POST_FLAT_SELECT}
    FROM posts p
    ${joins}
    WHERE p.id IN (${placeholders})`
  return { bind: postIds, sql }
}

// ================================================================
// Notification コア SELECT（19 カラム、サブクエリなし）
// ================================================================

/**
 * フラットフェッチ用の Notification SELECT カラムリスト
 *
 * NOTIFICATION_SELECT (42カラム) から関連投稿の相関サブクエリを除去し、
 * related_post_id と actor_profile_id を保持した軽量版。
 * 関連投稿データは投稿バッチクエリで別途取得してクライアント JOIN する。
 *
 * カラムレイアウト:
 *   [0]  id               [1]  local_account_id  [2]  local_id
 *   [3]  created_at_ms    [4]  is_read           [5]  related_post_id
 *   [6]  reaction_name    [7]  reaction_url      [8]  actor_profile_id
 *   [9]  notification_type [10] backendUrl
 *   [11] actor_acct       [12] actor_username    [13] actor_display_name
 *   [14] actor_avatar     [15] actor_header      [16] actor_locked
 *   [17] actor_bot        [18] actor_url
 */
export const NOTIFICATION_FLAT_SELECT = `
  n.id,
  n.local_account_id,
  n.local_id,
  n.created_at_ms,
  n.is_read,
  n.related_post_id,
  n.reaction_name,
  n.reaction_url,
  n.actor_profile_id,
  COALESCE(nt.name, '') AS notification_type,
  COALESCE(la.backend_url, '') AS backendUrl,
  COALESCE(ap.acct, '') AS actor_acct,
  COALESCE(ap.username, '') AS actor_username,
  COALESCE(ap.display_name, '') AS actor_display_name,
  COALESCE(ap.avatar_url, '') AS actor_avatar,
  COALESCE(ap.header_url, '') AS actor_header,
  COALESCE(ap.is_locked, 0) AS actor_locked,
  COALESCE(ap.is_bot, 0) AS actor_bot,
  COALESCE(ap.actor_uri, '') AS actor_url`

// ================================================================
// Notification コア JOIN（3 JOIN、関連投稿なし）
// ================================================================

/**
 * フラットフェッチ用の Notification JOIN 句
 *
 * NOTIFICATION_BASE_JOINS (6 JOIN) から関連投稿の JOIN を除去した軽量版。
 */
export const NOTIFICATION_FLAT_JOINS = `
  LEFT JOIN notification_types nt ON n.notification_type_id = nt.id
  LEFT JOIN profiles ap ON n.actor_profile_id = ap.id
  LEFT JOIN local_accounts la ON n.local_account_id = la.id`

/**
 * フラットフェッチ用の Notification クエリを構築する。
 *
 * @param notificationIds — 取得対象の通知ID一覧
 */
export function buildNotificationFlatQuery(notificationIds: number[]): {
  sql: string
  bind: number[]
} {
  const placeholders = notificationIds.map(() => '?').join(',')
  const sql = `
    SELECT ${NOTIFICATION_FLAT_SELECT}
    FROM notifications n
    ${NOTIFICATION_FLAT_JOINS}
    WHERE n.id IN (${placeholders})`
  return { bind: notificationIds, sql }
}

// ================================================================
// プロフィール絵文字バッチ SQL（profile_id 直接指定版）
// ================================================================

/**
 * profile_id → カスタム絵文字 JSON のバッチクエリ
 *
 * 既存の BATCH_PROFILE_CUSTOM_EMOJIS_SQL は post_id 経由で取得するが、
 * 通知のアクタープロフィール絵文字には profile_id を直接指定する必要がある。
 */
export const BATCH_PROFILE_EMOJIS_BY_ID_SQL = `
  SELECT prce.profile_id,
    json_group_array(
      json_object(
        'shortcode', ce.shortcode,
        'url', ce.url,
        'static_url', ce.static_url,
        'visible_in_picker', ce.visible_in_picker
      )
    ) AS emojis_json
  FROM profile_custom_emojis prce
  INNER JOIN custom_emojis ce ON prce.custom_emoji_id = ce.id
  WHERE prce.profile_id IN ({IDS})
  GROUP BY prce.profile_id`
