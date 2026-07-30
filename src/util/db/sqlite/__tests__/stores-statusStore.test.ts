import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb: vi.fn(),
}))

async function loadStatusStore() {
  vi.resetModules()
  const { getSqliteDb } = await import('util/db/sqlite/connection')
  const sendCommand = vi.fn().mockResolvedValue({ ok: true })
  vi.mocked(getSqliteDb).mockResolvedValue({ sendCommand } as never)
  const store = await import('util/db/sqlite/stores/statusStore')
  return { getSqliteDb, sendCommand, store }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('upsertStatus のマイクロバッチ', () => {
  it('同じキーの投稿を 100ms 後に1コマンドへまとめる', async () => {
    const { getSqliteDb, sendCommand, store } = await loadStatusStore()
    const first = { content: 'first', id: 'status-1' }
    const second = { content: 'second', id: 'status-2' }

    await store.upsertStatus(first as never, 'https://social.example', 'home')
    await store.upsertStatus(second as never, 'https://social.example', 'home')

    expect(getSqliteDb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(99)
    expect(sendCommand).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()

    expect(sendCommand).toHaveBeenCalledTimes(1)
    expect(sendCommand).toHaveBeenCalledWith({
      backendUrl: 'https://social.example',
      statusesJson: [JSON.stringify(first), JSON.stringify(second)],
      tag: undefined,
      timelineType: 'home',
      type: 'bulkUpsertStatuses',
    })
  })

  it('backend、timelineType、tag が異なる投稿を別々のコマンドに分ける', async () => {
    const { sendCommand, store } = await loadStatusStore()

    await store.upsertStatus(
      { id: 'home' } as never,
      'https://one.example',
      'home',
    )
    await store.upsertStatus(
      { id: 'tagged' } as never,
      'https://one.example',
      'tag',
      'testing',
    )
    await store.upsertStatus(
      { id: 'other-backend' } as never,
      'https://two.example',
      'home',
    )

    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()

    expect(sendCommand).toHaveBeenCalledTimes(3)
    expect(sendCommand.mock.calls.map(([command]) => command)).toEqual([
      {
        backendUrl: 'https://one.example',
        statusesJson: [JSON.stringify({ id: 'home' })],
        tag: undefined,
        timelineType: 'home',
        type: 'bulkUpsertStatuses',
      },
      {
        backendUrl: 'https://one.example',
        statusesJson: [JSON.stringify({ id: 'tagged' })],
        tag: 'testing',
        timelineType: 'tag',
        type: 'bulkUpsertStatuses',
      },
      {
        backendUrl: 'https://two.example',
        statusesJson: [JSON.stringify({ id: 'other-backend' })],
        tag: undefined,
        timelineType: 'home',
        type: 'bulkUpsertStatuses',
      },
    ])
  })

  it('全バッファ合計が20件に達したらタイマーを待たず即座に全キーを flush する', async () => {
    const { sendCommand, store } = await loadStatusStore()

    for (let index = 0; index < 10; index++) {
      await store.upsertStatus(
        { id: `home-${index}` } as never,
        'https://social.example',
        'home',
      )
    }
    for (let index = 0; index < 10; index++) {
      await store.upsertStatus(
        { id: `local-${index}` } as never,
        'https://social.example',
        'local',
      )
    }

    expect(sendCommand).toHaveBeenCalledTimes(2)
    expect(sendCommand.mock.calls[0][0].statusesJson).toHaveLength(10)
    expect(sendCommand.mock.calls[1][0].statusesJson).toHaveLength(10)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flush 中の DB エラーを記録し、タイマー callback から漏らさない', async () => {
    const { getSqliteDb, sendCommand, store } = await loadStatusStore()
    vi.mocked(getSqliteDb).mockRejectedValue(new Error('database not ready'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await store.upsertStatus(
      { id: 'status-1' } as never,
      'https://social.example',
      'home',
    )
    await vi.advanceTimersByTimeAsync(100)
    await Promise.resolve()

    expect(sendCommand).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to flush upsert buffer:',
      expect.objectContaining({ message: 'database not ready' }),
    )
  })
})

describe('直接書き込み API', () => {
  it('空の Status 配列と絵文字配列では DB を取得しない', async () => {
    const { getSqliteDb, sendCommand, store } = await loadStatusStore()

    await store.bulkUpsertStatuses([], 'https://social.example', 'home')
    await store.bulkUpsertCustomEmojis('https://social.example', [])

    expect(getSqliteDb).not.toHaveBeenCalled()
    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('各操作を対応する Worker コマンドへ正確に変換する', async () => {
    const { getSqliteDb, sendCommand, store } = await loadStatusStore()
    const statuses = [
      { content: 'first', id: 'status-1' },
      { content: 'second', id: 'status-2' },
    ]
    const editedStatus = { content: 'edited', id: 'status-3' }
    const account = { acct: 'alice', id: 'account-1' }
    const emojis = [
      {
        shortcode: 'party',
        static_url: 'https://cdn.example/party-static.png',
        url: 'https://cdn.example/party.png',
      },
    ]

    await store.bulkUpsertStatuses(
      statuses as never,
      'https://social.example',
      'tag',
      'testing',
      true,
    )
    await store.removeFromTimeline(
      'https://social.example',
      'status-1',
      'tag',
      'testing',
    )
    await store.handleDeleteEvent('https://social.example', 'status-2', 'local')
    await store.updateStatusAction(
      'https://social.example',
      'status-3',
      'bookmarked',
      true,
    )
    await store.updateStatus(editedStatus as never, 'https://social.example')
    await store.ensureLocalAccount(account as never, 'https://social.example')
    await store.toggleReactionInDb(
      'https://social.example',
      'status-4',
      false,
      ':party:',
    )
    await store.bulkUpsertCustomEmojis('https://social.example', emojis)

    expect(getSqliteDb).toHaveBeenCalledTimes(8)
    expect(sendCommand.mock.calls.map(([command]) => command)).toEqual([
      {
        backendUrl: 'https://social.example',
        skipProfileUpdate: true,
        statusesJson: statuses.map((status) => JSON.stringify(status)),
        tag: 'testing',
        timelineType: 'tag',
        type: 'bulkUpsertStatuses',
      },
      {
        backendUrl: 'https://social.example',
        statusId: 'status-1',
        tag: 'testing',
        timelineType: 'tag',
        type: 'removeFromTimeline',
      },
      {
        backendUrl: 'https://social.example',
        sourceTimelineType: 'local',
        statusId: 'status-2',
        tag: undefined,
        type: 'handleDeleteEvent',
      },
      {
        action: 'bookmarked',
        backendUrl: 'https://social.example',
        statusId: 'status-3',
        type: 'updateStatusAction',
        value: true,
      },
      {
        backendUrl: 'https://social.example',
        statusJson: JSON.stringify(editedStatus),
        type: 'updateStatus',
      },
      {
        accountJson: JSON.stringify(account),
        backendUrl: 'https://social.example',
        type: 'ensureLocalAccount',
      },
      {
        backendUrl: 'https://social.example',
        emoji: ':party:',
        statusId: 'status-4',
        type: 'toggleReaction',
        value: false,
      },
      {
        backendUrl: 'https://social.example',
        emojisJson: JSON.stringify(emojis),
        type: 'bulkUpsertCustomEmojis',
      },
    ])
  })

  it('Worker コマンドのエラーを呼び出し元へ返す', async () => {
    const { sendCommand, store } = await loadStatusStore()
    sendCommand.mockRejectedValue(new Error('worker failed'))

    await expect(
      store.removeFromTimeline('https://social.example', 'status-1', 'home'),
    ).rejects.toThrow('worker failed')
  })
})
