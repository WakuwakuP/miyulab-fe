/** ソーステーブルからの結合方法 */
export type JoinPath = {
  /** 結合先テーブルのカラム */
  column: string
  /** ソーステーブル側の対応カラム */
  sourceColumn: string
  /** 中間テーブルを経由する場合の JOIN チェーン */
  via?: {
    fromColumn: string
    table: string
    toColumn: string
  }[]
}

/** テーブルのカーディナリティ（ソースに対する関係） */
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'lookup'

/** フィルタ可能なカラムのメタデータ */
export type ColumnMeta = {
  /** UI で表示するカテゴリ */
  category?: string
  /** 値の候補（ルックアップテーブルの場合） */
  knownValues?: string[]
  /** UI 表示用のラベル */
  label: string
  /** NULL 許容か */
  nullable: boolean
  /** SQLite の型 */
  type: 'integer' | 'text' | 'real'
}

/** テーブルのレジストリエントリ */
export type TableRegistryEntry = {
  /** ソーステーブルに対するカーディナリティ */
  cardinality: Cardinality
  /** フィルタ可能なカラム */
  columns: Record<string, ColumnMeta>
  /** コンパイラへのヒント */
  hints?: {
    /** 小さいルックアップテーブルか（スカラーサブクエリ向き） */
    isSmallLookup?: boolean
    /** EXISTS サブクエリを優先するか（1:N テーブルのデフォルト） */
    preferExists?: boolean
  }
  /** ソーステーブルごとの結合パス */
  joinPaths: {
    notifications?: JoinPath
    posts?: JoinPath
  }
  /** UI 表示名 */
  label: string
  /** テーブル名 */
  table: string
}

export type TableRegistry = Record<string, TableRegistryEntry>

