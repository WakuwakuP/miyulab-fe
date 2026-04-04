import type { TableRegistry } from './types'

export const POST_TABLES: TableRegistry = {
  hashtags: {
    cardinality: '1:N',
    columns: {
      name: {
        label: '名前',
        nullable: false,
        type: 'text',
      },
      url: {
        label: 'URL',
        nullable: true,
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
      author_name: {
        label: '著者名',
        nullable: true,
        type: 'text',
      },
      author_url: {
        label: '著者 URL',
        nullable: true,
        type: 'text',
      },
      blurhash: {
        label: 'BlurHash',
        nullable: true,
        type: 'text',
      },
      card_type_id: {
        label: 'カード種別 ID',
        nullable: false,
        type: 'integer',
      },
      description: {
        label: '説明',
        nullable: false,
        type: 'text',
      },
      embed_url: {
        label: '埋め込み URL',
        nullable: true,
        type: 'text',
      },
      height: {
        label: '高さ',
        nullable: true,
        type: 'integer',
      },
      html: {
        label: 'HTML',
        nullable: true,
        type: 'text',
      },
      image: {
        label: '画像 URL',
        nullable: true,
        type: 'text',
      },
      post_id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
      },
      provider_name: {
        label: 'プロバイダー名',
        nullable: true,
        type: 'text',
      },
      provider_url: {
        label: 'プロバイダー URL',
        nullable: true,
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
      width: {
        label: '幅',
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
    label: 'リンクカード',
    table: 'link_cards',
  },

  poll_options: {
    cardinality: '1:N',
    columns: {
      poll_id: {
        label: 'アンケート ID',
        nullable: false,
        type: 'integer',
      },
      sort_order: {
        label: '順序',
        nullable: false,
        type: 'integer',
      },
      title: {
        label: 'タイトル',
        nullable: false,
        type: 'text',
      },
      votes_count: {
        label: '得票数',
        nullable: true,
        type: 'integer',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'poll_id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'polls',
            toColumn: 'id',
          },
        ],
      },
    },
    label: '投票選択肢',
    table: 'poll_options',
  },

  poll_votes: {
    cardinality: '1:N',
    columns: {
      local_account_id: {
        label: 'ローカルアカウント ID',
        nullable: false,
        type: 'integer',
      },
      own_votes_json: {
        label: '自分の投票 (JSON)',
        nullable: true,
        type: 'text',
      },
      poll_id: {
        label: 'アンケート ID',
        nullable: false,
        type: 'integer',
      },
      voted: {
        label: '投票済み',
        nullable: false,
        type: 'integer',
      },
    },
    hints: {
      preferExists: true,
    },
    joinPaths: {
      posts: {
        column: 'poll_id',
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'polls',
            toColumn: 'id',
          },
        ],
      },
    },
    label: '投票記録',
    table: 'poll_votes',
  },

  polls: {
    cardinality: '1:1',
    columns: {
      expired: {
        label: '期限切れ',
        nullable: false,
        type: 'integer',
      },
      expires_at: {
        label: '締め切り日時',
        nullable: true,
        type: 'text',
      },
      multiple: {
        label: '複数選択',
        nullable: false,
        type: 'integer',
      },
      poll_local_id: {
        label: 'アンケートローカル ID',
        nullable: true,
        type: 'text',
      },
      post_id: {
        label: '投稿 ID',
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
      post_id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
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
    columns: {
      custom_emoji_id: {
        label: 'カスタム絵文字 ID',
        nullable: false,
        type: 'integer',
      },
      post_id: {
        label: '投稿 ID',
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
      post_id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
      },
      static_url: {
        label: '静止画 URL',
        nullable: true,
        type: 'text',
      },
      url: {
        label: 'URL',
        nullable: true,
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
      post_id: {
        label: '投稿 ID',
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
      local_account_id: {
        label: 'ローカルアカウント ID',
        nullable: false,
        type: 'integer',
      },
      my_reaction_name: {
        label: '自分のリアクション名',
        nullable: true,
        type: 'text',
      },
      my_reaction_url: {
        label: '自分のリアクション URL',
        nullable: true,
        type: 'text',
      },
      post_id: {
        label: '投稿 ID',
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
      height: {
        label: '高さ',
        nullable: true,
        type: 'integer',
      },
      media_local_id: {
        label: 'メディアローカル ID',
        nullable: true,
        type: 'text',
      },
      media_type_id: {
        label: 'メディア種別 ID',
        nullable: false,
        type: 'integer',
      },
      post_id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
      },
      preview_url: {
        label: 'プレビュー URL',
        nullable: true,
        type: 'text',
      },
      remote_url: {
        label: 'リモート URL',
        nullable: true,
        type: 'text',
      },
      sort_order: {
        label: '順序',
        nullable: false,
        type: 'integer',
      },
      url: {
        label: 'URL',
        nullable: false,
        type: 'text',
      },
      width: {
        label: '幅',
        nullable: true,
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
      post_id: {
        label: '投稿 ID',
        nullable: false,
        type: 'integer',
      },
      profile_id: {
        label: 'プロフィール ID',
        nullable: true,
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
      emoji_reactions_json: {
        label: '絵文字リアクション (JSON)',
        nullable: false,
        type: 'text',
      },
      favourites_count: {
        label: 'お気に入り数',
        nullable: false,
        type: 'integer',
      },
      post_id: {
        label: '投稿 ID',
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
      updated_at: {
        label: '更新日時',
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

  timeline_entries: {
    cardinality: '1:N',
    columns: {
      created_at_ms: {
        label: '作成日時',
        nullable: false,
        type: 'integer',
      },
      display_post_id: {
        label: '表示投稿 ID',
        nullable: true,
        type: 'integer',
      },
      id: {
        label: 'エントリ ID',
        nullable: false,
        type: 'integer',
      },
      local_account_id: {
        label: 'ローカルアカウント ID',
        nullable: false,
        type: 'integer',
      },
      post_id: {
        label: '投稿 ID',
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
}
