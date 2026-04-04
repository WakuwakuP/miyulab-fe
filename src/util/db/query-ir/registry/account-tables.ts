import type { TableRegistry } from './types'

export const ACCOUNT_TABLES: TableRegistry = {
  blocked_instances: {
    cardinality: '1:1',
    columns: {
      blocked_at: {
        label: 'ブロック日時',
        nullable: false,
        type: 'integer',
      },
      instance_domain: {
        label: 'インスタンスドメイン',
        nullable: false,
        type: 'text',
      },
    },
    joinPaths: {},
    label: 'ブロックインスタンス',
    table: 'blocked_instances',
  },

  local_accounts: {
    cardinality: '1:1',
    columns: {
      acct: {
        label: 'アカウント ID',
        nullable: false,
        type: 'text',
      },
      backend_type: {
        label: 'バックエンド種別',
        nullable: false,
        type: 'text',
      },
      backend_url: {
        label: 'バックエンド URL',
        nullable: false,
        type: 'text',
      },
      created_at: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      display_order: {
        label: '表示順',
        nullable: false,
        type: 'integer',
      },
      is_active: {
        label: 'アクティブ',
        nullable: false,
        type: 'integer',
      },
      profile_id: {
        label: 'プロフィール ID',
        nullable: true,
        type: 'integer',
      },
      remote_account_id: {
        label: 'リモートアカウント ID',
        nullable: false,
        type: 'text',
      },
      server_id: {
        label: 'サーバー ID',
        nullable: false,
        type: 'integer',
      },
      updated_at: {
        label: '更新日時',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {
      notifications: {
        column: 'id',
        sourceColumn: 'local_account_id',
      },
      posts: {
        column: 'id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'post_interactions',
            toColumn: 'local_account_id',
          },
        ],
      },
    },
    label: 'ローカルアカウント',
    table: 'local_accounts',
  },

  muted_accounts: {
    cardinality: '1:1',
    columns: {
      account_acct: {
        label: 'アカウント ID',
        nullable: false,
        type: 'text',
      },
      muted_at: {
        label: 'ミュート日時',
        nullable: false,
        type: 'integer',
      },
      server_id: {
        label: 'サーバー ID',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {},
    label: 'ミュートアカウント',
    table: 'muted_accounts',
  },

  profile_stats: {
    cardinality: '1:1',
    columns: {
      followers_count: {
        label: 'フォロワー数',
        nullable: false,
        type: 'integer',
      },
      following_count: {
        label: 'フォロー数',
        nullable: false,
        type: 'integer',
      },
      profile_id: {
        label: 'プロフィール ID',
        nullable: false,
        type: 'integer',
      },
      statuses_count: {
        label: '投稿数',
        nullable: false,
        type: 'integer',
      },
      updated_at: {
        label: '更新日時',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {
      posts: {
        column: 'profile_id',
        sourceColumn: 'author_profile_id',
      },
    },
    label: 'プロフィール統計',
    table: 'profile_stats',
  },

  profiles: {
    cardinality: '1:1',
    columns: {
      acct: {
        label: 'アカウント ID',
        nullable: false,
        type: 'text',
      },
      actor_uri: {
        label: 'アクター URI',
        nullable: true,
        type: 'text',
      },
      avatar_static_url: {
        label: 'アバター静止画 URL',
        nullable: false,
        type: 'text',
      },
      avatar_url: {
        label: 'アバター URL',
        nullable: false,
        type: 'text',
      },
      bio: {
        label: '自己紹介',
        nullable: false,
        type: 'text',
      },
      created_at: {
        label: '作成日時',
        nullable: false,
        type: 'text',
      },
      display_name: {
        label: '表示名',
        nullable: false,
        type: 'text',
      },
      header_static_url: {
        label: 'ヘッダー静止画 URL',
        nullable: false,
        type: 'text',
      },
      header_url: {
        label: 'ヘッダー URL',
        nullable: false,
        type: 'text',
      },
      is_bot: {
        label: 'Bot',
        nullable: true,
        type: 'integer',
      },
      is_detail_fetched: {
        label: '詳細取得済み',
        nullable: false,
        type: 'integer',
      },
      is_locked: {
        label: '鍵アカウント',
        nullable: false,
        type: 'integer',
      },
      last_fetched_at: {
        label: '最終取得日時',
        nullable: true,
        type: 'integer',
      },
      moved_to_profile_id: {
        label: '移転先プロフィール ID',
        nullable: true,
        type: 'integer',
      },
      server_id: {
        label: 'サーバー ID',
        nullable: false,
        type: 'integer',
      },
      url: {
        label: 'URL',
        nullable: false,
        type: 'text',
      },
      username: {
        label: 'ユーザー名',
        nullable: false,
        type: 'text',
      },
    },
    joinPaths: {
      notifications: {
        column: 'id',
        sourceColumn: 'actor_profile_id',
      },
      posts: {
        column: 'id',
        sourceColumn: 'author_profile_id',
      },
    },
    label: 'プロフィール',
    table: 'profiles',
  },
}
