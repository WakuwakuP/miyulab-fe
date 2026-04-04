import { describe, expect, it } from 'vitest'
import type { BatchMaps } from '../../sqlite/queries/statusBatch'
import {
  assembleNotificationFromFlat,
  assemblePostFromFlat,
} from '../executor/flatFetchAssembler'

// ================================================================
// ヘルパー
// ================================================================

function emptyBatchMaps(): BatchMaps {
  return {
    belongingTagsMap: new Map(),
    customEmojisMap: new Map(),
    emojiReactionsMap: new Map(),
    interactionsMap: new Map(),
    mediaMap: new Map(),
    mentionsMap: new Map(),
    pollsMap: new Map(),
    profileEmojisMap: new Map(),
    timelineTypesMap: new Map(),
  }
}

/**
 * POST_FLAT_SELECT の30カラム行を作成する
 */
function makePostRow(
  postId: number,
  overrides: Partial<{
    authorAcct: string
    authorAvatar: string
    authorBot: number
    authorDisplayName: string
    authorProfileId: number
    authorUrl: string
    authorUsername: string
    backendUrl: string
    contentHtml: string
    createdAtMs: number
    editedAtMs: number | null
    emojiReactionsJson: string | null
    favouritesCount: number
    inReplyToId: string | null
    isLocalOnly: number
    isReblog: number
    isSensitive: number
    language: string | null
    localId: string
    objectUri: string
    reblogOfPostId: number | null
    reblogsCount: number
    repliesCount: number
    spoilerText: string
    visibility: string
  }> = {},
): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(30).fill(null)
  row[0] = postId
  row[1] = overrides.objectUri ?? `https://example.com/objects/${postId}`
  row[2] = null // canonical_url
  row[3] = overrides.contentHtml ?? '<p>Hello</p>'
  row[4] = overrides.createdAtMs ?? 1700000000000
  row[5] = overrides.editedAtMs ?? null
  row[6] = overrides.language ?? 'ja'
  row[7] = overrides.isSensitive ?? 0
  row[8] = overrides.spoilerText ?? ''
  row[9] = overrides.inReplyToId ?? null
  row[10] = overrides.reblogOfPostId ?? null
  row[11] = overrides.isReblog ?? 0
  row[12] = overrides.isLocalOnly ?? 0
  row[13] = overrides.visibility ?? 'public'
  row[14] = overrides.authorProfileId ?? 100
  row[15] = overrides.authorAcct ?? 'user@example.com'
  row[16] = overrides.authorUsername ?? 'user'
  row[17] = overrides.authorDisplayName ?? 'Test User'
  row[18] = overrides.authorAvatar ?? 'https://example.com/avatar.png'
  row[19] = '' // header
  row[20] = 0 // locked
  row[21] = overrides.authorBot ?? 0
  row[22] = overrides.authorUrl ?? 'https://example.com/@user'
  row[23] = overrides.repliesCount ?? 0
  row[24] = overrides.reblogsCount ?? 0
  row[25] = overrides.favouritesCount ?? 0
  row[26] = overrides.emojiReactionsJson ?? null
  row[27] = overrides.backendUrl ?? 'https://example.com'
  row[28] = overrides.localId ?? `local_${postId}`
  row[29] = '' // author_account_id
  return row
}

/**
 * NOTIFICATION_FLAT_SELECT の19カラム行を作成する
 */
function makeNotifRow(
  id: number,
  overrides: Partial<{
    actorAcct: string
    actorAvatar: string
    actorBot: number
    actorDisplayName: string
    actorProfileId: number | null
    actorUrl: string
    actorUsername: string
    backendUrl: string
    createdAtMs: number
    isRead: number
    localAccountId: number
    localId: string
    notificationType: string
    reactionName: string | null
    reactionUrl: string | null
    relatedPostId: number | null
  }> = {},
): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(19).fill(null)
  row[0] = id
  row[1] = overrides.localAccountId ?? 1
  row[2] = overrides.localId ?? `notif_${id}`
  row[3] = overrides.createdAtMs ?? 1700000000000
  row[4] = overrides.isRead ?? 0
  row[5] = overrides.relatedPostId ?? null
  row[6] = overrides.reactionName ?? null
  row[7] = overrides.reactionUrl ?? null
  row[8] = overrides.actorProfileId ?? 200
  row[9] = overrides.notificationType ?? 'favourite'
  row[10] = overrides.backendUrl ?? 'https://example.com'
  row[11] = overrides.actorAcct ?? 'actor@example.com'
  row[12] = overrides.actorUsername ?? 'actor'
  row[13] = overrides.actorDisplayName ?? 'Actor Name'
  row[14] = overrides.actorAvatar ?? 'https://example.com/actor.png'
  row[15] = '' // header
  row[16] = 0 // locked
  row[17] = overrides.actorBot ?? 0
  row[18] = overrides.actorUrl ?? 'https://example.com/@actor'
  return row
}

