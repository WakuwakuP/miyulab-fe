import { describe, expect, it } from 'vitest'
import { SETTINGS_BACKUP_MAX_BYTES } from './constants'
import {
  buildSettingsEnvelope,
  stableStringify,
  utf8ByteLength,
  validateSettingsEnvelope,
} from './envelope'

const EXPORTED_AT = '2026-11-16T05:00:00.000Z'

function timeline(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    order: 0,
    type: 'home',
    visible: true,
    ...extra,
  }
}

function envelope(payload: Record<string, unknown>, exportedAt = EXPORTED_AT) {
  return {
    exportedAt,
    format: 'miyulab-settings-backup',
    formatVersion: 1,
    payload,
  }
}

describe('validateSettingsEnvelope', () => {
  it('タイムラインと未知フィールドを残し、トークンと通常モードの customQuery を落とす', () => {
    const result = validateSettingsEnvelope(
      envelope({
        apps: { tokenData: { access_token: 'secret' } },
        timelineSettings: {
          timelines: [
            timeline('home', {
              customQuery: 'p.id = 1',
              futureFlag: true,
              label: 'Home',
            }),
            timeline('adv', {
              advancedQuery: true,
              customQuery: 'p.id = 2',
              queryPlan: { access_token: 'secret', nodes: [] },
            }),
          ],
          version: 2,
        },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const timelines = result.envelope.payload.timelineSettings?.timelines
    expect(timelines?.[0]).toMatchObject({ futureFlag: true, id: 'home' })
    expect(timelines?.[0]).not.toHaveProperty('customQuery')
    expect(timelines?.[1]).toMatchObject({ customQuery: 'p.id = 2' })
    expect(JSON.stringify(result.envelope)).not.toContain('secret')
    expect(JSON.stringify(result.envelope)).not.toContain('tokenData')
    expect(result.envelope.payload).not.toHaveProperty('apps')
  })

  it('captureRawData は false になる', () => {
    const result = validateSettingsEnvelope(
      envelope({
        setting: { captureRawData: true, showSensitive: false },
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope.payload.setting).toMatchObject({
      captureRawData: false,
      showSensitive: false,
    })
  })

  it('空の timelines は有効', () => {
    const result = validateSettingsEnvelope(
      envelope({ timelineSettings: { timelines: [], version: 2 } }),
    )
    expect(result.ok).toBe(true)
  })

  it('形式違い、未知の版、重複 id は拒否する', () => {
    expect(
      validateSettingsEnvelope({ ...envelope({}), format: 'miyulab-raw' }),
    ).toMatchObject({ success: false })
    expect(
      validateSettingsEnvelope({ ...envelope({}), formatVersion: 2 }),
    ).toMatchObject({ success: false })
    expect(
      validateSettingsEnvelope(
        envelope({
          timelineSettings: {
            timelines: [timeline('same'), timeline('same')],
            version: 2,
          },
        }),
      ),
    ).toMatchObject({ success: false })
  })

  it('2MiB を超える入力は拒否する', () => {
    const result = validateSettingsEnvelope(
      envelope({
        timelineSettings: {
          timelines: [
            timeline('home', { note: 'x'.repeat(SETTINGS_BACKUP_MAX_BYTES) }),
          ],
          version: 2,
        },
      }),
    )
    expect(result.ok).toBe(false)
    expect(
      utf8ByteLength(stableStringify({ note: 'x'.repeat(10) })),
    ).toBeGreaterThan(10)
  })
})

describe('buildSettingsEnvelope', () => {
  it('対象キーだけを読み、無いキーは省略する', () => {
    const seen: string[] = []
    const result = buildSettingsEnvelope((key) => {
      seen.push(key)
      if (key === 'playerSetting') return JSON.stringify({ volume: 0.5 })
      return null
    }, EXPORTED_AT)
    expect(seen).toEqual([
      'timelineSettings',
      'setting',
      'playerSetting',
      'hashtagHistory',
      'users',
      'tags',
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope.payload).toEqual({
      playerSetting: { volume: 0.5 },
    })
  })

  it('上限を超えたキャッシュは切り詰め、壊れたキャッシュは省く', () => {
    const users = Array.from({ length: 2_001 }, (_, index) => ({
      acct: `user-${index}`,
      avatar: 'https://cdn.example/a.png',
      display_name: 'User',
      id: String(index),
    }))
    const result = buildSettingsEnvelope((key) => {
      if (key === 'timelineSettings') {
        return JSON.stringify({
          timelines: [timeline('home')],
          version: 2,
        })
      }
      if (key === 'users') return JSON.stringify(users)
      if (key === 'hashtagHistory') return JSON.stringify([{ tag: 1 }])
      if (key === 'tags') return '{not-json'
      return null
    }, EXPORTED_AT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.envelope.payload.users).toHaveLength(2_000)
    expect(result.envelope.payload.timelineSettings?.timelines).toHaveLength(1)
    expect(result.envelope.payload).not.toHaveProperty('hashtagHistory')
    expect(result.envelope.payload).not.toHaveProperty('tags')
  })

  it('壊れた JSON では失敗する', () => {
    const result = buildSettingsEnvelope((key) => {
      return key === 'timelineSettings' ? '{not-json' : null
    }, EXPORTED_AT)
    expect(result.ok).toBe(false)
  })
})

describe('タイムラインのインポート', () => {
  function importTimeline(fields: Record<string, unknown>) {
    return validateSettingsEnvelope(
      envelope({
        timelineSettings: { timelines: [timeline('feed', fields)], version: 2 },
      }),
    )
  }

  it.each([
    { mode: 'all' },
    { backendUrl: 'https://example.org', mode: 'single' },
    {
      backendUrls: ['https://a.example', 'https://b.example'],
      mode: 'composite',
    },
  ])('有効なフィルターを保持する ($mode)', (backendFilter) => {
    const fields = {
      accountFilter: { accts: ['alice'], mode: 'include' },
      backendFilter,
      languageFilter: ['ja'],
      minMediaCount: 0,
      notificationFilter: ['mention'],
      onlyMedia: false,
      tabGroup: 'group',
      tagConfig: { mode: 'or', tags: ['cats'] },
      timelineTypes: ['home'],
      visibilityFilter: ['public'],
    }
    expect(importTimeline(fields)).toMatchObject({
      envelope: { payload: { timelineSettings: { timelines: [fields] } } },
      ok: true,
    })
  })

  it.each<[string, unknown]>([
    ['id', ''],
    ['id', 1],
    ['type', 2],
    ['type', 'unknown'],
    ['visible', 1],
    ['order', '1'],
    ['order', Infinity],
    ['label', 1],
    ['tabGroup', false],
    ['customQuery', 'x'.repeat(100001)],
    ['minMediaCount', '1'],
    ['minMediaCount', 0.5],
    ['minMediaCount', -1],
    ['minMediaCount', 101],
    ['onlyMedia', 1],
    ['backendFilter', []],
    ['backendFilter', {}],
    ['backendFilter', { mode: 'unknown' }],
    ['backendFilter', { mode: 'single' }],
    ['backendFilter', { backendUrl: '', mode: 'single' }],
    ['backendFilter', { backendUrls: [], mode: 'composite' }],
    ['backendFilter', { mode: 'composite' }],
    ['tagConfig', []],
    ['tagConfig', { mode: 'none' }],
    ['tagConfig', { mode: 'and', tags: [1] }],
    ['accountFilter', []],
    ['accountFilter', { mode: 'none' }],
    ['accountFilter', { accts: [1], mode: 'exclude' }],
    ['queryPlan', []],
    ['queryPlan', { note: 'x'.repeat(500000) }],
    ['visibilityFilter', 'public'],
    ['visibilityFilter', Array(9).fill('public')],
    ['notificationFilter', [1]],
    ['timelineTypes', ['tag']],
    ['languageFilter', Array(101).fill('ja')],
    ['languageFilter', ['x'.repeat(36)]],
  ])('不正な %s を拒否する (%#)', (key, value) => {
    expect(importTimeline({ [key]: value }).ok).toBe(false)
  })
})

describe('設定バックアップの入力検証', () => {
  it.each<[string, unknown]>([
    ['timelineSettings', []],
    ['timelineSettings', { version: 1 }],
    ['timelineSettings', { version: 2 }],
    ['timelineSettings', { timelines: [null], version: 2 }],
    [
      'timelineSettings',
      {
        timelines: Array.from({ length: 101 }, (_, i) => timeline(String(i))),
        version: 2,
      },
    ],
    ['setting', []],
    ['setting', { backgroundPublicStreaming: 1 }],
    ['setting', { showSensitive: 1 }],
    ['setting', { playerSize: 1 }],
    ['setting', { playerSize: 'huge' }],
    ['setting', { defaultStatusVisibility: 1 }],
    ['setting', { defaultStatusVisibility: 'unknown' }],
    ['setting', { recentHashtagsCount: 51 }],
    ['setting', { reactionEmojis: [false] }],
    ['setting', { captureRawData: 1 }],
    ['playerSetting', []],
    ['playerSetting', { volume: '1' }],
    ['playerSetting', { volume: NaN }],
    ['playerSetting', { volume: -0.1 }],
    ['playerSetting', { volume: 1.1 }],
    ['hashtagHistory', {}],
    ['hashtagHistory', Array(501).fill({})],
    ['hashtagHistory', [null]],
    ['hashtagHistory', [{ tag: 1 }]],
    ['hashtagHistory', [{ isPinned: 0, tag: 'cats' }]],
    ['hashtagHistory', [{ isPinned: true, tag: 'cats' }]],
    [
      'hashtagHistory',
      [{ isPinned: true, lastAccessed: Infinity, tag: 'cats' }],
    ],
    ['users', {}],
    ['users', Array(2001).fill({})],
    ['users', [null]],
    ['users', [{ id: 1 }]],
    ['users', [{ id: '1' }]],
    ['tags', [1]],
  ])('不正な %s を含むバックアップを拒否する (%#)', (key, value) => {
    expect(validateSettingsEnvelope(envelope({ [key]: value })).ok).toBe(false)
  })

  it('有効な設定とキャッシュを復元する', () => {
    const payload = {
      hashtagHistory: [{ isPinned: true, lastAccessed: 0, tag: 'cats' }],
      playerSetting: { volume: 0 },
      setting: {
        backgroundPublicStreaming: false,
        captureRawData: false,
        defaultStatusVisibility: 'private',
        playerSize: 'small',
        reactionEmojis: ['🌸'],
        recentHashtagsCount: 50,
      },
      tags: ['cats'],
    }
    expect(validateSettingsEnvelope(envelope(payload))).toEqual({
      envelope: envelope(payload),
      ok: true,
    })
  })

  it('復元できないデータや過度に深い構造を拒否する', () => {
    let nested: unknown = []
    for (let level = 0; level < 33; level++) nested = [nested]
    for (const input of [
      null,
      () => {},
      envelope({ setting: { nested } }),
      { ...envelope({}), payload: null },
      envelope({}, 'yesterday'),
    ]) {
      expect(validateSettingsEnvelope(input).ok).toBe(false)
    }
  })
})

describe('エクスポート時のキャッシュ整形', () => {
  it.each(['users', 'tags', 'hashtagHistory'])(
    '%s の不正な形式と空配列を区別する',
    (key) => {
      for (const [stored, expected] of [
        [{}, {}],
        [[null], {}],
        [[], { [key]: [] }],
      ] as const) {
        expect(
          buildSettingsEnvelope(
            (k) => (k === key ? JSON.stringify(stored) : null),
            EXPORTED_AT,
          ),
        ).toEqual({ envelope: envelope(expected), ok: true })
      }
    },
  )

  it('無効な項目だけを除外し、履歴は先頭の有効な500件を保存する', () => {
    const user = { acct: 'alice', avatar: '', display_name: 'Alice', id: '1' }
    const history = Array.from({ length: 501 }, (_, lastAccessed) => ({
      isPinned: false,
      lastAccessed,
      tag: String(lastAccessed),
    }))
    const storage: Record<string, unknown> = {
      hashtagHistory: [
        null,
        { isPinned: 1, tag: 'x' },
        { isPinned: true, tag: 'x' },
        ...history,
      ],
      tags: [null, 'cats'],
      users: [null, { id: 1 }, { id: '1' }, user],
    }
    expect(
      buildSettingsEnvelope(
        (key) => JSON.stringify(storage[key]) ?? null,
        EXPORTED_AT,
      ),
    ).toEqual({
      envelope: envelope({
        hashtagHistory: history.slice(0, 500),
        tags: ['cats'],
        users: [user],
      }),
      ok: true,
    })
  })
})
