// ================================================================
// 互換サブクエリ: 旧カラム名をカスタム WHERE 句で使えるようにする
// ================================================================

export const STATUS_COMPAT_FROM = `(
      SELECT p.*,
        COALESCE((SELECT la_compat.backend_url FROM local_accounts la_compat WHERE la_compat.server_id = p.origin_server_id LIMIT 1), '') AS origin_backend_url,
        COALESCE(pr_c.acct, '') AS account_acct,
        '' AS account_id,
        COALESCE(vt_c.name, 'public') AS visibility,
        NULL AS reblog_of_id,
        COALESCE(ps_c.favourites_count, 0) AS favourites_count,
        COALESCE(ps_c.reblogs_count, 0) AS reblogs_count,
        COALESCE(ps_c.replies_count, 0) AS replies_count
      FROM posts p
      LEFT JOIN profiles pr_c ON pr_c.id = p.author_profile_id
      LEFT JOIN visibility_types vt_c ON vt_c.id = p.visibility_id
      LEFT JOIN post_stats ps_c ON ps_c.post_id = p.id
    ) p`

export const NOTIF_COMPAT_FROM = `(
      SELECT n2.*,
        COALESCE(la_nc.backend_url, '') AS backend_url,
        COALESCE(nt_nc.name, '') AS notification_type,
        COALESCE(pr_nc.acct, '') AS account_acct
      FROM notifications n2
      LEFT JOIN local_accounts la_nc ON la_nc.id = n2.local_account_id
      LEFT JOIN notification_types nt_nc ON nt_nc.id = n2.notification_type_id
      LEFT JOIN profiles pr_nc ON pr_nc.id = n2.actor_profile_id
    ) n`

// ================================================================
// 混合クエリ用の空サブクエリ定数（useCustomQueryTimeline と同一）
// ================================================================

export const EMPTY_N = `(SELECT
      NULL AS id, NULL AS local_account_id, NULL AS local_id,
      NULL AS notification_type_id, NULL AS actor_profile_id,
      NULL AS related_post_id, NULL AS created_at_ms,
      NULL AS is_read, NULL AS reaction_name, NULL AS reaction_url,
      NULL AS backend_url, NULL AS notification_type, NULL AS account_acct
    LIMIT 0)`

export const EMPTY_S = `(SELECT
      NULL AS post_id, NULL AS object_uri, NULL AS origin_server_id,
      NULL AS author_profile_id, NULL AS created_at_ms, NULL AS stored_at,
      NULL AS visibility_id, NULL AS language, NULL AS content_html,
      NULL AS spoiler_text, NULL AS canonical_url, NULL AS has_media,
      NULL AS media_count, NULL AS is_reblog, NULL AS reblog_of_uri,
      NULL AS is_sensitive, NULL AS has_spoiler, NULL AS in_reply_to_id,
      NULL AS is_local_only, NULL AS edited_at,
      NULL AS origin_backend_url, NULL AS account_acct, NULL AS account_id,
      NULL AS visibility, NULL AS reblog_of_id,
      NULL AS favourites_count, NULL AS reblogs_count, NULL AS replies_count
    LIMIT 0)`

export const EMPTY_PTT =
  '(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)'
export const EMPTY_PHT = '(SELECT NULL AS post_id, NULL AS hashtag_id LIMIT 0)'
export const EMPTY_HT =
  '(SELECT NULL AS hashtag_id, NULL AS normalized_name LIMIT 0)'
export const EMPTY_PME = '(SELECT NULL AS post_id, NULL AS acct LIMIT 0)'
export const EMPTY_PB =
  '(SELECT NULL AS post_id, NULL AS backendUrl, NULL AS local_id LIMIT 0)'
export const EMPTY_PRB =
  '(SELECT NULL AS post_id, NULL AS original_uri, NULL AS reblogger_acct, NULL AS reblogged_at_ms LIMIT 0)'
