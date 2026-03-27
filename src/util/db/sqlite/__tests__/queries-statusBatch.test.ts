import {
  BATCH_BELONGING_TAGS_SQL,
  BATCH_CUSTOM_EMOJIS_SQL,
  BATCH_INTERACTIONS_SQL,
  BATCH_MEDIA_SQL,
  BATCH_MENTIONS_SQL,
  BATCH_POLLS_SQL,
  BATCH_SQL_TEMPLATES,
  BATCH_TIMELINE_TYPES_SQL,
} from 'util/db/sqlite/queries/statusBatch'
import { describe, expect, it } from 'vitest'

// ─── helpers ────────────────────────────────────────────────────

/** __PH__ 定数と {IDS} テンプレートの両方を検証するヘルパー */
function sqlPair(
  constant: string,
  templateKey: keyof typeof BATCH_SQL_TEMPLATES,
) {
  return [constant, BATCH_SQL_TEMPLATES[templateKey]] as const
}

// ─── interactions バッチ ────────────────────────────────────────

describe('interactions バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_INTERACTIONS_SQL, 'interactions')

  it('interactions バッチが post_interactions を使用する', () => {
    expect(ph).toContain('post_interactions')
    expect(tpl).toContain('post_interactions')
  })

  it('interactions バッチが post_engagements を使用しない', () => {
    expect(ph).not.toContain('post_engagements')
    expect(tpl).not.toContain('post_engagements')
  })
})

// ─── media バッチ ───────────────────────────────────────────────

describe('media バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_MEDIA_SQL, 'media')

  it('media バッチが media_local_id を含む', () => {
    expect(ph).toContain('media_local_id')
    expect(tpl).toContain('media_local_id')
  })
})

// ─── mentions バッチ ────────────────────────────────────────────

describe('mentions バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_MENTIONS_SQL, 'mentions')

  it('mentions バッチが post_mentions を使用する（posts_mentions ではない）', () => {
    expect(ph).toContain('post_mentions')
    expect(ph).not.toContain('posts_mentions')
    expect(tpl).toContain('post_mentions')
    expect(tpl).not.toContain('posts_mentions')
  })

  it('mentions バッチが username, url カラムを含む', () => {
    expect(ph).toContain('pme.username')
    expect(ph).toContain('pme.url')
    expect(tpl).toContain('pme.username')
    expect(tpl).toContain('pme.url')
  })
})

// ─── timelineTypes バッチ ───────────────────────────────────────

describe('timelineTypes バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_TIMELINE_TYPES_SQL, 'timelineTypes')

  it('timelineTypes バッチが timeline_entries を使用する', () => {
    expect(ph).toContain('timeline_entries')
    expect(tpl).toContain('timeline_entries')
  })

  it('timelineTypes バッチが timeline_items を使用しない', () => {
    expect(ph).not.toContain('timeline_items')
    expect(tpl).not.toContain('timeline_items')
  })
})

// ─── belongingTags バッチ ───────────────────────────────────────

describe('belongingTags バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_BELONGING_TAGS_SQL, 'belongingTags')

  it('belongingTags バッチが hashtags.name を使用する（normalized_name ではない）', () => {
    expect(ph).toContain('ht.name')
    expect(ph).not.toContain('normalized_name')
    expect(tpl).toContain('ht.name')
    expect(tpl).not.toContain('normalized_name')
  })
})

// ─── customEmojis バッチ ────────────────────────────────────────

describe('customEmojis バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_CUSTOM_EMOJIS_SQL, 'customEmojis')

  it('customEmojis バッチが custom_emojis.url を使用する（image_url ではない）', () => {
    expect(ph).toContain('ce.url')
    expect(ph).not.toContain('image_url')
    expect(tpl).toContain('ce.url')
    expect(tpl).not.toContain('image_url')
  })

  it('customEmojis バッチが usage_context を含まない', () => {
    expect(ph).not.toContain('usage_context')
    expect(tpl).not.toContain('usage_context')
  })
})

// ─── polls バッチ ───────────────────────────────────────────────

describe('polls バッチ', () => {
  const [ph, tpl] = sqlPair(BATCH_POLLS_SQL, 'polls')

  it('polls バッチが poll_votes を LEFT JOIN する', () => {
    expect(ph).toContain('LEFT JOIN poll_votes')
    expect(tpl).toContain('LEFT JOIN poll_votes')
  })

  it('polls バッチが sort_order を使用する（option_index ではない）', () => {
    expect(ph).toContain('sort_order')
    expect(ph).not.toContain('option_index')
    expect(tpl).toContain('sort_order')
    expect(tpl).not.toContain('option_index')
  })
})
