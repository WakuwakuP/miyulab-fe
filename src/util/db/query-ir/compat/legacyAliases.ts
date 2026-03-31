// ============================================================
// legacyAliases — v1/v2 カラム名互換レイヤー
// ============================================================
//
// v1 (json_extract ベース) の旧カラム名を v2 (正規化カラム) に変換する。
// upgradeQueryToV2() の IR ノード版。

/** v1 カラム参照 → v2 カラム参照の書き換えルール */
type AliasRewrite = {
  pattern: RegExp
  replacement: string
}

/**
 * v1 の旧カラム名を v2 に書き換える。
 * WHERE 句テキストをパースする前に適用する。
 */
const ALIAS_REWRITES: AliasRewrite[] = [
  // json_extract ベースのメディア条件 → サブクエリ
  {
    pattern:
      /json_extract\s*\(\s*p\.json\s*,\s*'\$\.media_attachments'\s*\)\s*!=\s*'\[\]'/gi,
    replacement: 'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  },
  {
    pattern:
      /json_array_length\s*\(\s*json_extract\s*\(\s*p\.json\s*,\s*'\$\.media_attachments'\s*\)\s*\)\s*>=\s*(\d+)/gi,
    replacement: '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  },
  // json_extract ベースの reblog 条件
  {
    pattern:
      /json_extract\s*\(\s*p\.json\s*,\s*'\$\.reblog'\s*\)\s+IS\s+NOT\s+NULL/gi,
    replacement: 'p.is_reblog = 1',
  },
  {
    pattern:
      /json_extract\s*\(\s*p\.json\s*,\s*'\$\.reblog'\s*\)\s+IS\s+NULL/gi,
    replacement: 'p.is_reblog = 0',
  },
  // json_extract ベースの spoiler_text
  {
    pattern:
      /json_extract\s*\(\s*p\.json\s*,\s*'\$\.spoiler_text'\s*\)\s*!=\s*''/gi,
    replacement: "p.spoiler_text != ''",
  },
  {
    pattern:
      /json_extract\s*\(\s*p\.json\s*,\s*'\$\.spoiler_text'\s*\)\s*=\s*''/gi,
    replacement: "p.spoiler_text = ''",
  },
  // json_extract ベースの sensitive
  {
    pattern: /json_extract\s*\(\s*p\.json\s*,\s*'\$\.sensitive'\s*\)\s*=\s*1/gi,
    replacement: 'p.is_sensitive = 1',
  },
  {
    pattern: /json_extract\s*\(\s*p\.json\s*,\s*'\$\.sensitive'\s*\)\s*=\s*0/gi,
    replacement: 'p.is_sensitive = 0',
  },
  // ファントムカラム → サブクエリ/正規化カラム
  {
    pattern: /\bp\.has_media\s*=\s*1\b/gi,
    replacement: 'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  },
  {
    pattern: /\bp\.has_media\s*=\s*0\b/gi,
    replacement: 'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
  },
  {
    pattern: /\bp\.media_count\s*>=\s*(\d+)/gi,
    replacement: '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= $1',
  },
  {
    pattern: /\bp\.has_spoiler\s*=\s*1\b/gi,
    replacement: "p.spoiler_text != ''",
  },
  {
    pattern: /\bp\.has_spoiler\s*=\s*0\b/gi,
    replacement: "p.spoiler_text = ''",
  },
  // v1 カラム名 → v2
  { pattern: /\bp\.account_acct\b/g, replacement: 'pr.acct' },
  { pattern: /\bp\.visibility\b/g, replacement: 'vt.name' },
  { pattern: /\bp\.favourites_count\b/g, replacement: 'ps.favourites_count' },
  { pattern: /\bp\.reblogs_count\b/g, replacement: 'ps.reblogs_count' },
  { pattern: /\bp\.replies_count\b/g, replacement: 'ps.replies_count' },
  { pattern: /\bpbt\.tag\b/g, replacement: 'ht.name' },
  { pattern: /\bp\.in_reply_to_id\b/g, replacement: 'p.in_reply_to_uri' },
  // 旧 PK 名
  {
    pattern: /\bnotification_types\.notification_type_id\b/g,
    replacement: 'notification_types.id',
  },
  { pattern: /\bprofiles\.profile_id\b/g, replacement: 'profiles.id' },
  { pattern: /\bposts\.post_id\b/g, replacement: 'posts.id' },
  // 旧 notification_types.code
  { pattern: /\bntt\.code\b/g, replacement: 'nt.name' },
  { pattern: /\bn\.notification_type\b/g, replacement: 'nt.name' },
  { pattern: /\bn\.account_acct\b/g, replacement: 'ap.acct' },
]

/**
 * WHERE 句テキストに含まれる v1 旧カラム名を v2 に書き換える。
 * パーサに渡す前にこの関数を通すこと。
 */
export function rewriteLegacyAliases(where: string): string {
  let result = where
  for (const rule of ALIAS_REWRITES) {
    result = result.replace(rule.pattern, rule.replacement)
  }
  return result
}
