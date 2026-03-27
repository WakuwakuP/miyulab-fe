import { describe, expect, it } from 'vitest'

// statusReadStore の関数はすべて async で DB 接続が必要だが、
// ここではソースコードの SQL 文字列を静的に検証するため、
// モジュールのソースを文字列として読み込んで検証する。

// NOTE: statusReadStore は async 関数のみをエクスポートし、
// SQL 文字列は関数内ローカル変数のため直接インポートできない。
// そのため、ソースコードのテキストを読み込んで静的解析する。

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const statusReadStorePath = resolve(__dirname, '../stores/statusReadStore.ts')
const source = readFileSync(statusReadStorePath, 'utf-8')

// ─── Phase 1 クエリ: timeline_entries ────────────────────────────

describe('Phase 1 クエリが timeline_entries を使用する', () => {
  it('getStatusesByTimelineType の Phase 1 SQL が timeline_entries を含む', () => {
    // getStatusesByTimelineType 関数のソースを抽出
    const fnMatch = source.match(
      /async function getStatusesByTimelineType[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).toContain('timeline_entries')
  })

  it('getStatusesByCustomQuery の ptt JOIN が timeline_entries を含む', () => {
    const fnMatch = source.match(
      /async function getStatusesByCustomQuery[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    // ptt 参照時に timeline_entries を使う
    expect(fnSource).toContain('timeline_entries')
  })
})

// ─── Phase 1 クエリ: timeline_items を使用しない ─────────────────

describe('Phase 1 クエリが timeline_items を使用しない', () => {
  it('getStatusesByTimelineType が timeline_items を含まない', () => {
    const fnMatch = source.match(
      /async function getStatusesByTimelineType[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).not.toContain('timeline_items')
  })

  it('getStatusesByCustomQuery が timeline_items を含まない', () => {
    const fnMatch = source.match(
      /async function getStatusesByCustomQuery[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).not.toContain('timeline_items')
  })
})

// ─── getDistinctTimelineTypes ───────────────────────────────────

describe('getDistinctTimelineTypes が timeline_entries を使用する', () => {
  it('getDistinctTimelineTypes の SQL が timeline_entries を含む', () => {
    const fnMatch = source.match(
      /async function getDistinctTimelineTypes[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).toContain('timeline_entries')
  })

  it('getDistinctTimelineTypes が timeline_key を使用する（code ではない）', () => {
    const fnMatch = source.match(
      /async function getDistinctTimelineTypes[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).toContain('timeline_key')
  })

  it('getDistinctTimelineTypes が channel_kinds を使用しない', () => {
    const fnMatch = source.match(
      /async function getDistinctTimelineTypes[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).not.toContain('channel_kinds')
  })

  it('getDistinctTimelineTypes が timelines テーブルを JOIN しない', () => {
    const fnMatch = source.match(
      /async function getDistinctTimelineTypes[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    // "timelines" 単体のテーブル参照がないことを確認
    // （timeline_entries は含まれるので、単語境界で確認）
    expect(fnSource).not.toMatch(/\btimelines\b(?!_)/)
  })
})

// ─── posts_backends テーブルを使用しない ─────────────────────────

describe('posts_backends テーブルを使用しない', () => {
  it('ソース全体が posts_backends を含まない', () => {
    expect(source).not.toContain('posts_backends')
  })

  it('post_backend_ids を使用している', () => {
    expect(source).toContain('post_backend_ids')
  })
})

// ─── post_engagements テーブルを使用しない ───────────────────────

describe('post_engagements テーブルを使用しない', () => {
  it('ソース全体が post_engagements を含まない', () => {
    expect(source).not.toContain('post_engagements')
  })

  it('ソース全体が engagement_types を含まない', () => {
    expect(source).not.toContain('engagement_types')
  })

  it('getBookmarkedStatuses が post_interactions を使用する', () => {
    const fnMatch = source.match(
      /async function getBookmarkedStatuses[\s\S]*?^}/m,
    )
    expect(fnMatch).not.toBeNull()
    const fnSource = fnMatch![0]
    expect(fnSource).toContain('post_interactions')
    expect(fnSource).toContain('is_bookmarked')
  })
})
