import type { TimelineConfigV2 } from 'types/types'
import { buildFilterConditions } from 'util/db/sqlite/queries/statusFilter'
import { describe, expect, it } from 'vitest'

function makeConfig(
  overrides: Partial<TimelineConfigV2> = {},
): TimelineConfigV2 {
  return {
    applyInstanceBlock: false,
    applyMuteFilter: false,
    id: 'branch-test',
    order: 0,
    type: 'home',
    visible: true,
    ...overrides,
  }
}

describe('buildFilterConditions boundaries', () => {
  it('フィルターが無効なら条件も bind も追加しない', () => {
    expect(buildFilterConditions(makeConfig(), [])).toEqual({
      binds: [],
      conditions: [],
    })
  })

  it('minMediaCount=0 は最小枚数条件にせず onlyMedia を適用する', () => {
    const result = buildFilterConditions(
      makeConfig({ minMediaCount: 0, onlyMedia: true }),
      [],
    )

    expect(result.conditions).toEqual([
      'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
    ])
    expect(result.binds).toEqual([])
  })

  it('visibilityFilter は 1〜3 件だけ適用し、4 件なら絞り込まない', () => {
    const three = buildFilterConditions(
      makeConfig({
        visibilityFilter: ['public', 'unlisted', 'private'],
      }),
      [],
    )
    const four = buildFilterConditions(
      makeConfig({
        visibilityFilter: ['public', 'unlisted', 'private', 'direct'],
      }),
      [],
    )

    expect(three.conditions).toEqual([
      '(SELECT name FROM visibility_types WHERE id = p.visibility_id) IN (?,?,?)',
    ])
    expect(three.binds).toEqual(['public', 'unlisted', 'private'])
    expect(four).toEqual({ binds: [], conditions: [] })
  })

  it('visibilityFilter と languageFilter の空配列は条件を追加しない', () => {
    expect(
      buildFilterConditions(
        makeConfig({ languageFilter: [], visibilityFilter: [] }),
        [],
      ),
    ).toEqual({ binds: [], conditions: [] })
  })

  it('languageFilter は NULL 言語を残し、指定順に bind する', () => {
    const result = buildFilterConditions(
      makeConfig({ languageFilter: ['ja', 'en'] }),
      [],
      'post',
    )

    expect(result.conditions).toEqual([
      '(post.language IN (?,?) OR post.language IS NULL)',
    ])
    expect(result.binds).toEqual(['ja', 'en'])
  })

  it('投稿除外オプションをすべて独立した条件にする', () => {
    const result = buildFilterConditions(
      makeConfig({
        excludeReblogs: true,
        excludeReplies: true,
        excludeSensitive: true,
        excludeSpoiler: true,
      }),
      [],
      'x',
    )

    expect(result.conditions).toEqual([
      'x.is_reblog = 0',
      'x.in_reply_to_uri IS NULL',
      "x.spoiler_text = ''",
      'x.is_sensitive = 0',
    ])
  })

  it('空のアカウント一覧は include/exclude 条件を追加しない', () => {
    const result = buildFilterConditions(
      makeConfig({
        accountFilter: { accts: [], mode: 'include' },
        applyMuteFilter: true,
      }),
      [],
    )

    // include モードではアカウント一覧が空でも mute 条件を意図的に抑止する。
    expect(result).toEqual({ binds: [], conditions: [] })
  })

  it('未指定の mute/block 設定は有効として扱う', () => {
    const config = makeConfig()
    config.applyMuteFilter = undefined
    config.applyInstanceBlock = undefined

    const result = buildFilterConditions(config, [])

    expect(result.conditions[0]).toBe('1=1')
    expect(result.conditions[1]).toContain('blocked_instances')
    expect(result.conditions[1]).toContain('p.author_profile_id')
    expect(result.binds).toEqual([])
  })

  it('JOIN 済み profile を使う mute/block 条件とホスト bind を生成する', () => {
    const result = buildFilterConditions(
      makeConfig({
        applyInstanceBlock: true,
        applyMuteFilter: true,
      }),
      ['https://social.example/path', 'https://remote.example'],
      'post',
      { profileJoined: true },
    )

    expect(result.conditions).toHaveLength(2)
    expect(result.conditions[0]).toContain('pr.acct')
    expect(result.conditions[0]).toContain('muted_accounts')
    expect(result.conditions[1]).toContain(
      "substr(pr.acct, instr(pr.acct, '@') + 1)",
    )
    expect(result.binds).toEqual(['social.example', 'remote.example'])
  })

  it('include アカウント指定時は mute だけを抑止する', () => {
    const result = buildFilterConditions(
      makeConfig({
        accountFilter: {
          accts: ['alice@example.com'],
          mode: 'include',
        },
        applyInstanceBlock: true,
        applyMuteFilter: true,
      }),
      ['https://example.com'],
    )

    expect(result.conditions).toHaveLength(2)
    expect(result.conditions[0]).toContain(' IN (?)')
    expect(result.conditions[1]).toContain('blocked_instances')
    expect(result.conditions.join(' ')).not.toContain('muted_accounts')
    expect(result.binds).toEqual(['alice@example.com'])
  })

  it('空 tableAlias ではカラムにドット接頭辞を付けない', () => {
    const result = buildFilterConditions(
      makeConfig({
        accountFilter: { accts: ['alice@example.com'], mode: 'exclude' },
        excludeReblogs: true,
        languageFilter: ['ja'],
        onlyMedia: true,
      }),
      [],
      '',
    )

    expect(result.conditions).toEqual([
      'EXISTS(SELECT 1 FROM post_media WHERE post_id = id)',
      '(language IN (?) OR language IS NULL)',
      'is_reblog = 0',
      '(SELECT acct FROM profiles WHERE id = author_profile_id) NOT IN (?)',
    ])
    expect(result.binds).toEqual(['ja', 'alice@example.com'])
  })
})
