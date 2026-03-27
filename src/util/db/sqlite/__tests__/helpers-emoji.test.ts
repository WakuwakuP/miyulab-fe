import { emojiIdCache } from 'util/db/sqlite/helpers/cache'
import {
  CUSTOM_EMOJI_RE,
  ensureCustomEmoji,
  resolveEmojisFromDb,
  syncPostCustomEmojis,
} from 'util/db/sqlite/helpers/emoji'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

// ─── ensureCustomEmoji ──────────────────────────────────────────

describe('ensureCustomEmoji', () => {
  beforeEach(() => {
    emojiIdCache.clear()
  })

  it('絵文字をDBに登録し、IDを返す', () => {
    const { db, calls } = createMockDb([[10]])

    const id = ensureCustomEmoji(db, 1, {
      shortcode: 'blobcat',
      static_url: 'https://example.com/emoji/blobcat_static.png',
      url: 'https://example.com/emoji/blobcat.png',
      visible_in_picker: true,
    })

    expect(id).toBe(10)
    // UPSERT + SELECT の 2 回
    expect(calls).toHaveLength(2)

    // 1回目: UPSERT
    expect(calls[0].sql).toContain('INSERT INTO custom_emojis')
    expect(calls[0].sql).toContain('ON CONFLICT')
    expect(calls[0].sql).toContain('url')
    expect(calls[0].sql).not.toContain('image_url')
    expect(calls[0].opts?.bind).toEqual([
      1,
      'blobcat',
      'https://example.com/emoji/blobcat.png',
      'https://example.com/emoji/blobcat_static.png',
      1,
    ])

    // 2回目: SELECT id
    expect(calls[1].sql).toContain('SELECT id FROM custom_emojis')
    expect(calls[1].sql).not.toContain('emoji_id')
    expect(calls[1].opts?.bind).toEqual([1, 'blobcat'])
    expect(calls[1].opts?.returnValue).toBe('resultRows')

    // キャッシュにも保存されている
    expect(emojiIdCache.get('1:blobcat')).toBe(10)
  })

  it('既存の絵文字はUPDATEし、IDを返す', () => {
    const { db, calls } = createMockDb([[5]])

    // 1回目: 新規登録
    const id1 = ensureCustomEmoji(db, 2, {
      shortcode: 'thinking',
      url: 'https://example.com/emoji/thinking_v1.png',
    })
    expect(id1).toBe(5)

    // キャッシュクリアして再度呼ぶ（URL が変わったケース）
    emojiIdCache.clear()

    const id2 = ensureCustomEmoji(db, 2, {
      shortcode: 'thinking',
      url: 'https://example.com/emoji/thinking_v2.png',
    })
    expect(id2).toBe(5)

    // 2回とも UPSERT + SELECT が実行される
    expect(calls).toHaveLength(4)

    // 2回目の UPSERT で新しい URL が使われる
    expect(calls[2].opts?.bind?.[2]).toBe(
      'https://example.com/emoji/thinking_v2.png',
    )
  })

  it('キャッシュヒット時はDBアクセスをスキップする', () => {
    const { db, calls } = createMockDb([[42]])

    // 1回目: DB にアクセスしてキャッシュに保存
    const id1 = ensureCustomEmoji(db, 3, {
      shortcode: 'smile',
      url: 'https://example.com/emoji/smile.png',
    })
    expect(id1).toBe(42)
    // UPSERT + SELECT
    expect(calls).toHaveLength(2)

    // 2回目: UPSERT は実行されるが SELECT はスキップ
    const id2 = ensureCustomEmoji(db, 3, {
      shortcode: 'smile',
      url: 'https://example.com/emoji/smile.png',
    })
    expect(id2).toBe(42)
    // UPSERT のみ追加（SELECT はキャッシュから）
    expect(calls).toHaveLength(3)
    expect(calls[2].sql).toContain('INSERT INTO custom_emojis')
  })
})

// ─── syncPostCustomEmojis ───────────────────────────────────────

