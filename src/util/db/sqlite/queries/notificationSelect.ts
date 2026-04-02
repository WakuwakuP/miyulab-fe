// ============================================================
// Notification SQL テンプレート定数
//
// notificationStore.ts から切り出した純粋な SQL 文字列定数。
// Worker バンドル内（outputExecutor.ts 等）からも安全にインポートできるよう、
// connection.ts / initSqlite.ts への依存を一切持たない。
// ============================================================

/**
 * Notification SELECT カラムリスト
 *
 * notifications n を基点に LEFT JOIN した結果から
 * rowToStoredNotification が要求する 42 カラムを生成する。
 *
 * カラムレイアウト:
 *   [0]  id                 [1]  backendUrl          [2]  created_at_ms
 *   [3]  notification_type  [4]  local_id            [5]  is_read
 *   [6]  actor_acct         [7]  actor_username      [8]  actor_display_name
 *   [9]  actor_avatar       [10] actor_header        [11] actor_locked
 *   [12] actor_bot          [13] actor_url
 *   [14] rp_post_id         [15] rp_content          [16] rp_spoiler_text
 *   [17] rp_url             [18] rp_uri              [19] rp_created_at_ms
 *   [20] rp_sensitive       [21] rp_visibility       [22] rp_language
 *   [23] rp_author_acct     [24] rp_author_username  [25] rp_author_display_name
 *   [26] rp_author_avatar   [27] rp_author_url       [28] rp_local_id
 *   [29] rp_in_reply_to_id  [30] rp_edited_at_ms
 *   [31] rp_status_emojis_json  [32] rp_account_emojis_json
 *   [33] rp_poll_json       [34] actor_emojis_json
 *   [35] rp_emoji_reactions_json
 *   [36] rp_media_json      [37] rp_mentions_json
 *   [38] rp_voted           [39] rp_own_votes_json
 *   [40] reaction_name      [41] reaction_url
 */
export const NOTIFICATION_SELECT = `
  n.id,
  COALESCE(la.backend_url, '') AS backendUrl,
  n.created_at_ms,
  COALESCE(nt.name, '') AS notification_type,
  n.local_id,
  n.is_read,
  COALESCE(ap.acct, '') AS actor_acct,
  COALESCE(ap.username, '') AS actor_username,
  COALESCE(ap.display_name, '') AS actor_display_name,
  COALESCE(ap.avatar_url, '') AS actor_avatar,
  COALESCE(ap.header_url, '') AS actor_header,
  COALESCE(ap.is_locked, 0) AS actor_locked,
  COALESCE(ap.is_bot, 0) AS actor_bot,
  COALESCE(ap.actor_uri, '') AS actor_url,
  rp.id AS rp_post_id,
  COALESCE(rp.content_html, '') AS rp_content,
  COALESCE(rp.spoiler_text, '') AS rp_spoiler_text,
  rp.canonical_url AS rp_url,
  rp.object_uri AS rp_uri,
  rp.created_at_ms AS rp_created_at_ms,
  COALESCE(rp.is_sensitive, 0) AS rp_sensitive,
  COALESCE((SELECT vt2.name FROM visibility_types vt2 WHERE vt2.id = rp.visibility_id), 'public') AS rp_visibility,
  rp.language AS rp_language,
  COALESCE(rppr.acct, '') AS rp_author_acct,
  COALESCE(rppr.username, '') AS rp_author_username,
  COALESCE(rppr.display_name, '') AS rp_author_display_name,
  COALESCE(rppr.avatar_url, '') AS rp_author_avatar,
  COALESCE(rppr.actor_uri, '') AS rp_author_url,
  COALESCE(
    (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rp.id AND rpb.local_account_id = n.local_account_id LIMIT 1),
    (SELECT rpb.local_id FROM post_backend_ids rpb WHERE rpb.post_id = rp.id ORDER BY rpb.local_account_id LIMIT 1)
  ) AS rp_local_id,
  rp.in_reply_to_uri AS rp_in_reply_to_id,
  rp.edited_at_ms AS rp_edited_at_ms,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM post_custom_emojis pce INNER JOIN custom_emojis ce ON pce.custom_emoji_id = ce.id WHERE pce.post_id = rp.id) AS rp_status_emojis_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM profile_custom_emojis rpace INNER JOIN custom_emojis ce ON rpace.custom_emoji_id = ce.id WHERE rpace.profile_id = rppr.id) AS rp_account_emojis_json,
  (SELECT json_object('id', pl.id, 'expires_at', pl.expires_at, 'multiple', pl.multiple, 'votes_count', pl.votes_count, 'options', (SELECT json_group_array(json_object('title', po.title, 'votes_count', po.votes_count)) FROM poll_options po WHERE po.poll_id = pl.id ORDER BY po.sort_order)) FROM polls pl WHERE pl.post_id = rp.id) AS rp_poll_json,
  (SELECT json_group_array(json_object('shortcode', ce.shortcode, 'url', ce.url, 'static_url', ce.static_url, 'visible_in_picker', ce.visible_in_picker)) FROM profile_custom_emojis pce2 INNER JOIN custom_emojis ce ON pce2.custom_emoji_id = ce.id WHERE pce2.profile_id = ap.id) AS actor_emojis_json,
  rpps.emoji_reactions_json AS rp_emoji_reactions_json,
  CASE WHEN EXISTS(SELECT 1 FROM post_media WHERE post_id = rp.id) THEN (SELECT json_group_array(json_object('id', pm.media_local_id, 'type', COALESCE((SELECT mt.name FROM media_types mt WHERE mt.id = pm.media_type_id), 'unknown'), 'url', pm.url, 'preview_url', pm.preview_url, 'description', pm.description, 'blurhash', pm.blurhash, 'remote_url', pm.remote_url)) FROM post_media pm WHERE pm.post_id = rp.id ORDER BY pm.sort_order) ELSE NULL END AS rp_media_json,
  (SELECT json_group_array(json_object('acct', pme.acct)) FROM post_mentions pme WHERE pme.post_id = rp.id) AS rp_mentions_json,
  (SELECT pv.voted FROM poll_votes pv INNER JOIN polls pl2 ON pv.poll_id = pl2.id WHERE pl2.post_id = rp.id AND pv.local_account_id = n.local_account_id LIMIT 1) AS rp_voted,
  (SELECT pv.own_votes_json FROM poll_votes pv INNER JOIN polls pl2 ON pv.poll_id = pl2.id WHERE pl2.post_id = rp.id AND pv.local_account_id = n.local_account_id LIMIT 1) AS rp_own_votes_json,
  n.reaction_name,
  n.reaction_url`

/**
 * Notification ベース JOIN 句
 *
 * notifications n から関連テーブルを LEFT JOIN する。
 */
export const NOTIFICATION_BASE_JOINS = `
  LEFT JOIN local_accounts la ON n.local_account_id = la.id
  LEFT JOIN notification_types nt ON n.notification_type_id = nt.id
  LEFT JOIN profiles ap ON n.actor_profile_id = ap.id
  LEFT JOIN posts rp ON n.related_post_id = rp.id
  LEFT JOIN profiles rppr ON rp.author_profile_id = rppr.id
  LEFT JOIN post_stats rpps ON rp.id = rpps.post_id`
