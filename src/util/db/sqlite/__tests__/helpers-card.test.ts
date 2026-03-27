import { syncLinkCard } from 'util/db/sqlite/helpers/card'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録し、SELECT 時に指定の結果を返す。
 */
function createMockDb(selectResult?: unknown[][]): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        return selectResult ?? []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── syncLinkCard ───────────────────────────────────────────────

describe('syncLinkCard', () => {
  it('リンクカードを投稿に関連付けて保存する（UPSERT）', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 42, {
      description: 'テスト説明文',
      title: 'テスト記事',
      url: 'https://example.com/article',
    })

    expect(calls).toHaveLength(1)

    const sql = calls[0].sql
    // INSERT ... ON CONFLICT(post_id) DO UPDATE による UPSERT
    expect(sql).toContain('INSERT INTO link_cards')
    expect(sql).toContain('ON CONFLICT(post_id) DO UPDATE')

    // post_id と url が bind に含まれる
    expect(calls[0].opts?.bind).toBeDefined()
    const bind = calls[0].opts?.bind ?? []
    expect(bind[0]).toBe(42) // post_id
    expect(bind[2]).toBe('https://example.com/article') // url
    expect(bind[3]).toBe('テスト記事') // title
    expect(bind[4]).toBe('テスト説明文') // description
  })

  it('card_type_id を type 文字列から解決する（link=1, photo=2, video=3, rich=4）', () => {
    const cases: { type: string; expectedId: number }[] = [
      { expectedId: 1, type: 'link' },
      { expectedId: 2, type: 'photo' },
      { expectedId: 3, type: 'video' },
      { expectedId: 4, type: 'rich' },
    ]

    for (const { type, expectedId } of cases) {
      const { db, calls } = createMockDb()

      syncLinkCard(db, 1, {
        type,
        url: 'https://example.com',
      })

      const bind = calls[0].opts?.bind ?? []
      expect(bind[1]).toBe(expectedId) // card_type_id
    }
  })

  it('type が未指定の場合は link(1) にフォールバックする', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 1, {
      url: 'https://example.com',
    })

    const bind = calls[0].opts?.bind ?? []
    expect(bind[1]).toBe(1) // card_type_id defaults to link
  })

  it('type が不明な文字列の場合は link(1) にフォールバックする', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 1, {
      type: 'unknown_type',
      url: 'https://example.com',
    })

    const bind = calls[0].opts?.bind ?? []
    expect(bind[1]).toBe(1) // card_type_id defaults to link
  })

  it('既存のカードがある場合は更新する', () => {
    const { db, calls } = createMockDb()

    // 1回目: 新規登録
    syncLinkCard(db, 10, {
      title: '初版',
      url: 'https://example.com/v1',
    })

    // 2回目: 同じ post_id で更新
    syncLinkCard(db, 10, {
      title: '改訂版',
      url: 'https://example.com/v2',
    })

    expect(calls).toHaveLength(2)

    // 両方とも UPSERT 文
    expect(calls[0].sql).toContain('ON CONFLICT(post_id) DO UPDATE')
    expect(calls[1].sql).toContain('ON CONFLICT(post_id) DO UPDATE')

    // 2回目のバインドには新しい値が入る
    const bind2 = calls[1].opts?.bind ?? []
    expect(bind2[0]).toBe(10) // post_id
    expect(bind2[2]).toBe('https://example.com/v2') // url
    expect(bind2[3]).toBe('改訂版') // title
  })

  it('card が null の場合、既存カードを削除する', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 99, null)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('DELETE FROM link_cards')
    expect(calls[0].sql).toContain('post_id')
    expect(calls[0].opts?.bind).toEqual([99])
  })

  it('card が undefined の場合、既存カードを削除する', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 77, undefined)

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('DELETE FROM link_cards')
    expect(calls[0].opts?.bind).toEqual([77])
  })

  it('全てのOGPフィールドが保存される', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 5, {
      author_name: '著者太郎',
      author_url: 'https://example.com/@author',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      description: '埋め込みコンテンツの説明',
      embed_url: 'https://example.com/embed/player',
      height: 480,
      html: '<iframe src="https://example.com/embed"></iframe>',
      image: 'https://example.com/thumb.jpg',
      provider_name: 'Example Provider',
      provider_url: 'https://example.com',
      title: 'リッチカード',
      type: 'rich',
      url: 'https://example.com/embed',
      width: 640,
    })

    expect(calls).toHaveLength(1)

    const sql = calls[0].sql
    // 全カラムが SQL に含まれる
    expect(sql).toContain('post_id')
    expect(sql).toContain('card_type_id')
    expect(sql).toContain('url')
    expect(sql).toContain('title')
    expect(sql).toContain('description')
    expect(sql).toContain('image')
    expect(sql).toContain('author_name')
    expect(sql).toContain('author_url')
    expect(sql).toContain('provider_name')
    expect(sql).toContain('provider_url')
    expect(sql).toContain('html')
    expect(sql).toContain('width')
    expect(sql).toContain('height')
    expect(sql).toContain('embed_url')
    expect(sql).toContain('blurhash')

    // 旧スキーマのカラムが使われていないこと
    expect(sql).not.toContain('canonical_url')
    expect(sql).not.toContain('image_url')
    expect(sql).not.toContain('fetched_at')
    expect(sql).not.toContain('link_card_id')
    expect(sql).not.toContain('post_links')

    const bind = calls[0].opts?.bind ?? []
    expect(bind).toEqual([
      5, // post_id
      4, // card_type_id (rich)
      'https://example.com/embed', // url
      'リッチカード', // title
      '埋め込みコンテンツの説明', // description
      'https://example.com/thumb.jpg', // image
      '著者太郎', // author_name
      'https://example.com/@author', // author_url
      'Example Provider', // provider_name
      'https://example.com', // provider_url
      '<iframe src="https://example.com/embed"></iframe>', // html
      640, // width
      480, // height
      'https://example.com/embed/player', // embed_url
      'LEHV6nWB2yk8pyo0adR*.7kCMdnj', // blurhash
    ])
  })

  it('省略可能なフィールドが未指定の場合は適切なデフォルト値が使われる', () => {
    const { db, calls } = createMockDb()

    syncLinkCard(db, 1, {
      url: 'https://example.com/minimal',
    })

    const bind = calls[0].opts?.bind ?? []
    expect(bind).toEqual([
      1, // post_id
      1, // card_type_id (default: link)
      'https://example.com/minimal', // url
      '', // title defaults to ''
      '', // description defaults to ''
      null, // image defaults to null
      null, // author_name defaults to null
      null, // author_url defaults to null
      null, // provider_name defaults to null
      null, // provider_url defaults to null
      null, // html defaults to null
      null, // width defaults to null
      null, // height defaults to null
      null, // embed_url defaults to null
      null, // blurhash defaults to null
    ])
  })
})
