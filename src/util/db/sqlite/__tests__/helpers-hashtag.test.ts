import { syncPostHashtags } from 'util/db/sqlite/helpers/hashtag'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録し、SELECT 時に指定の結果を返す。
 */
function createMockDb(selectResults?: unknown[][]): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  let selectCallCount = 0
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        return selectResults ? [selectResults[selectCallCount++] ?? [0]] : []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── syncPostHashtags ───────────────────────────────────────────

describe('syncPostHashtags', () => {
  it('ハッシュタグをDBに登録し、投稿と関連付ける', () => {
    const { db, calls } = createMockDb([[1], [2]])

    syncPostHashtags(db, 10, [{ name: 'Vitest' }, { name: 'TypeScript' }])

    // 各タグに対して UPSERT + SELECT + INSERT OR IGNORE の3回 = 6回
    // + 末尾の DELETE で合計7回
    expect(calls).toHaveLength(7)

    // 1つ目のタグ: UPSERT
    expect(calls[0].sql).toContain('INSERT INTO hashtags')
    expect(calls[0].sql).toContain('name')
    expect(calls[0].sql).toContain('url')
    expect(calls[0].sql).toContain('ON CONFLICT(name)')
    expect(calls[0].opts?.bind).toEqual(['vitest', null])

    // 1つ目のタグ: SELECT id
    expect(calls[1].sql).toContain('SELECT id FROM hashtags')
    expect(calls[1].sql).toContain('name')
    expect(calls[1].opts?.bind).toEqual(['vitest'])
    expect(calls[1].opts?.returnValue).toBe('resultRows')

    // 1つ目のタグ: post_hashtags にリンク
    expect(calls[2].sql).toContain('INSERT OR IGNORE INTO post_hashtags')
    expect(calls[2].sql).toContain('post_id')
    expect(calls[2].sql).toContain('hashtag_id')
    expect(calls[2].opts?.bind).toEqual([10, 1])

    // 2つ目のタグ: UPSERT
    expect(calls[3].opts?.bind).toEqual(['typescript', null])

    // 2つ目のタグ: SELECT id
    expect(calls[4].opts?.bind).toEqual(['typescript'])

    // 2つ目のタグ: post_hashtags にリンク
    expect(calls[5].opts?.bind).toEqual([10, 2])

    // 不要なリンクの削除
    expect(calls[6].sql).toContain('DELETE FROM post_hashtags')
    expect(calls[6].sql).toContain('hashtag_id NOT IN')
    expect(calls[6].opts?.bind).toEqual([10, 1, 2])

    // 旧スキーマのカラムが使われていないこと
    const allSql = calls.map((c) => c.sql).join('\n')
    expect(allSql).not.toContain('normalized_name')
    expect(allSql).not.toContain('display_name')
    expect(allSql).not.toContain('sort_order')
    // hashtags テーブルの旧 PK 名 (SELECT hashtag_id FROM hashtags) が使われていないこと
    // ※ post_hashtags.hashtag_id は新スキーマでも有効なカラム
    expect(allSql).not.toMatch(/FROM hashtags.*hashtag_id/)
    expect(allSql).not.toMatch(/SELECT hashtag_id/)
  })

  it('既存のハッシュタグは再利用する（INSERT OR IGNORE）', () => {
    // 同じ ID が返される = 既存タグを再利用
    const { db, calls } = createMockDb([[42], [42]])

    syncPostHashtags(db, 1, [
      { name: 'rust' },
      { name: 'Rust' }, // 大文字違いで同じ正規化名
    ])

    // UPSERT は ON CONFLICT(name) DO UPDATE を使う
    const upsertCalls = calls.filter(
      (c) =>
        c.sql.includes('INSERT INTO hashtags') && c.sql.includes('ON CONFLICT'),
    )
    expect(upsertCalls.length).toBe(2)
    // 両方とも正規化された 'rust' で INSERT される
    expect(upsertCalls[0].opts?.bind?.[0]).toBe('rust')
    expect(upsertCalls[1].opts?.bind?.[0]).toBe('rust')

    // post_hashtags への INSERT OR IGNORE
    const linkCalls = calls.filter((c) =>
      c.sql.includes('INSERT OR IGNORE INTO post_hashtags'),
    )
    expect(linkCalls.length).toBe(2)
    // 同じ hashtag_id が使われる
    expect(linkCalls[0].opts?.bind).toEqual([1, 42])
    expect(linkCalls[1].opts?.bind).toEqual([1, 42])
  })

  it('不要になったハッシュタグリンクを削除する', () => {
    const { db, calls } = createMockDb([[100]])

    // タグ1つだけ同期 → 以前あった他のタグリンクは削除される
    syncPostHashtags(db, 5, [{ name: 'keep' }])

    const deleteCalls = calls.filter(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_hashtags'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].sql).toContain('hashtag_id NOT IN')
    expect(deleteCalls[0].opts?.bind).toEqual([5, 100])
  })

  it('空のタグリストの場合、全リンクを削除する', () => {
    const { db, calls } = createMockDb()

    syncPostHashtags(db, 7, [])

    // INSERT 系は呼ばれない
    const insertCalls = calls.filter((c) => c.sql.includes('INSERT'))
    expect(insertCalls).toHaveLength(0)

    // DELETE FROM post_hashtags WHERE post_id = ?
    const deleteCalls = calls.filter(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_hashtags'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].sql).not.toContain('NOT IN')
    expect(deleteCalls[0].opts?.bind).toEqual([7])
  })

  it('ハッシュタグ名を小文字に正規化する', () => {
    const { db, calls } = createMockDb([[1]])

    syncPostHashtags(db, 1, [{ name: 'CamelCase' }])

    // UPSERT の bind に小文字化された名前が渡される
    const upsertCall = calls.find((c) => c.sql.includes('INSERT INTO hashtags'))
    expect(upsertCall?.opts?.bind?.[0]).toBe('camelcase')

    // SELECT の bind にも小文字化された名前が渡される
    const selectCall = calls.find((c) => c.opts?.returnValue === 'resultRows')
    expect(selectCall?.opts?.bind?.[0]).toBe('camelcase')
  })

  it('URLがあればDBに保存する', () => {
    const { db, calls } = createMockDb([[1], [2]])

    syncPostHashtags(db, 1, [
      { name: 'mastodon', url: 'https://example.com/tags/mastodon' },
      { name: 'fediverse' },
    ])

    // 1つ目: URL あり
    const firstUpsert = calls[0]
    expect(firstUpsert.sql).toContain('INSERT INTO hashtags')
    expect(firstUpsert.opts?.bind).toEqual([
      'mastodon',
      'https://example.com/tags/mastodon',
    ])

    // 2つ目: URL なし → null
    const secondUpsert = calls[3]
    expect(secondUpsert.sql).toContain('INSERT INTO hashtags')
    expect(secondUpsert.opts?.bind).toEqual(['fediverse', null])

    // UPSERT で COALESCE を使い、既存の url を保持する
    expect(firstUpsert.sql).toContain('COALESCE')
  })
})