describe('syncPostCustomEmojis', () => {
  beforeEach(() => {
    emojiIdCache.clear()
  })

  it('投稿に関連する絵文字を同期する', () => {
    // ensureCustomEmoji の SELECT で返す ID
    let selectCallCount = 0
    const selectResults = [[100], [200]]
    const calls: {
      sql: string
      opts?: Parameters<DbExecCompat['exec']>[1]
    }[] = []

    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        if (opts?.returnValue === 'resultRows') {
          return [selectResults[selectCallCount++] ?? [0]]
        }
        return undefined
      }),
    }

    syncPostCustomEmojis(db, 1, 10, [
      { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
      { shortcode: 'blobfox', url: 'https://example.com/blobfox.png' },
    ])

    // INSERT OR IGNORE INTO post_custom_emojis が呼ばれる
    const insertPostEmojiCalls = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('post_custom_emojis'),
    )
    expect(insertPostEmojiCalls.length).toBe(2)

    // custom_emoji_id カラムを使っている（旧 emoji_id ではない）
    for (const call of insertPostEmojiCalls) {
      expect(call.sql).toContain('custom_emoji_id')
      expect(call.sql).not.toContain('usage_context')
    }

    // DELETE で不要なリンクを掃除
    const deleteCalls = calls.filter(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_custom_emojis'),
    )
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1)

    // usage_context は使われない
    const allSql = calls.map((c) => c.sql).join('\n')
    expect(allSql).not.toContain('usage_context')
  })

  it('不要になった絵文字のリンクを削除する', () => {
    let selectCallCount = 0
    const selectResults = [[100]]
    const calls: {
      sql: string
      opts?: Parameters<DbExecCompat['exec']>[1]
    }[] = []

    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        if (opts?.returnValue === 'resultRows') {
          return [selectResults[selectCallCount++] ?? [0]]
        }
        return undefined
      }),
    }

    // 絵文字1つだけを同期 → 以前あった他の絵文字は削除される
    syncPostCustomEmojis(db, 1, 10, [
      { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
    ])

    // DELETE 文で custom_emoji_id NOT IN を使って不要なリンクを削除
    const deleteCalls = calls.filter(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_custom_emojis'),
    )
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0].sql).toContain('custom_emoji_id NOT IN')
    expect(deleteCalls[0].opts?.bind).toContain(1) // post_id
    expect(deleteCalls[0].opts?.bind).toContain(100) // kept emoji id
  })

  it('空の絵文字リストの場合、全リンクを削除する', () => {
    const { db, calls } = createMockDb()

    syncPostCustomEmojis(db, 1, 10, [])

    // 空リストなので INSERT は呼ばれない
    const insertCalls = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('post_custom_emojis'),
    )
    expect(insertCalls).toHaveLength(0)

    // DELETE FROM post_custom_emojis WHERE post_id = ?
    const deleteCalls = calls.filter(
      (c) => c.sql.includes('DELETE') && c.sql.includes('post_custom_emojis'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].opts?.bind).toEqual([1])
  })
})

// ─── resolveEmojisFromDb ────────────────────────────────────────

describe('resolveEmojisFromDb', () => {
  it('テキスト中の :shortcode: パターンからDB検索する', () => {
    const { db, calls } = createMockDb([
      [
        'https://example.com/emoji/blobcat.png',
        'https://example.com/emoji/blobcat_static.png',
        1,
      ],
    ])

    const result = resolveEmojisFromDb(
      db,
      1,
      'Hello :blobcat: world!',
      'https://example.com',
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      shortcode: 'blobcat',
      static_url: 'https://example.com/emoji/blobcat_static.png',
      url: 'https://example.com/emoji/blobcat.png',
      visible_in_picker: true,
    })

    // SELECT 文で url カラムを使う（旧 image_url ではない）
    expect(calls[0].sql).toContain('url')
    expect(calls[0].sql).not.toContain('image_url')
    expect(calls[0].opts?.returnValue).toBe('resultRows')
  })

  it('DBにヒットしない場合はMisskey URLパターンでフォールバックする', () => {
    const { db } = createMockDb([])

    const result = resolveEmojisFromDb(
      db,
      1,
      'Hello :unknown_emoji: world!',
      'https://misskey.example.com',
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      shortcode: 'unknown_emoji',
      static_url: 'https://misskey.example.com/emoji/unknown_emoji.webp',
      url: 'https://misskey.example.com/emoji/unknown_emoji.webp',
      visible_in_picker: true,
    })
  })

  it('テキストが null/undefined/空文字の場合は空配列を返す', () => {
    const { db } = createMockDb()

    expect(resolveEmojisFromDb(db, 1, null, 'https://example.com')).toEqual([])
    expect(
      resolveEmojisFromDb(db, 1, undefined, 'https://example.com'),
    ).toEqual([])
    expect(resolveEmojisFromDb(db, 1, '', 'https://example.com')).toEqual([])
  })

  it('重複する shortcode は1回だけ検索する', () => {
    const { db, calls } = createMockDb([
      ['https://example.com/emoji/cat.png', null, 1],
    ])

    const result = resolveEmojisFromDb(
      db,
      1,
      ':cat: and :cat: again',
      'https://example.com',
    )

    // 重複排除されて1回だけ
    expect(result).toHaveLength(1)
    const selectCalls = calls.filter(
      (c) => c.opts?.returnValue === 'resultRows',
    )
    expect(selectCalls).toHaveLength(1)
  })
})

// ─── CUSTOM_EMOJI_RE ────────────────────────────────────────────

describe('CUSTOM_EMOJI_RE', () => {
  it('カスタム絵文字のショートコードパターンにマッチする', () => {
    const text = ':blobcat: hello :thinking_face: :emoji123:'
    const matches = [...text.matchAll(CUSTOM_EMOJI_RE)]

    expect(matches).toHaveLength(3)
    expect(matches[0][1]).toBe('blobcat')
    expect(matches[1][1]).toBe('thinking_face')
    expect(matches[2][1]).toBe('emoji123')
  })

  it(':shortcode@host: パターンにもマッチする', () => {
    const text = ':blobcat@misskey.io: hello'
    const matches = [...text.matchAll(CUSTOM_EMOJI_RE)]

    expect(matches).toHaveLength(1)
    expect(matches[0][1]).toBe('blobcat')
  })

  it('通常のテキストにはマッチしない', () => {
    const text = 'hello world no emojis here'
    const matches = [...text.matchAll(CUSTOM_EMOJI_RE)]

    expect(matches).toHaveLength(0)
  })
})