export const TABLE_REGISTRY: TableRegistry = {
  blocked_instances: {
    cardinality: '1:1',
    columns: {
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

  hashtags: {
    cardinality: '1:N',
    columns: {
      name: {
        label: '名前',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'post_hashtags',
            toColumn: 'hashtag_id',
          },
        ],
      },
    },
    label: 'ハッシュタグ',
    table: 'hashtags',
  },

  link_cards: {
    cardinality: '1:1',
    columns: {
      description: {
        label: '説明',
        nullable: false,
        type: 'text',
      },
      title: {
        label: 'タイトル',
        nullable: false,
        type: 'text',
      },
      url: {
        label: 'URL',
        nullable: false,
        type: 'text',
      },
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'リンクカード',
    table: 'link_cards',
  },

  muted_accounts: {
    cardinality: '1:1',
    columns: {
      account_acct: {
        label: 'アカウント ID',
        nullable: false,
        type: 'text',
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

  notification_types: {
    cardinality: 'lookup',
    columns: {
      name: {
        knownValues: [
          'mention',
          'reblog',
          'favourite',
          'follow',
          'follow_request',
          'poll',
          'status',
          'update',
          'emoji_reaction',
          'pleroma:chat_mention',
          'pleroma:emoji_reaction',
          'move',
        ],
        label: '通知種別名',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      isSmallLookup: true,
    },
    joinPaths: {
      notifications: {
        column: 'id',
        sourceColumn: 'notification_type_id',
      },
    },
    label: '通知種別',
    table: 'notification_types',
  },

  notifications: {
    cardinality: '1:1',
    columns: {
      created_at_ms: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      is_read: {
        label: '既読',
        nullable: false,
        type: 'integer',
      },
      reaction_name: {
        label: 'リアクション名',
        nullable: true,
        type: 'text',
      },
    },
    joinPaths: {},
    label: '通知',
    table: 'notifications',
  },

  polls: {
    cardinality: '1:1',
    columns: {
      expired: {
        label: '期限切れ',
        nullable: false,
        type: 'integer',
      },
      multiple: {
        label: '複数選択',
        nullable: false,
        type: 'integer',
      },
      votes_count: {
        label: '投票数',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: '投票',
    table: 'polls',
  },

  post_backend_ids: {
    cardinality: '1:N',
    columns: {
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
      server_id: {
        label: 'サーバー ID',
        nullable: false,
        type: 'integer',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'バックエンド ID',
    table: 'post_backend_ids',
  },

  post_custom_emojis: {
    cardinality: '1:N',
    columns: {},
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'カスタム絵文字',
    table: 'post_custom_emojis',
  },

  post_emoji_reactions: {
    cardinality: '1:N',
    columns: {
      count: {
        label: 'カウント',
        nullable: false,
        type: 'integer',
      },
      name: {
        label: '名前',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: '絵文字リアクション',
    table: 'post_emoji_reactions',
  },

  post_hashtags: {
    cardinality: '1:N',
    columns: {
      hashtag_id: {
        label: 'ハッシュタグ ID',
        nullable: false,
        type: 'integer',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'ハッシュタグ (中間)',
    table: 'post_hashtags',
  },

  post_interactions: {
    cardinality: '1:1',
    columns: {
      is_bookmarked: {
        label: 'ブックマーク済み',
        nullable: false,
        type: 'integer',
      },
      is_favourited: {
        label: 'お気に入り済み',
        nullable: true,
        type: 'integer',
      },
      is_muted: {
        label: 'ミュート済み',
        nullable: true,
        type: 'integer',
      },
      is_pinned: {
        label: 'ピン留め済み',
        nullable: true,
        type: 'integer',
      },
      is_reblogged: {
        label: 'リブログ済み',
        nullable: true,
        type: 'integer',
      },
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: '投稿インタラクション',
    table: 'post_interactions',
  },

  post_media: {
    cardinality: '1:N',
    columns: {
      blurhash: {
        label: 'BlurHash',
        nullable: true,
        type: 'text',
      },
      description: {
        label: '説明',
        nullable: true,
        type: 'text',
      },
      url: {
        label: 'URL',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'メディア',
    table: 'post_media',
  },

  post_mentions: {
    cardinality: '1:N',
    columns: {
      acct: {
        label: 'アカウント ID',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'メンション',
    table: 'post_mentions',
  },

  post_stats: {
    cardinality: '1:1',
    columns: {
      favourites_count: {
        label: 'お気に入り数',
        nullable: false,
        type: 'integer',
      },
      reblogs_count: {
        label: 'リブログ数',
        nullable: false,
        type: 'integer',
      },
      replies_count: {
        label: '返信数',
        nullable: false,
        type: 'integer',
      },
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: '投稿統計',
    table: 'post_stats',
  },

  posts: {
    cardinality: '1:1',
    columns: {
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
      plain_content: {
        label: 'テキスト本文',
        nullable: true,
        type: 'text',
      },
      spoiler_text: {
        label: 'CW テキスト',
        nullable: false,
        type: 'text',
      },
    },
    joinPaths: {},
    label: '投稿',
    table: 'posts',
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
      statuses_count: {
        label: '投稿数',
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
      display_name: {
        label: '表示名',
        nullable: false,
        type: 'text',
      },
      domain: {
        label: 'ドメイン',
        nullable: true,
        type: 'text',
      },
      is_bot: {
        label: 'Bot',
        nullable: true,
        type: 'integer',
      },
      is_locked: {
        label: '鍵アカウント',
        nullable: false,
        type: 'integer',
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

  servers: {
    cardinality: 'lookup',
    columns: {
      host: {
        label: 'ホスト',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      isSmallLookup: true,
    },
    joinPaths: {
      posts: {
        column: 'id',
        sourceColumn: 'origin_server_id',
      },
    },
    label: 'サーバー',
    table: 'servers',
  },

  timeline_entries: {
    cardinality: '1:N',
    columns: {
      created_at_ms: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      local_account_id: {
        label: 'ローカルアカウント ID',
        nullable: false,
        type: 'integer',
      },
      timeline_key: {
        knownValues: ['home', 'local', 'public'],
        label: 'タイムラインキー',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'post_id',
        sourceColumn: 'id',
      },
    },
    label: 'タイムライン',
    table: 'timeline_entries',
  },

  visibility_types: {
    cardinality: 'lookup',
    columns: {
      name: {
        knownValues: ['public', 'unlisted', 'private', 'direct'],
        label: '公開範囲名',
        nullable: false,
        type: 'text',
      },
    },
    hints: {
      isSmallLookup: true,
    },
    joinPaths: {
      posts: {
        column: 'id',
        sourceColumn: 'visibility_id',
      },
    },
    label: '公開範囲',
    table: 'visibility_types',
  },
}
