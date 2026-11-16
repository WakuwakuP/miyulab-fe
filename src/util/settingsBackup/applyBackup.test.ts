import { describe, expect, it } from 'vitest'
import { applySettingsBackup } from './applyBackup'
import { buildSettingsEnvelope } from './envelope'

const EXPORTED_AT = '2026-11-16T05:00:00.000Z'

function storageFrom(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

describe('applySettingsBackup', () => {
  it('含まれたキーだけを書き、アプリのトークンは触らない', () => {
    const storage = storageFrom({
      apps: JSON.stringify([{ tokenData: { access_token: 'keep-me' } }]),
      setting: JSON.stringify({ captureRawData: true, showSensitive: true }),
      timelineSettings: JSON.stringify({
        timelines: [
          {
            customQuery: 'drop-me',
            id: 'home',
            order: 0,
            type: 'home',
            visible: true,
          },
        ],
        version: 2,
      }),
    })
    const built = buildSettingsEnvelope(storage.getItem, EXPORTED_AT)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const reloads: number[] = []
    const notices: number[] = []
    const applied = applySettingsBackup(built.envelope, {
      notifyOtherTabs: () => notices.push(1),
      reload: () => reloads.push(1),
      storage,
    })
    expect(applied).toEqual({ ok: true })
    expect(storage.values.get('apps')).toContain('keep-me')
    expect(JSON.parse(storage.values.get('setting') ?? '{}')).toMatchObject({
      captureRawData: false,
    })
    expect(
      JSON.parse(storage.values.get('timelineSettings') ?? '{}').timelines[0],
    ).not.toHaveProperty('customQuery')
    expect(reloads).toEqual([1])
    expect(notices).toEqual([1])
  })

  it('不正な入力では storage も再読み込みも変えない', () => {
    const storage = storageFrom({
      timelineSettings: JSON.stringify({ timelines: [], version: 2 }),
    })
    const reloads: number[] = []
    const applied = applySettingsBackup(
      { format: 'nope' },
      {
        notifyOtherTabs: () => {
          throw new Error('should not notify')
        },
        reload: () => reloads.push(1),
        storage,
      },
    )
    expect(applied).toEqual({
      error: 'Invalid backup',
      ok: false,
      success: false,
    })
    expect(storage.values.get('timelineSettings')).toContain('"version":2')
    expect(reloads).toEqual([])
  })

  it('書き込みの途中で失敗したら元の値に戻す', () => {
    const storage = storageFrom({
      setting: JSON.stringify({ showSensitive: true }),
      timelineSettings: JSON.stringify({ timelines: [], version: 2 }),
    })
    const write = storage.setItem.bind(storage)
    let writes = 0
    storage.setItem = (key, value) => {
      writes += 1
      if (writes > 1 && key === 'setting') throw new Error('quota')
      write(key, value)
    }
    const built = buildSettingsEnvelope(storage.getItem, EXPORTED_AT)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const applied = applySettingsBackup(built.envelope, {
      notifyOtherTabs: () => {
        throw new Error('should not notify')
      },
      reload: () => {
        throw new Error('should not reload')
      },
      storage,
    })
    expect(applied).toEqual({
      error: 'Invalid backup',
      ok: false,
      success: false,
    })
    expect(storage.values.get('timelineSettings')).toContain('"version":2')
    expect(storage.values.get('setting')).toContain('showSensitive')
  })
})
