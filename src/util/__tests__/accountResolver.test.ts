import type { DbHandle } from 'util/db/sqlite/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createMockDbHandle(rows: [number, string, number][]) {
  return {
    execAsync: vi.fn().mockResolvedValue(rows),
  } as unknown as DbHandle & {
    execAsync: ReturnType<typeof vi.fn>
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('accountResolver', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock('util/db/sqlite/connection', () => ({
      getSqliteDb: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    }))
  })

  // ── initAccountResolver ────────────────────────────────────────

  describe('initAccountResolver', () => {
    it('DB からキャッシュを構築し初期化完了にする', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      const mockHandle = createMockDbHandle([
        [1, 'https://mastodon.social', 10],
        [2, 'https://pl.waku.dev', 20],
      ])
      vi.mocked(getSqliteDb).mockResolvedValue(mockHandle)

      const {
        initAccountResolver,
        isAccountResolverReady,
        resolveLocalAccountId,
      } = await import('util/accountResolver')

      await initAccountResolver()

      expect(isAccountResolverReady()).toBe(true)
      expect(resolveLocalAccountId('https://mastodon.social')).toBe(1)
      expect(resolveLocalAccountId('https://pl.waku.dev')).toBe(2)
    })

    it('local_accounts テーブルの変更を購読する', async () => {
      const { getSqliteDb, subscribe } = await import(
        'util/db/sqlite/connection'
      )
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver } = await import('util/accountResolver')
      await initAccountResolver()

      expect(subscribe).toHaveBeenCalledWith(
        'local_accounts',
        expect.any(Function),
      )
    })

    it('二度呼んでも subscribe は一度だけ', async () => {
      const { getSqliteDb, subscribe } = await import(
        'util/db/sqlite/connection'
      )
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver } = await import('util/accountResolver')
      await initAccountResolver()
      await initAccountResolver()

      expect(subscribe).toHaveBeenCalledTimes(1)
    })

    it('リスナーに通知する', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, subscribeAccountResolver } = await import(
        'util/accountResolver'
      )

      const listener = vi.fn()
      subscribeAccountResolver(listener)

      await initAccountResolver()

      expect(listener).toHaveBeenCalled()
    })
  })

  // ── resolveLocalAccountId ──────────────────────────────────────

  describe('resolveLocalAccountId', () => {
    it('存在する backendUrl の localAccountId を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, resolveLocalAccountId } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(resolveLocalAccountId('https://mastodon.social')).toBe(1)
    })

    it('存在しない backendUrl は null を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, resolveLocalAccountId } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(resolveLocalAccountId('https://unknown.example')).toBeNull()
    })
  })

  // ── resolveServerId ────────────────────────────────────────────

  describe('resolveServerId', () => {
    it('存在する backendUrl の serverId を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, resolveServerId } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(resolveServerId('https://mastodon.social')).toBe(10)
    })

    it('存在しない backendUrl は null を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, resolveServerId } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(resolveServerId('https://unknown.example')).toBeNull()
    })
  })

  // ── resolveLocalAccountIds ─────────────────────────────────────

  describe('resolveLocalAccountIds', () => {
    it('複数の backendUrl を一括解決する', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([
          [1, 'https://mastodon.social', 10],
          [2, 'https://pl.waku.dev', 20],
        ]),
      )

      const { initAccountResolver, resolveLocalAccountIds } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(
        resolveLocalAccountIds([
          'https://mastodon.social',
          'https://pl.waku.dev',
        ]),
      ).toEqual([1, 2])
    })

    it('解決できない URL はスキップする', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, resolveLocalAccountIds } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(
        resolveLocalAccountIds([
          'https://mastodon.social',
          'https://unknown.example',
        ]),
      ).toEqual([1])
    })

    it('空配列を渡すと空配列を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, resolveLocalAccountIds } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(resolveLocalAccountIds([])).toEqual([])
    })
  })

  // ── resolveServerIds ───────────────────────────────────────────

  describe('resolveServerIds', () => {
    it('複数の backendUrl から serverIds を一括解決する', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([
          [1, 'https://mastodon.social', 10],
          [2, 'https://pl.waku.dev', 20],
        ]),
      )

      const { initAccountResolver, resolveServerIds } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(
        resolveServerIds(['https://mastodon.social', 'https://pl.waku.dev']),
      ).toEqual([10, 20])
    })

    it('解決できない URL はスキップする', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, resolveServerIds } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      expect(
        resolveServerIds([
          'https://mastodon.social',
          'https://unknown.example',
        ]),
      ).toEqual([10])
    })
  })

  // ── resolveBackendUrlFromAccountId ─────────────────────────────

  describe('resolveBackendUrlFromAccountId', () => {
    it('localAccountId から backendUrl を逆引きする', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, resolveBackendUrlFromAccountId } =
        await import('util/accountResolver')
      await initAccountResolver()

      expect(resolveBackendUrlFromAccountId(1)).toBe('https://mastodon.social')
    })

    it('存在しない ID は null を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, resolveBackendUrlFromAccountId } =
        await import('util/accountResolver')
      await initAccountResolver()

      expect(resolveBackendUrlFromAccountId(999)).toBeNull()
    })
  })

  // ── refreshAccountResolver ─────────────────────────────────────

  describe('refreshAccountResolver', () => {
    it('DB から再読み込みしてキャッシュを更新する', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      const mockHandle = createMockDbHandle([
        [1, 'https://mastodon.social', 10],
      ])
      vi.mocked(getSqliteDb).mockResolvedValue(mockHandle)

      const {
        initAccountResolver,
        refreshAccountResolver,
        resolveLocalAccountId,
      } = await import('util/accountResolver')
      await initAccountResolver()

      // DB の返却値を変更して refresh
      mockHandle.execAsync.mockResolvedValue([
        [1, 'https://mastodon.social', 10],
        [3, 'https://misskey.io', 30],
      ])
      await refreshAccountResolver()

      expect(resolveLocalAccountId('https://misskey.io')).toBe(3)
    })

    it('リスナーに通知する', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const {
        initAccountResolver,
        refreshAccountResolver,
        subscribeAccountResolver,
      } = await import('util/accountResolver')
      await initAccountResolver()

      const listener = vi.fn()
      subscribeAccountResolver(listener)

      await refreshAccountResolver()

      expect(listener).toHaveBeenCalled()
    })
  })

  // ── subscribeAccountResolver ───────────────────────────────────

  describe('subscribeAccountResolver', () => {
    it('リスナーを登録し解除関数を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, subscribeAccountResolver } = await import(
        'util/accountResolver'
      )

      const listener = vi.fn()
      const unsubscribe = subscribeAccountResolver(listener)

      await initAccountResolver()
      expect(listener).toHaveBeenCalledTimes(1)

      expect(typeof unsubscribe).toBe('function')
    })

    it('解除後はリスナーが呼ばれない', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const {
        initAccountResolver,
        refreshAccountResolver,
        subscribeAccountResolver,
      } = await import('util/accountResolver')

      const listener = vi.fn()
      const unsubscribe = subscribeAccountResolver(listener)

      await initAccountResolver()
      expect(listener).toHaveBeenCalledTimes(1)

      listener.mockClear()
      unsubscribe()

      await refreshAccountResolver()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── getSnapshot ────────────────────────────────────────────────

  describe('getSnapshot', () => {
    it('キャッシュの Map を返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(
        createMockDbHandle([[1, 'https://mastodon.social', 10]]),
      )

      const { initAccountResolver, getSnapshot } = await import(
        'util/accountResolver'
      )
      await initAccountResolver()

      const snapshot = getSnapshot()
      expect(snapshot).toBeInstanceOf(Map)
      expect(snapshot.get('https://mastodon.social')).toEqual({
        backendUrl: 'https://mastodon.social',
        localAccountId: 1,
        serverId: 10,
      })
    })

    it('refresh 後は新しい Map インスタンスを返す', async () => {
      const { getSqliteDb } = await import('util/db/sqlite/connection')
      vi.mocked(getSqliteDb).mockResolvedValue(createMockDbHandle([]))

      const { initAccountResolver, refreshAccountResolver, getSnapshot } =
        await import('util/accountResolver')

      await initAccountResolver()
      const first = getSnapshot()

      await refreshAccountResolver()
      const second = getSnapshot()

      expect(first).not.toBe(second)
    })
  })
})