// ================================================================
// assemblePostFromFlat テスト
// ================================================================

describe('assemblePostFromFlat', () => {
  describe('基本フィールド', () => {
    it('投稿ID、URI、コンテンツが正しくマッピングされる', () => {
      const row = makePostRow(42, {
        contentHtml: '<p>テスト投稿</p>',
        objectUri: 'https://example.com/objects/42',
      })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.post_id).toBe(42)
      expect(result.uri).toBe('https://example.com/objects/42')
      expect(result.content).toBe('<p>テスト投稿</p>')
    })

    it('created_at が ISO 文字列に変換される', () => {
      const row = makePostRow(1, { createdAtMs: 1700000000000 })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.created_at).toBe(new Date(1700000000000).toISOString())
      expect(result.created_at_ms).toBe(1700000000000)
    })

    it('edited_at が null の場合は null のまま', () => {
      const row = makePostRow(1, { editedAtMs: null })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.edited_at).toBeNull()
      expect(result.edited_at_ms).toBeNull()
    })

    it('edited_at が値ありの場合は ISO 文字列に変換される', () => {
      const row = makePostRow(1, { editedAtMs: 1700001000000 })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.edited_at).toBe(new Date(1700001000000).toISOString())
    })

    it('visibility がそのまま設定される', () => {
      const row = makePostRow(1, { visibility: 'private' })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.visibility).toBe('private')
    })

    it('sensitive フラグが boolean に変換される', () => {
      const row = makePostRow(1, { isSensitive: 1 })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.sensitive).toBe(true)
    })

    it('id は local_id が使われる', () => {
      const row = makePostRow(1, { localId: 'abc123' })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.id).toBe('abc123')
    })

    it('backendUrl が正しく設定される', () => {
      const row = makePostRow(1, { backendUrl: 'https://pl.waku.dev' })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.backendUrl).toBe('https://pl.waku.dev')
    })
  })

  describe('アカウント情報', () => {
    it('著者のプロフィール情報がマッピングされる', () => {
      const row = makePostRow(1, {
        authorAcct: 'alice@mastodon.social',
        authorAvatar: 'https://example.com/alice.png',
        authorBot: 1,
        authorDisplayName: 'Alice',
        authorUrl: 'https://mastodon.social/@alice',
        authorUsername: 'alice',
      })
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.account.acct).toBe('alice@mastodon.social')
      expect(result.account.username).toBe('alice')
      expect(result.account.display_name).toBe('Alice')
      expect(result.account.avatar).toBe('https://example.com/alice.png')
      expect(result.account.bot).toBe(true)
      expect(result.account.url).toBe('https://mastodon.social/@alice')
    })

    it('account.id は空文字列', () => {
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.account.id).toBe('')
    })
  })

  describe('interactions (バッチ)', () => {
    it('interactionsMap にデータがあれば favourited / reblogged / bookmarked が設定される', () => {
      const maps = emptyBatchMaps()
      maps.interactionsMap.set(
        1,
        JSON.stringify({
          is_bookmarked: 1,
          is_favourited: 1,
          is_muted: 0,
          is_pinned: 0,
          is_reblogged: 0,
          my_reaction_name: null,
          my_reaction_url: null,
        }),
      )
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, maps)

      expect(result.favourited).toBe(true)
      expect(result.reblogged).toBe(false)
      expect(result.bookmarked).toBe(true)
    })

    it('interactionsMap にデータがなければ全て false', () => {
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.favourited).toBe(false)
      expect(result.reblogged).toBe(false)
      expect(result.bookmarked).toBe(false)
    })
  })

  describe('メディア (バッチ)', () => {
    it('mediaMap にデータがあれば media_attachments がパースされる', () => {
      const maps = emptyBatchMaps()
      maps.mediaMap.set(
        1,
        JSON.stringify([
          {
            blurhash: null,
            description: 'photo',
            id: 'media1',
            meta: null,
            preview_url: 'https://example.com/thumb.jpg',
            remote_url: null,
            text_url: null,
            type: 'image',
            url: 'https://example.com/image.jpg',
          },
        ]),
      )
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, maps)

      expect(result.media_attachments).toHaveLength(1)
      expect(result.media_attachments[0].type).toBe('image')
    })

    it('mediaMap にデータがなければ空配列', () => {
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.media_attachments).toEqual([])
    })
  })

  describe('カスタム絵文字 (バッチ)', () => {
    it('customEmojisMap にデータがあれば emojis がパースされる', () => {
      const maps = emptyBatchMaps()
      maps.customEmojisMap.set(
        1,
        JSON.stringify([
          {
            shortcode: 'blobcat',
            static_url: 'https://example.com/blobcat.png',
            url: 'https://example.com/blobcat.png',
            visible_in_picker: true,
          },
        ]),
      )
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, maps)

      expect(result.emojis).toHaveLength(1)
      expect(result.emojis[0].shortcode).toBe('blobcat')
    })
  })

  describe('デフォルト値', () => {
    it('reblog は null', () => {
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.reblog).toBeNull()
    })

    it('muted / pinned は null', () => {
      const row = makePostRow(1)
      const result = assemblePostFromFlat(row, emptyBatchMaps())

      expect(result.muted).toBeNull()
      expect(result.pinned).toBeNull()
    })
  })
})

