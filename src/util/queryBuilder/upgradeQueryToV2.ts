// ================================================================
// v1 → v2 クエリ自動変換
// ================================================================

/**
 * カスタムクエリ内の v1 形式（json_extract）を v2 形式（正規化カラム）に変換する
 *
 * ベストエフォートで変換し、認識できないパターンはそのまま残す。
 * json_extract が完全に不要になるわけではなく、正規化カラムに存在しない
 * フィールド（$.content, $.url など）への json_extract は変換しない。
 *
 * @param query カスタムクエリ文字列
 * @returns 変換後のクエリ文字列
 */
export function upgradeQueryToV2(query: string): string {
  let result = query

  // v7→v13: p.backendUrl / p.origin_backend_url / pb.backend_url → pb.backendUrl
  result = result.replace(/\bp\.backendUrl\b/g, 'pb.backendUrl')
  result = result.replace(/\bp\.origin_backend_url\b/g, 'pb.backendUrl')
  result = result.replace(/\bpb\.backend_url\b/g, 'pb.backendUrl')

  // DB正規化: pbt.tag → ht.name (posts_belonging_tags → hashtags)
  result = result.replace(/\bpbt\.tag\b/g, 'ht.name')
  result = result.replace(/\bposts_belonging_tags\b/g, 'post_hashtags')

  // notification_types: code → name (v2 スキーマでカラム名変更)
  result = result.replace(/\bntt\.code\b/g, 'ntt.name')
  result = result.replace(
    /\bnotification_types\.code\b/g,
    'notification_types.name',
  )

  // メディア: json_extract(p.json, '$.media_attachments') != '[]'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.media_attachments'\)\s*!=\s*'\[\]'/gi,
    'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // メディア枚数: json_array_length(json_extract(p.json, '$.media_attachments')) >= N
  result = result.replace(
    /json_array_length\(json_extract\(p\.json,\s*'\$\.media_attachments'\)\)\s*>=\s*(\d+)/gi,
    '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  )

  // ブースト: json_extract(p.json, '$.reblog') IS NOT NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.reblog'\)\s+IS\s+NOT\s+NULL/gi,
    'p.is_reblog = 1',
  )

  // ブースト除外: json_extract(p.json, '$.reblog') IS NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.reblog'\)\s+IS\s+NULL/gi,
    'p.is_reblog = 0',
  )

  // CW: json_extract(p.json, '$.spoiler_text') != ''
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.spoiler_text'\)\s*!=\s*''/gi,
    "p.spoiler_text != ''",
  )

  // CW除外: json_extract(p.json, '$.spoiler_text') = ''
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.spoiler_text'\)\s*=\s*''/gi,
    "p.spoiler_text = ''",
  )

  // センシティブ: json_extract(p.json, '$.sensitive') = 1|0
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.sensitive'\)\s*=\s*(\d)/gi,
    'p.is_sensitive = $1',
  )

  // 公開範囲: json_extract(p.json, '$.visibility') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.visibility'\)\s*=\s*'([^']+)'/gi,
    "p.visibility = '$1'",
  )

  // 言語: json_extract(p.json, '$.language') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.language'\)\s*=\s*'([^']+)'/gi,
    "p.language = '$1'",
  )

  // アカウント: json_extract(p.json, '$.account.acct') = 'X'
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.account\.acct'\)\s*=\s*'([^']+)'/gi,
    "p.account_acct = '$1'",
  )

  // リプライ先: json_extract(p.json, '$.in_reply_to_id') IS NOT NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NOT\s+NULL/gi,
    'p.in_reply_to_uri IS NOT NULL',
  )

  // リプライ先: json_extract(p.json, '$.in_reply_to_id') IS NULL
  result = result.replace(
    /json_extract\(p\.json,\s*'\$\.in_reply_to_id'\)\s+IS\s+NULL/gi,
    'p.in_reply_to_uri IS NULL',
  )

  // v1→v2 PK名変更: notification_types.notification_type_id → .id
  result = result.replace(
    /\bnotification_types\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.notification_type_id\b/gi,
    'notification_types $1 ON $1.id',
  )

  // v1→v2 PK名変更: profiles.profile_id → .id
  result = result.replace(
    /\bprofiles\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.profile_id\b/gi,
    'profiles $1 ON $1.id',
  )

  // v1→v2 PK名変更: posts.post_id → .id
  result = result.replace(
    /\bposts\s+(?:AS\s+)?(\w+)\s+ON\s+\1\.post_id\b/gi,
    'posts $1 ON $1.id',
  )

  // ================================================================
  // Phantom column 変換（v2 中間形式 → v2 ネイティブ形式）
  // json_extract 変換後に実行する
  // ================================================================

  // p.has_media = 1 → EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)
  result = result.replace(
    /\bp\.has_media\s*=\s*1\b/g,
    'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // p.has_media = 0 → NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)
  result = result.replace(
    /\bp\.has_media\s*=\s*0\b/g,
    'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  )

  // p.media_count >= N → (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= N
  result = result.replace(
    /\bp\.media_count\s*>=\s*(\d+)/g,
    '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  )

  // p.has_spoiler = 1 → p.spoiler_text != ''
  result = result.replace(/\bp\.has_spoiler\s*=\s*1\b/g, "p.spoiler_text != ''")

  // p.has_spoiler = 0 → p.spoiler_text = ''
  result = result.replace(/\bp\.has_spoiler\s*=\s*0\b/g, "p.spoiler_text = ''")

  // ================================================================
  // Notification compat column 変換
  // NOTIFICATION_BASE_JOINS で nt, la, ap が利用可能
  // ================================================================

  // n.notification_type IS NOT NULL → nt.name IS NOT NULL
  result = result.replace(
    /\bn\.notification_type\s+IS\s+NOT\s+NULL\b/gi,
    'nt.name IS NOT NULL',
  )

  // n.notification_type IN (...) → nt.name IN (...)
  result = result.replace(/\bn\.notification_type(\s+IN\s*\()/gi, 'nt.name$1')

  // n.notification_type = 'X' → nt.name = 'X'
  result = result.replace(/\bn\.notification_type(\s*=\s*)/g, 'nt.name$1')

  // n.account_acct → ap.acct
  result = result.replace(/\bn\.account_acct\b/g, 'ap.acct')

  // n.backend_url → la.backend_url
  // ※ pb.backend_url → pb.backendUrl の変換より後に実行する
  result = result.replace(/\bn\.backend_url\b/g, 'la.backend_url')

  return result
}
