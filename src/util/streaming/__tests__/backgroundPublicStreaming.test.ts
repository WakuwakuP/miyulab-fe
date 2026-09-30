import type { App, TimelineConfigV2 } from 'types/types'
import { describe, expect, it } from 'vitest'
import { buildInitialFetchTasks } from '../buildInitialFetchTasks'
import {
  deriveRequiredPublicFeeds,
  deriveRequiredStreams,
} from '../deriveRequiredStreams'

const APP_A = {
  appData: {},
  backend: 'mastodon',
  backendUrl: 'https://a.example',
  tokenData: null,
} as unknown as App
const APP_B = {
  appData: {},
  backend: 'mastodon',
  backendUrl: 'https://b.example',
  tokenData: null,
} as unknown as App
const APPS = [APP_A, APP_B]

function timeline(partial: Partial<TimelineConfigV2>): TimelineConfigV2 {
  return {
    id: 'tl1',
    order: 0,
    type: 'home',
    visible: true,
    ...partial,
  }
}

describe('deriveRequiredStreams + backgroundPublicStreaming', () => {
  it('false + home のみ → local/public ストリームは要求されない', () => {
    const keys = deriveRequiredStreams(
      [timeline({ type: 'home' })],
      APPS,
      false,
    )
    expect([...keys].filter((k) => k.startsWith('local|'))).toEqual([])
    expect([...keys].filter((k) => k.startsWith('public|'))).toEqual([])
  })

  it('false + 非表示の local 設定 (single backend) → local のみ scoped で要求', () => {
    const keys = deriveRequiredStreams(
      [
        timeline({
          backendFilter: { backendUrl: 'https://a.example', mode: 'single' },
          type: 'local',
          visible: false,
        }),
      ],
      APPS,
      false,
    )
    expect(keys).toEqual(new Set(['local|https://a.example']))
  })

  it('true → 従来どおり全 backendUrl の local + public', () => {
    const keys = deriveRequiredStreams([timeline({ type: 'home' })], APPS, true)
    expect(keys).toEqual(
      new Set([
        'local|https://a.example',
        'public|https://a.example',
        'local|https://b.example',
        'public|https://b.example',
      ]),
    )
  })

  it('省略時 (デフォルト true) も従来どおり全接続', () => {
    const keys = deriveRequiredStreams([timeline({ type: 'home' })], APPS)
    expect(keys.size).toBe(4)
  })

  it('false でも tag ストリームは影響を受けない', () => {
    const keys = deriveRequiredStreams(
      [
        timeline({
          tagConfig: { mode: 'or', tags: ['cat'] },
          type: 'tag',
        }),
      ],
      APPS,
      false,
    )
    expect(keys.has('tag|https://a.example|cat')).toBe(true)
    expect(keys.has('tag|https://b.example|cat')).toBe(true)
    expect([...keys].some((k) => k.startsWith('local|'))).toBe(false)
  })

  it('false + customQuery (不透明) → 対象 backendUrl の local + public を保守的に要求', () => {
    const keys = deriveRequiredStreams(
      [
        timeline({
          backendFilter: { backendUrl: 'https://b.example', mode: 'single' },
          customQuery: 'p.visibility_id = 1',
          type: 'local',
        }),
      ],
      APPS,
      false,
    )
    expect(keys).toEqual(
      new Set(['local|https://b.example', 'public|https://b.example']),
    )
  })

  it('false + queryPlan (不透明) → 両方のフィードを要求', () => {
    const keys = deriveRequiredStreams(
      [
        timeline({
          backendFilter: { backendUrl: 'https://a.example', mode: 'single' },
          queryPlan: { edges: [], nodes: [], version: 2 },
        }),
      ],
      APPS,
      false,
    )
    expect(keys.has('local|https://a.example')).toBe(true)
    expect(keys.has('public|https://a.example')).toBe(true)
    expect(keys.has('local|https://b.example')).toBe(false)
  })

  it('false + notification のみ → public フィード不要', () => {
    const keys = deriveRequiredStreams(
      [timeline({ type: 'notification' })],
      APPS,
      false,
    )
    expect(keys.size).toBe(0)
  })
})

describe('buildInitialFetchTasks + backgroundPublicStreaming', () => {
  it('false + home のみ → local/public の初期フェッチタスクは生成されない', () => {
    const fetchedKeys = new Set<string>()
    const tasks = buildInitialFetchTasks(
      APPS,
      [timeline({ type: 'home' })],
      fetchedKeys,
      false,
    )
    expect(tasks).toHaveLength(0)
    expect([...fetchedKeys]).toEqual([])
  })

  it('false + 設定済み local → そのフィードのみフェッチ対象', () => {
    const fetchedKeys = new Set<string>()
    const tasks = buildInitialFetchTasks(
      APPS,
      [
        timeline({
          backendFilter: { backendUrl: 'https://a.example', mode: 'single' },
          type: 'local',
          visible: false,
        }),
      ],
      fetchedKeys,
      false,
    )
    expect(tasks).toHaveLength(1)
    expect([...fetchedKeys]).toEqual(['local|https://a.example'])
  })

  it('true → 従来どおり全 backendUrl の local/public タスク', () => {
    const fetchedKeys = new Set<string>()
    const tasks = buildInitialFetchTasks(
      APPS,
      [timeline({ type: 'home' })],
      fetchedKeys,
      true,
    )
    expect(tasks).toHaveLength(4)
    expect(fetchedKeys.has('local|https://a.example')).toBe(true)
    expect(fetchedKeys.has('public|https://b.example')).toBe(true)
  })

  it('必要フィード集合は deriveRequiredPublicFeeds と一致する', () => {
    const timelines = [
      timeline({ type: 'local' }),
      timeline({
        tagConfig: { mode: 'or' as const, tags: ['x'] },
        type: 'tag',
      }),
    ]
    const feeds = deriveRequiredPublicFeeds(timelines, APPS, false)
    const fetchedKeys = new Set<string>()
    buildInitialFetchTasks(APPS, timelines, fetchedKeys, false)
    const feedKeys = feeds.map((f) => `${f.type}|${f.backendUrl}`)
    expect(
      [...fetchedKeys].filter((k) => !k.startsWith('tag|')).sort(),
    ).toEqual(feedKeys.sort())
  })
})
