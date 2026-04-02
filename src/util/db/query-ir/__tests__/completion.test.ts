import { describe, expect, it } from 'vitest'
import { resolveOutputTable, SUPPORTED_OUTPUT_TABLES } from '../completion'

describe('resolveOutputTable', () => {
  describe('自己 PK (id カラム)', () => {
    it('outputIdColumn が "id" の場合、sourceTable をそのまま返す', () => {
      expect(resolveOutputTable('posts', 'id')).toBe('posts')
    })

    it('notifications テーブルで id → notifications', () => {
      expect(resolveOutputTable('notifications', 'id')).toBe('notifications')
    })

    it('任意のテーブル名でも id なら sourceTable', () => {
      expect(resolveOutputTable('timeline_entries', 'id')).toBe(
        'timeline_entries',
      )
    })
  })

  describe('FK カラム → ターゲットテーブル解決', () => {
    it('post_id → posts', () => {
      expect(resolveOutputTable('timeline_entries', 'post_id')).toBe('posts')
    })

    it('display_post_id → posts', () => {
      expect(resolveOutputTable('posts', 'display_post_id')).toBe('posts')
    })

    it('reblog_of_post_id → posts', () => {
      expect(resolveOutputTable('posts', 'reblog_of_post_id')).toBe('posts')
    })

    it('quote_of_post_id → posts', () => {
      expect(resolveOutputTable('posts', 'quote_of_post_id')).toBe('posts')
    })

    it('related_post_id → posts', () => {
      expect(resolveOutputTable('notifications', 'related_post_id')).toBe(
        'posts',
      )
    })

    it('author_profile_id → profiles', () => {
      expect(resolveOutputTable('posts', 'author_profile_id')).toBe('profiles')
    })

    it('actor_profile_id → profiles', () => {
      expect(resolveOutputTable('notifications', 'actor_profile_id')).toBe(
        'profiles',
      )
    })

    it('server_id → servers', () => {
      expect(resolveOutputTable('profiles', 'server_id')).toBe('servers')
    })

    it('origin_server_id → servers', () => {
      expect(resolveOutputTable('posts', 'origin_server_id')).toBe('servers')
    })

    it('local_account_id → local_accounts', () => {
      expect(resolveOutputTable('posts', 'local_account_id')).toBe(
        'local_accounts',
      )
    })

    it('notification_type_id → notification_types', () => {
      expect(resolveOutputTable('notifications', 'notification_type_id')).toBe(
        'notification_types',
      )
    })

    it('visibility_id → visibility_types', () => {
      expect(resolveOutputTable('posts', 'visibility_id')).toBe(
        'visibility_types',
      )
    })

    it('card_type_id → card_types', () => {
      expect(resolveOutputTable('posts', 'card_type_id')).toBe('card_types')
    })

    it('media_type_id → media_types', () => {
      expect(resolveOutputTable('post_media', 'media_type_id')).toBe(
        'media_types',
      )
    })
  })

  describe('フォールバック', () => {
    it('未知のカラム名は sourceTable にフォールバック', () => {
      expect(resolveOutputTable('posts', 'unknown_column')).toBe('posts')
    })

    it('空文字列のカラム名もフォールバック', () => {
      expect(resolveOutputTable('notifications', '')).toBe('notifications')
    })
  })
})

describe('SUPPORTED_OUTPUT_TABLES', () => {
  it('posts を含む', () => {
    expect(SUPPORTED_OUTPUT_TABLES.has('posts')).toBe(true)
  })

  it('notifications を含む', () => {
    expect(SUPPORTED_OUTPUT_TABLES.has('notifications')).toBe(true)
  })

  it('サポート対象は 2 つだけ', () => {
    expect(SUPPORTED_OUTPUT_TABLES.size).toBe(2)
  })

  it('profiles はサポート対象外', () => {
    expect(SUPPORTED_OUTPUT_TABLES.has('profiles')).toBe(false)
  })
})
