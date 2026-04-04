import type { TableRegistry } from './types'

export const LOOKUP_TABLES: TableRegistry = {
  card_types: {
    cardinality: 'lookup',
    columns: {
      name: {
        knownValues: ['link', 'photo', 'video', 'rich'],
        label: 'カード種別名',
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
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'link_cards',
            toColumn: 'card_type_id',
          },
        ],
      },
    },
    label: 'カード種別',
    table: 'card_types',
  },

  media_types: {
    cardinality: 'lookup',
    columns: {
      name: {
        knownValues: ['unknown', 'image', 'gifv', 'video', 'audio'],
        label: 'メディア種別名',
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
        sourceColumn: 'id',
        via: [
          {
            fromColumn: 'post_id',
            table: 'post_media',
            toColumn: 'media_type_id',
          },
        ],
      },
    },
    label: 'メディア種別',
    table: 'media_types',
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
