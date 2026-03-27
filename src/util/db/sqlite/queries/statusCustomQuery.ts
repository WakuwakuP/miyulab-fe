/**
 * カスタムクエリ関連の定数・ユーティリティ
 *
 * ユーザー入力の WHERE 句のサニタイズ、バリデーション、
 * 補完用のカラム・エイリアス情報を集約する。
 */

/**
 * ユーザー入力の WHERE 句をサニタイズする
 *
 * - LIMIT / OFFSET を除去（自動設定のため）
 * - データ変更系ステートメントを拒否（DROP, DELETE, INSERT, UPDATE, ALTER, CREATE）
 * - セミコロン（複文実行）を除去
 *
 * ※ この DB はクライアントサイド専用（ユーザー自身のデータのみ）のため、
 *   悪意のある第三者による攻撃リスクは低い。しかし誤操作によるデータ破損を
 *   防止するため、DML/DDL ステートメントは拒否する。
 */
export function sanitizeWhereClause(input: string): string {
  // データ変更・構造変更ステートメントを検出して拒否
  const forbidden =
    /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
  if (forbidden.test(input)) {
    throw new Error(
      'Custom query contains forbidden SQL statements. Only SELECT-compatible WHERE clauses are allowed.',
    )
  }

  // SQLコメントを拒否（後続条件のコメントアウト防止）
  if (/--/.test(input) || /\/\*/.test(input)) {
    throw new Error(
      'Custom query contains SQL comments (-- or /* */). Comments are not allowed.',
    )
  }

  return (
    input
      // セミコロンを除去（複文実行防止）
      .replace(/;/g, '')
      // LIMIT/OFFSET を除去（自動設定のため）
      .replace(/\bLIMIT\b\s+\d+/gi, '')
      .replace(/\bOFFSET\b\s+\d+/gi, '')
      .trim()
  )
}

/**
 * テーブルカラム / エイリアス一覧（補完用）
 */
export const QUERY_COMPLETIONS = {
  aliases: ['p', 'ptt', 'pbt', 'pme', 'pb', 'pe', 'n'],
  columns: {
    n: [
      'id',
      'local_id',
      'notification_type_id',
      'actor_profile_id',
      'related_post_id',
      'created_at_ms',
      'is_read',
      // 後方互換（互換サブクエリ経由）
      'backend_url',
      'notification_type',
      'account_acct',
    ],
    p: [
      'id',
      'object_uri',
      'origin_server_id',
      'author_profile_id',
      'created_at_ms',
      'edited_at_ms',
      'visibility_id',
      'language',
      'content_html',
      'plain_content',
      'spoiler_text',
      'canonical_url',
      'is_reblog',
      'is_sensitive',
      'in_reply_to_uri',
      'in_reply_to_account_acct',
      'is_local_only',
      'quote_of_post_id',
      'quote_state',
      'application_name',
      'last_fetched_at',
      // 後方互換（互換サブクエリ経由）
      'origin_backend_url',
      'account_acct',
      'visibility',
      'favourites_count',
      'reblogs_count',
      'replies_count',
    ],
    pb: ['post_id', 'backend_url', 'local_id', 'server_id'],
    pbt: ['post_id', 'tag', 'name', 'display_name'],
    pe: [
      'post_id',
      'is_favourited',
      'is_reblogged',
      'is_bookmarked',
      'is_muted',
      'is_pinned',
    ],
    pme: ['post_id', 'acct'],
    ptt: ['post_id', 'timelineType'],
  },
  examples: [
    {
      description: '特定ユーザーの投稿を取得する',
      query: "p.account_acct = 'user@example.com'",
    },
    {
      description: '添付メディアが存在する投稿を取得する',
      query: 'p.has_media = 1',
    },
    {
      description: 'メディアが2枚以上ある投稿を取得する',
      query: 'p.media_count >= 2',
    },
    {
      description: 'ブーストされた投稿を取得する',
      query: 'p.is_reblog = 1',
    },
    {
      description: 'ブーストを除外する',
      query: 'p.is_reblog = 0',
    },
    {
      description: 'CW（Content Warning）付きの投稿を取得する',
      query: 'p.has_spoiler = 1',
    },
    {
      description: 'リプライを除外する',
      query: 'p.in_reply_to_id IS NULL',
    },
    {
      description: '日本語の投稿のみ取得する',
      query: "p.language = 'ja'",
    },
    {
      description: '公開投稿のみ取得する',
      query: "p.visibility = 'public'",
    },
    {
      description: '未収載を含む公開投稿を取得する',
      query: "p.visibility IN ('public', 'unlisted')",
    },
    {
      description: 'ふぁぼ数が10以上の投稿を取得する',
      query: 'p.favourites_count >= 10',
    },
    {
      description: '特定ユーザーへのメンションを含む投稿を取得する',
      query: "pme.acct = 'user@example.com'",
    },
    {
      description: 'ホームタイムラインを取得する',
      query: "ptt.timelineType = 'home'",
    },
    {
      description: '指定タグの投稿を取得する',
      query: "pbt.tag = 'photo'",
    },
    {
      description: 'ローカルタイムラインで特定タグの投稿を取得する',
      query: "ptt.timelineType = 'local' AND pbt.tag = 'music'",
    },
    {
      description: 'フォロー通知のみ取得する',
      query: "n.notification_type = 'follow'",
    },
    {
      description: 'メンション通知のみ取得する',
      query: "n.notification_type = 'mention'",
    },
    {
      description: 'お気に入りとブースト通知を取得する',
      query: "n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description: '特定ユーザーからの通知を取得する',
      query: "n.account_acct = 'user@example.com'",
    },
    {
      description:
        'ホームタイムラインとお気に入り・ブースト通知を一緒に表示する',
      query:
        "ptt.timelineType = 'home' OR n.notification_type IN ('favourite', 'reblog')",
    },
    {
      description:
        'ふぁぼ・リアクション・ブースト通知と通知元ユーザーの直後の1投稿(3分以内)をまとめて表示する',
      query:
        "n.notification_type IN ('favourite', 'reaction', 'reblog') OR EXISTS (SELECT 1 FROM notifications ntf INNER JOIN notification_types ntt ON ntt.notification_type_id = ntf.notification_type_id INNER JOIN profiles pra ON pra.profile_id = ntf.actor_profile_id WHERE ntt.code IN ('favourite', 'reaction', 'reblog') AND pra.acct = p.account_acct AND p.created_at_ms > ntf.created_at_ms AND p.created_at_ms <= ntf.created_at_ms + 180000 AND p.created_at_ms = (SELECT MIN(p2.created_at_ms) FROM posts p2 INNER JOIN profiles pr2 ON pr2.profile_id = p2.author_profile_id WHERE pr2.acct = pra.acct AND p2.created_at_ms > ntf.created_at_ms AND p2.created_at_ms <= ntf.created_at_ms + 180000))",
    },
  ],
  keywords: [
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'IN',
    'LIKE',
    'BETWEEN',
    'IS',
    'NULL',
    'IS NOT NULL',
    'GLOB',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'DISTINCT',
    // JSON 関数
    'json_extract',
    'json_array_length',
    'json_type',
    'json_valid',
    'json_each',
    'json_group_array',
    'json_group_object',
    // 文字列関数
    'length',
    'lower',
    'upper',
    'trim',
    'substr',
    'replace',
    'instr',
    // 集約・数値関数
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'abs',
    // その他の関数
    'coalesce',
    'ifnull',
    'nullif',
    'typeof',
    'cast',
  ],
} as const

