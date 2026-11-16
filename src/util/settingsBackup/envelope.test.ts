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
