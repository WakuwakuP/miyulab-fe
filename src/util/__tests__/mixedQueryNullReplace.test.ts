/**
 * 混合クエリの Status Phase1 で通知系エイリアス (n/nt/ap) を NULL 置換する
 * ロジックのリグレッションテスト。
 *
 * 空中リプ（ふぁぼ・リアクション・ブースト通知 + 通知元ユーザーの直後投稿）
 * クエリが正しく動作するためには:
 * - 外部の n.xxx / nt.xxx / ap.xxx を NULL に置換
 * - サブクエリ内の ntt.xxx / ntf.xxx / pra.xxx はそのまま保持
 */
import { QUERY_COMPLETIONS } from 'util/db/sqlite/queries/statusCustomQuery'
import { describe, expect, it } from 'vitest'

/**
 * useCustomQueryTimeline.ts の Status Phase1 で使用する NULL 置換ロジック。
 * 実際のコードから抜粋したパターンと同一。
 */
const NOTIF_ALIAS_PATTERN = /\b(n|nt|ap)\.\w+\b/g

function replaceNotifAliasesWithNull(where: string): string {
  return where.replace(NOTIF_ALIAS_PATTERN, 'NULL')
}

describe('混合クエリの通知系エイリアス NULL 置換', () => {
  it('nt.name を NULL に置換する', () => {
    const result = replaceNotifAliasesWithNull(
      "nt.name IN ('favourite', 'reblog')",
    )
    expect(result).toBe("NULL IN ('favourite', 'reblog')")
  })

  it('n.created_at_ms を NULL に置換する', () => {
    const result = replaceNotifAliasesWithNull('n.created_at_ms > 1000')
    expect(result).toBe('NULL > 1000')
  })

  it('ap.acct を NULL に置換する', () => {
    const result = replaceNotifAliasesWithNull("ap.acct = 'user@example.com'")
    expect(result).toBe("NULL = 'user@example.com'")
  })

  it('サブクエリ内の ntt.name はそのまま保持する', () => {
    const input =
      "EXISTS (SELECT 1 FROM notification_types ntt WHERE ntt.name = 'favourite')"
    const result = replaceNotifAliasesWithNull(input)
    expect(result).toContain("ntt.name = 'favourite'")
  })

  it('サブクエリ内の ntf.actor_profile_id はそのまま保持する', () => {
    const input =
      'EXISTS (SELECT 1 FROM notifications ntf WHERE ntf.actor_profile_id = 1)'
    const result = replaceNotifAliasesWithNull(input)
    expect(result).toContain('ntf.actor_profile_id = 1')
  })

  it('サブクエリ内の pra.acct はそのまま保持する', () => {
    const input = "EXISTS (SELECT 1 FROM profiles pra WHERE pra.acct = 'test')"
    const result = replaceNotifAliasesWithNull(input)
    expect(result).toContain("pra.acct = 'test'")
  })

  it('空中リプクエリの外部 nt.name を NULL に、内部 ntt/ntf/pra はそのまま保持する', () => {
    const kuuchuuQuery = QUERY_COMPLETIONS.examples.find((e) =>
      e.description.includes('通知元ユーザーの直後の1投稿'),
    )?.query
    expect(kuuchuuQuery).toBeDefined()
    if (!kuuchuuQuery) return

    const result = replaceNotifAliasesWithNull(kuuchuuQuery)

    // 外部の nt.name → NULL
    expect(result).toContain(
      "NULL IN ('favourite', 'emoji_reaction', 'reblog')",
    )
    // サブクエリ内の ntt.name はそのまま
    expect(result).toContain('ntt.name')
    expect(result).toContain('ntt.id')
    // サブクエリ内の ntf.* はそのまま
    expect(result).toContain('ntf.notification_type_id')
    expect(result).toContain('ntf.actor_profile_id')
    expect(result).toContain('ntf.created_at_ms')
    // サブクエリ内の pra.acct はそのまま
    expect(result).toContain('pra.acct')
    // p.* はそのまま（status 側で利用可能）
    expect(result).toContain('p.author_profile_id')
    expect(result).toContain('p.created_at_ms')
  })
})