/** 許可リスト（安全なテーブル＋カラムの組み合わせ） */
export const ALLOWED_COLUMN_VALUES: Record<string, string[]> = {
  hashtags: ['name', 'display_name'],
  notification_types: ['name'],
  post_backend_ids: ['backend_url', 'local_id', 'server_id'],
  post_mentions: ['acct'],
  posts: ['object_uri', 'language'],
  profiles: ['acct'],
  servers: ['base_url'],
  visibility_types: ['name'],
}

/** エイリアスからテーブル名・カラム名へのマッピング */
export const ALIAS_TO_TABLE: Record<
  string,
  { table: string; columns: Record<string, string> }
> = {
  n: {
    columns: {},
    table: 'notifications',
  },
  p: {
    columns: {
      language: 'language',
      object_uri: 'object_uri',
    },
    table: 'posts',
  },
  pb: {
    columns: {
      backend_url: 'backend_url',
      local_id: 'local_id',
      server_id: 'server_id',
    },
    table: 'post_backend_ids',
  },
  pbt: {
    columns: {
      tag: 'name',
    },
    table: 'hashtags',
  },
  pe: {
    columns: {
      is_bookmarked: 'is_bookmarked',
      is_favourited: 'is_favourited',
      is_muted: 'is_muted',
      is_pinned: 'is_pinned',
      is_reblogged: 'is_reblogged',
    },
    table: 'post_interactions',
  },
  pme: {
    columns: {
      acct: 'acct',
    },
    table: 'post_mentions',
  },
  ptt: {
    columns: {
      timelineType: 'timeline_key',
    },
    table: 'timeline_entries',
  },
}

/**
 * 互換カラム用のテーブル・カラムオーバーライド
 *
 * v13 で別テーブルに移動したカラムの値補完を実現するために、
 * エイリアス＋カラム名から実際のテーブル・カラムを解決する。
 */
export const COLUMN_TABLE_OVERRIDE: Record<
  string,
  Record<string, { table: string; column: string }>
> = {
  n: {
    account_acct: { column: 'acct', table: 'profiles' },
    backend_url: { column: 'base_url', table: 'servers' },
    notification_type: { column: 'name', table: 'notification_types' },
  },
  p: {
    account_acct: { column: 'acct', table: 'profiles' },
    origin_backend_url: { column: 'backend_url', table: 'post_backend_ids' },
    visibility: { column: 'name', table: 'visibility_types' },
  },
}
