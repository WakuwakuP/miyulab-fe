import {
  STATUS_BASE_JOINS,
  STATUS_BASE_SELECT,
  STATUS_SELECT,
} from 'util/db/sqlite/queries/statusSelect'
import { describe, expect, it } from 'vitest'

describe('statusSelect — 新スキーマ対応', () => {
  // ================================================================
  // STATUS_BASE_SELECT
  // ================================================================

  describe('STATUS_BASE_SELECT に新カラムが含まれている', () => {
    it('p.id を使用している（posts の PK）', () => {
      expect(STATUS_BASE_SELECT).toMatch(/\bp\.id\b/)
    })

    it('vt.name を使用している（visibility_types.name）', () => {
      expect(STATUS_BASE_SELECT).toContain('vt.name')
    })

    it('p.edited_at_ms を使用している', () => {
      expect(STATUS_BASE_SELECT).toContain('p.edited_at_ms')
    })

    it('pr.is_locked を使用している', () => {
      expect(STATUS_BASE_SELECT).toContain('pr.is_locked')
    })

    it('pr.is_bot を使用している', () => {
      expect(STATUS_BASE_SELECT).toContain('pr.is_bot')
    })

    it('pr.url を使用している（author URL）', () => {
      // COALESCE(pr.url, '') AS author_url の形で含まれている
      expect(STATUS_BASE_SELECT).toMatch(/[^r]pr\.url/)
    })

    it('p.reblog_of_post_id を使用している', () => {
      expect(STATUS_BASE_SELECT).toContain('p.reblog_of_post_id')
    })

    it('rs.edited_at_ms を使用している（リブログ元）', () => {
      expect(STATUS_BASE_SELECT).toContain('rs.edited_at_ms')
    })

    it('rpr.is_locked を使用している（リブログ元）', () => {
      expect(STATUS_BASE_SELECT).toContain('rpr.is_locked')
    })

    it('rpr.is_bot を使用している（リブログ元）', () => {
      expect(STATUS_BASE_SELECT).toContain('rpr.is_bot')
    })

    it('post_backend_ids を rb_local_id サブクエリで使用している', () => {
      expect(STATUS_BASE_SELECT).toContain('post_backend_ids')
    })
  })

  describe('STATUS_BASE_SELECT に旧カラムが含まれていない', () => {
    it('vt.code を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('vt.code')
    })

    it('p.stored_at を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('p.stored_at')
    })

    it('p.reblog_of_uri を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('p.reblog_of_uri')
    })

    it('pr.actor_uri を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('pr.actor_uri')
    })

    it('rpr.actor_uri を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('rpr.actor_uri')
    })

    it('p.edited_at（_ms なし）を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toMatch(/p\.edited_at(?!_ms)/)
    })

    it('rs.edited_at（_ms なし）を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toMatch(/rs\.edited_at(?!_ms)/)
    })

    it('p.has_media を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('p.has_media')
    })

    it('posts_backends を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('posts_backends')
    })

    it('pr.locked（is_ プレフィックスなし）を含まない', () => {
      // pr.is_locked は OK だが pr.locked は NG
      expect(STATUS_BASE_SELECT).not.toMatch(/[^_]pr\.locked/)
    })

    it('pr.bot（is_ プレフィックスなし）を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toMatch(/[^_]pr\.bot/)
    })

    it('p.repost_of_post_id を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('p.repost_of_post_id')
    })

    it('profile_aliases を含まない', () => {
      expect(STATUS_BASE_SELECT).not.toContain('profile_aliases')
    })
  })

  // ================================================================
  // STATUS_BASE_JOINS
  // ================================================================

  describe('STATUS_BASE_JOINS に新テーブル名が使われている', () => {
    it('profiles テーブルを JOIN している', () => {
      expect(STATUS_BASE_JOINS).toContain('profiles')
    })

    it('visibility_types テーブルを JOIN している', () => {
      expect(STATUS_BASE_JOINS).toContain('visibility_types')
    })

    it('post_stats テーブルを JOIN している', () => {
      expect(STATUS_BASE_JOINS).toContain('post_stats')
    })

    it('local_accounts テーブルを JOIN している', () => {
      expect(STATUS_BASE_JOINS).toContain('local_accounts')
    })

    it('reblog_of_post_id を JOIN 条件で使用している', () => {
      expect(STATUS_BASE_JOINS).toContain('reblog_of_post_id')
    })
  })

  describe('STATUS_BASE_JOINS に profile_aliases が含まれていない', () => {
    it('profile_aliases を含まない', () => {
      expect(STATUS_BASE_JOINS).not.toContain('profile_aliases')
    })
  })

  describe('STATUS_BASE_JOINS に post_backend_ids が含まれている', () => {
    it('post_backend_ids を JOIN に含む', () => {
      expect(STATUS_BASE_JOINS).toContain('post_backend_ids')
    })
  })

  describe('STATUS_BASE_JOINS に posts_backends が含まれていない', () => {
    it('posts_backends を含まない', () => {
      expect(STATUS_BASE_JOINS).not.toContain('posts_backends')
    })
  })

  // ================================================================
  // STATUS_SELECT サブクエリ
  // ================================================================

  describe('サブクエリで post_interactions を使用する（post_engagements ではない）', () => {
    it('STATUS_SELECT に post_interactions が含まれている', () => {
      expect(STATUS_SELECT).toContain('post_interactions')
    })

    it('STATUS_SELECT に post_engagements が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('post_engagements')
    })

    it('STATUS_SELECT に engagement_types が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('engagement_types')
    })
  })

  describe('サブクエリで timeline_entries を使用する（timeline_items ではない）', () => {
    it('STATUS_SELECT に timeline_entries が含まれている', () => {
      expect(STATUS_SELECT).toContain('timeline_entries')
    })

    it('STATUS_SELECT に timeline_items が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('timeline_items')
    })

    it('STATUS_SELECT に channel_kinds が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('channel_kinds')
    })
  })

  describe('サブクエリで post_mentions を使用する（posts_mentions ではない）', () => {
    it('STATUS_SELECT に post_mentions が含まれている', () => {
      expect(STATUS_SELECT).toContain('post_mentions')
    })

    it('STATUS_SELECT に posts_mentions が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('posts_mentions')
    })
  })

  describe('絵文字サブクエリで custom_emojis.url を使用する（image_url ではない）', () => {
    it('STATUS_SELECT に ce.url が含まれている', () => {
      // ce.url は json_object 内で 'url', ce.url の形で現れる
      expect(STATUS_SELECT).toContain('ce.url')
    })

    it('STATUS_SELECT に ce.image_url が含まれていない', () => {
      expect(STATUS_SELECT).not.toContain('ce.image_url')
    })

    it('STATUS_SELECT に pce.custom_emoji_id を使用している（pce.emoji_id ではない）', () => {
      expect(STATUS_SELECT).toContain('pce.custom_emoji_id')
      expect(STATUS_SELECT).not.toMatch(/pce\.emoji_id\b/)
    })

    it('STATUS_SELECT に ce.id を使用している（ce.emoji_id ではない）', () => {
      expect(STATUS_SELECT).toMatch(/ce\.id\b/)
      expect(STATUS_SELECT).not.toContain('ce.emoji_id')
    })
  })

  // ================================================================
  // STATUS_SELECT — その他の新スキーマ変更
  // ================================================================

  describe('STATUS_SELECT のハッシュタグサブクエリ', () => {
    it('ht.name を使用している（ht.display_name / ht.normalized_name ではない）', () => {
      expect(STATUS_SELECT).toContain('ht.name')
      expect(STATUS_SELECT).not.toContain('ht.display_name')
      expect(STATUS_SELECT).not.toContain('ht.normalized_name')
    })

    it('ht.id を使用している（ht.hashtag_id ではない）', () => {
      expect(STATUS_SELECT).toMatch(/ht\.id\b/)
      // pht.hashtag_id（FK）は許容するが、ht.hashtag_id（旧PK参照）は NG
      expect(STATUS_SELECT).not.toMatch(/[= ]ht\.hashtag_id/)
    })
  })

  describe('STATUS_SELECT のポールサブクエリ', () => {
    it('pl.id を使用している（pl.poll_id ではない）', () => {
      expect(STATUS_SELECT).toMatch(/pl\.id\b/)
      expect(STATUS_SELECT).not.toContain('pl.poll_id')
    })

    it('po.sort_order を使用している（po.option_index ではない）', () => {
      expect(STATUS_SELECT).toContain('po.sort_order')
      expect(STATUS_SELECT).not.toContain('po.option_index')
    })
  })

  describe('STATUS_SELECT のメディアサブクエリ', () => {
    it('mt.name を使用している（mt.code ではない）', () => {
      expect(STATUS_SELECT).toContain('mt.name')
      expect(STATUS_SELECT).not.toContain('mt.code')
    })

    it('mt.id を使用している（mt.media_type_id ではない）', () => {
      expect(STATUS_SELECT).toMatch(/mt\.id\b/)
      expect(STATUS_SELECT).not.toContain('mt.media_type_id')
    })
  })
})
