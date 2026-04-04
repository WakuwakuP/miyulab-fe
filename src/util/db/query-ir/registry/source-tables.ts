import type { TableRegistry } from './types'

export const SOURCE_TABLES: TableRegistry = {
  notifications: {
    cardinality: '1:1',
    columns: {
      actor_profile_id: {
        label: 'アクター プロフィール ID',
        nullable: true,
        type: 'integer',
      },
      created_at_ms: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      id: {
        label: '通知 ID',
        nullable: false,
        type: 'integer',
      },
      is_read: {
        label: '既読',
        nullable: false,
        type: 'integer',
      },
      local_account_id: {
        label: 'ローカルアカウント ID',
        nullable: false,
        type: 'integer',
      },
      local_id: {
        label: 'ローカル ID',
        nullable: false,
        type: 'text',
      },
      notification_type_id: {
        label: '通知種別 ID',
        nullable: false,
        type: 'integer',
      },
      reaction_name: {
        label: 'リアクション名',
        nullable: true,
        type: 'text',
      },
      reaction_url: {
        label: 'リアクション URL',
        nullable: true,
        type: 'text',
      },
      related_post_id: {
        label: '関連投稿 ID',
        nullable: true,
        type: 'integer',
      },
    },
    joinPaths: {},
    label: '通知',
    table: 'notifications',
  },

  posts: {
    cardinality: '1:1',
    columns: {
      application_name: {
        label: 'アプリ名',
        nullable: true,
        type: 'text',
      },
      author_profile_id: {
        label: '著者プロフィール ID',
        nullable: false,
        type: 'integer',
      },
      canonical_url: {
        label: '正規 URL',
        nullable: true,
        type: 'text',
      },
      content_html: {
        label: 'HTML 本文',
        nullable: false,
        type: 'text',
      },
      created_at_ms: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      edited_at_ms: {
        label: '編集日時',
        nullable: true,
        type: 'integer',
      },
      id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
      },
      in_reply_to_account_acct: {
        label: 'リプライ先アカウント',
        nullable: true,
        type: 'text',
      },
      in_reply_to_uri: {
        label: 'リプライ先 URI',
        nullable: true,
        type: 'text',
      },
      is_local_only: {
        label: 'ローカル限定',
        nullable: false,
        type: 'integer',
      },
      is_reblog: {
        label: 'リブログ',
        nullable: false,
        type: 'integer',
      },
      is_sensitive: {
        label: 'センシティブ',
        nullable: false,
        type: 'integer',
      },
      language: {
        label: '言語',
        nullable: true,
        type: 'text',
      },
      last_fetched_at: {
        label: '最終取得日時',
        nullable: true,
        type: 'integer',
      },
      object_uri: {
        label: 'オブジェクト URI',
        nullable: false,
        type: 'text',
      },
      origin_server_id: {
        label: '配信元サーバー ID',
        nullable: false,
        type: 'integer',
      },
      plain_content: {
        label: 'テキスト本文',
        nullable: true,
        type: 'text',
      },
      quote_of_post_id: {
        label: '引用元投稿 ID',
        nullable: true,
        type: 'integer',
      },
      quote_state: {
        label: '引用状態',
        nullable: true,
        type: 'text',
      },
      reblog_of_post_id: {
        label: 'リブログ元投稿 ID',
        nullable: true,
        type: 'integer',
      },
      spoiler_text: {
        label: 'CW テキスト',
        nullable: false,
        type: 'text',
      },
      visibility_id: {
        label: '公開範囲 ID',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {},
    label: '投稿',
    table: 'posts',
  },
}