// ================================================================
// assembleNotificationFromFlat テスト
// ================================================================

describe('assembleNotificationFromFlat', () => {
  describe('基本フィールド', () => {
    it('通知タイプ、ID、backendUrl が正しくマッピングされる', () => {
      const row = makeNotifRow(10, {
        backendUrl: 'https://pl.waku.dev',
        localId: 'notif_abc',
        notificationType: 'mention',
      })
      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.type).toBe('mention')
      expect(result.id).toBe('notif_abc')
      expect(result.notification_id).toBe(10)
      expect(result.backendUrl).toBe('https://pl.waku.dev')
    })

    it('created_at が ISO 文字列に変換される', () => {
      const row = makeNotifRow(10, { createdAtMs: 1700000000000 })
      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.created_at).toBe(new Date(1700000000000).toISOString())
      expect(result.created_at_ms).toBe(1700000000000)
    })
  })

  describe('アクター情報', () => {
    it('アクターのプロフィール情報がマッピングされる', () => {
      const row = makeNotifRow(10, {
        actorAcct: 'bob@mastodon.social',
        actorAvatar: 'https://example.com/bob.png',
        actorBot: 0,
        actorDisplayName: 'Bob',
        actorUrl: 'https://mastodon.social/@bob',
        actorUsername: 'bob',
      })
      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.account.acct).toBe('bob@mastodon.social')
      expect(result.account.username).toBe('bob')
      expect(result.account.display_name).toBe('Bob')
      expect(result.account.avatar).toBe('https://example.com/bob.png')
      expect(result.account.bot).toBe(false)
    })

    it('アクター絵文字Map にデータがあれば emojis がパースされる', () => {
      const row = makeNotifRow(10, { actorProfileId: 200 })
      const actorEmojisMap = new Map<number, string>()
      actorEmojisMap.set(
        200,
        JSON.stringify([
          {
            shortcode: 'partyblob',
            static_url: 'https://example.com/partyblob.png',
            url: 'https://example.com/partyblob.png',
            visible_in_picker: true,
          },
        ]),
      )

      const result = assembleNotificationFromFlat(
        row,
        new Map(),
        actorEmojisMap,
      )

      expect(result.account.emojis).toHaveLength(1)
      expect(result.account.emojis[0].shortcode).toBe('partyblob')
    })
  })

  describe('関連投稿', () => {
    it('related_post_id がある場合、postMap から status が設定される', () => {
      const row = makeNotifRow(10, { relatedPostId: 50 })
      const postMap = new Map()
      postMap.set(50, {
        content: '<p>referenced post</p>',
        post_id: 50,
      })

      const result = assembleNotificationFromFlat(row, postMap, new Map())

      expect(result.status).toBeDefined()
      expect((result.status as { post_id: number }).post_id).toBe(50)
    })

    it('related_post_id が null の場合、status は undefined', () => {
      const row = makeNotifRow(10, { relatedPostId: null })
      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.status).toBeUndefined()
    })

    it('related_post_id が postMap にない場合、status は undefined', () => {
      const row = makeNotifRow(10, { relatedPostId: 999 })
      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.status).toBeUndefined()
    })
  })

  describe('リアクション', () => {
    it('reaction_name がある場合、reaction オブジェクトが設定される', () => {
      const row = makeNotifRow(10, {
        notificationType: 'emoji_reaction',
        reactionName: '⭐',
        reactionUrl: null,
      })

      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.reaction).toBeDefined()
      expect(result.reaction?.name).toBe('⭐')
      expect(result.reaction?.count).toBe(1)
    })

    it('reaction_name と reaction_url がある場合、URL が設定される', () => {
      const row = makeNotifRow(10, {
        reactionName: ':blobcat:',
        reactionUrl: 'https://example.com/blobcat.png',
      })

      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.reaction?.url).toBe('https://example.com/blobcat.png')
      expect(result.reaction?.static_url).toBe(
        'https://example.com/blobcat.png',
      )
    })

    it('reaction_name が null の場合、reaction は undefined', () => {
      const row = makeNotifRow(10, {
        notificationType: 'favourite',
        reactionName: null,
      })

      const result = assembleNotificationFromFlat(row, new Map(), new Map())

      expect(result.reaction).toBeUndefined()
    })
  })
})
