import type { App } from 'types/types'
import { describe, expect, it, vi } from 'vitest'
import {
  createDbDiagnosticAuthorizer,
  DB_DIAGNOSTIC_AUTH_DEADLINE_MS,
  DB_DIAGNOSTIC_AUTH_TTL_MS,
  type DbDiagnosticVerifyFetch,
  isDbDiagnosticAccessToken,
  isDbDiagnosticOwnerAccountId,
  normalizeDbDiagnosticBackendUrl,
  resolveDbDiagnosticOwnerConfig,
  selectDbDiagnosticOwnerToken,
  verifyDbDiagnosticOwnerToken,
} from '../dbDiagnosticAuth'
import {
  createDbDiagnosticSessionValue,
  deriveDbDiagnosticAuthKey,
  isDbDiagnosticSessionAuthenticated,
  verifyDbDiagnosticSessionValue,
} from '../dbDiagnosticAuthCrypto'

const OWNER_URL = 'https://pl.waku.dev'
const OWNER_ID = 'AY71rP68i6pkmSPd1k'
const DB_URL = 'postgres://user:pass@host/db'
const NOW = 1_700_000_000_000
const TOKEN = 'owner-token-123_ABC~+/='

function makeApp(backendUrl: string, accessToken?: string): App {
  return {
    appData: {
      client_id: 'cid',
      client_secret: 'csecret',
      id: 'app-id',
      name: 'app',
      redirect_uri: 'https://app.example/callback',
      session_token: null,
      url: 'https://app.example/auth',
      website: null,
    },
    backend: 'mastodon',
    backendUrl,
    tokenData:
      accessToken == null
        ? null
        : {
            access_token: accessToken,
            created_at: null,
            expires_in: null,
            refresh_token: null,
            scope: null,
            token_type: 'Bearer',
          },
  }
}

function guardedCallback(
  cookieValue: string | undefined,
  env: {
    databaseUrl?: string
    now: number
    ownerAccountId?: string
    ownerBackendUrl?: string
  },
  callback: () => void,
): boolean {
  if (
    !isDbDiagnosticSessionAuthenticated(
      cookieValue,
      env.databaseUrl,
      resolveDbDiagnosticOwnerConfig(env.ownerBackendUrl, env.ownerAccountId),
      env.now,
    )
  )
    return false
  callback()
  return true
}

describe('normalizeDbDiagnosticBackendUrl', () => {
  it('https の backendUrl を正規化できること', () => {
    expect(normalizeDbDiagnosticBackendUrl('https://pl.waku.dev')).toBe(
      'https://pl.waku.dev',
    )
  })

  it('末尾スラッシュのみ除去されること', () => {
    expect(normalizeDbDiagnosticBackendUrl('https://pl.waku.dev/')).toBe(
      'https://pl.waku.dev',
    )
    expect(normalizeDbDiagnosticBackendUrl('https://pl.waku.dev///')).toBe(
      'https://pl.waku.dev',
    )
  })

  it('http スキームの時、拒否されること', () => {
    expect(normalizeDbDiagnosticBackendUrl('http://pl.waku.dev')).toBeNull()
  })

  it('userinfo を含む時、拒否されること', () => {
    expect(
      normalizeDbDiagnosticBackendUrl('https://user:pass@pl.waku.dev'),
    ).toBeNull()
  })

  it('query や hash を含む時、拒否されること', () => {
    expect(
      normalizeDbDiagnosticBackendUrl('https://pl.waku.dev/?a=b'),
    ).toBeNull()
    expect(normalizeDbDiagnosticBackendUrl('https://pl.waku.dev/#x')).toBeNull()
  })

  it('パスを含む時、拒否されること', () => {
    expect(normalizeDbDiagnosticBackendUrl('https://pl.waku.dev/x')).toBeNull()
  })

  it('URL として解釈不能な時、拒否されること', () => {
    expect(normalizeDbDiagnosticBackendUrl('pl.waku.dev')).toBeNull()
    expect(normalizeDbDiagnosticBackendUrl('')).toBeNull()
    expect(normalizeDbDiagnosticBackendUrl('https://')).toBeNull()
  })
})

describe('isDbDiagnosticOwnerAccountId', () => {
  it('非空白の文字列を受け入れること', () => {
    expect(isDbDiagnosticOwnerAccountId(OWNER_ID)).toBe(true)
  })

  it('空文字・空白・制御文字・129文字超を拒否すること', () => {
    expect(isDbDiagnosticOwnerAccountId('')).toBe(false)
    expect(isDbDiagnosticOwnerAccountId('a b')).toBe(false)
    expect(isDbDiagnosticOwnerAccountId('a\nb')).toBe(false)
    expect(isDbDiagnosticOwnerAccountId('a b')).toBe(false)
    expect(isDbDiagnosticOwnerAccountId('x'.repeat(129))).toBe(false)
    expect(isDbDiagnosticOwnerAccountId('x'.repeat(128))).toBe(true)
  })
})

describe('isDbDiagnosticAccessToken', () => {
  it('RFC6750 b64token 文字のみを受け入れること', () => {
    expect(isDbDiagnosticAccessToken(TOKEN)).toBe(true)
    expect(isDbDiagnosticAccessToken('abc')).toBe(true)
  })

  it('空白・制御文字・非文字列・空文字・8193文字超を拒否すること', () => {
    expect(isDbDiagnosticAccessToken('')).toBe(false)
    expect(isDbDiagnosticAccessToken('tok en')).toBe(false)
    expect(isDbDiagnosticAccessToken('tok\ten')).toBe(false)
    expect(isDbDiagnosticAccessToken('token"evil')).toBe(false)
    expect(isDbDiagnosticAccessToken(undefined)).toBe(false)
    expect(isDbDiagnosticAccessToken(12345)).toBe(false)
    expect(isDbDiagnosticAccessToken(null)).toBe(false)
    expect(isDbDiagnosticAccessToken('x'.repeat(8192))).toBe(true)
    expect(isDbDiagnosticAccessToken('x'.repeat(8193))).toBe(false)
  })
})

describe('resolveDbDiagnosticOwnerConfig', () => {
  it('env 未設定の時、既定のオーナー設定を返すこと', () => {
    expect(resolveDbDiagnosticOwnerConfig(undefined, undefined)).toEqual({
      accountId: OWNER_ID,
      backendUrl: OWNER_URL,
    })
  })

  it('両方の env が設定されている時、上書き設定を返すこと', () => {
    expect(
      resolveDbDiagnosticOwnerConfig('https://example.social', 'owner-2'),
    ).toEqual({ accountId: 'owner-2', backendUrl: 'https://example.social' })
  })

  it('片方のみ設定の時、fail-closed で null を返すこと', () => {
    expect(
      resolveDbDiagnosticOwnerConfig('https://example.social', undefined),
    ).toBeNull()
    expect(resolveDbDiagnosticOwnerConfig(undefined, 'owner-2')).toBeNull()
  })

  it('env URL または ID が不正な時、null を返すこと', () => {
    expect(
      resolveDbDiagnosticOwnerConfig('http://example.social', 'owner-2'),
    ).toBeNull()
    expect(
      resolveDbDiagnosticOwnerConfig('https://example.social', 'bad id'),
    ).toBeNull()
    expect(
      resolveDbDiagnosticOwnerConfig('https://example.social/path', 'owner-2'),
    ).toBeNull()
  })
})

describe('deriveDbDiagnosticAuthKey', () => {
  it('DATABASE_URL 未設定・空文字・空白のみの時、null を返すこと', () => {
    expect(deriveDbDiagnosticAuthKey(undefined)).toBeNull()
    expect(deriveDbDiagnosticAuthKey('')).toBeNull()
    expect(deriveDbDiagnosticAuthKey('   ')).toBeNull()
    expect(deriveDbDiagnosticAuthKey(' \n\t ')).toBeNull()
  })

  it('DATABASE_URL がある時、32 バイトのキーを返すこと', () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL)
    expect(key).not.toBeNull()
    expect(key?.length).toBe(32)
  })
})

describe('セッションクッキー値', () => {
  const config = { accountId: OWNER_ID, backendUrl: OWNER_URL }

  it('発行した値が有効期限内で検証できること', () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL) ?? Buffer.alloc(0)
    const value = createDbDiagnosticSessionValue(config, NOW + 1_000, key)

    expect(verifyDbDiagnosticSessionValue(value, key, config, NOW)).toBe(true)
  })

  it('期限切れ・TTL 超過の値を拒否すること', () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL) ?? Buffer.alloc(0)
    const expired = createDbDiagnosticSessionValue(config, NOW - 1, key)
    const overTtl = createDbDiagnosticSessionValue(
      config,
      NOW + DB_DIAGNOSTIC_AUTH_TTL_MS + 1,
      key,
    )
    const atTtl = createDbDiagnosticSessionValue(
      config,
      NOW + DB_DIAGNOSTIC_AUTH_TTL_MS,
      key,
    )

    expect(verifyDbDiagnosticSessionValue(expired, key, config, NOW)).toBe(
      false,
    )
    expect(verifyDbDiagnosticSessionValue(overTtl, key, config, NOW)).toBe(
      false,
    )
    expect(verifyDbDiagnosticSessionValue(atTtl, key, config, NOW)).toBe(true)
  })

  it('署名を改ざんした値・不正形式の値を拒否すること', () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL) ?? Buffer.alloc(0)
    const value = createDbDiagnosticSessionValue(config, NOW + 1_000, key)
    const dot = value.indexOf('.')
    const forged =
      value.slice(0, dot + 1) +
      Buffer.from('x'.repeat(32)).toString('base64url')

    expect(verifyDbDiagnosticSessionValue(forged, key, config, NOW)).toBe(false)
    expect(
      verifyDbDiagnosticSessionValue('not-a-cookie', key, config, NOW),
    ).toBe(false)
    expect(
      verifyDbDiagnosticSessionValue(`${NOW + 1_000}.short`, key, config, NOW),
    ).toBe(false)
    expect(
      verifyDbDiagnosticSessionValue('abc.signature', key, config, NOW),
    ).toBe(false)
    expect(verifyDbDiagnosticSessionValue(undefined, key, config, NOW)).toBe(
      false,
    )
    expect(
      verifyDbDiagnosticSessionValue(
        `${NOW + 1_000}.${'A'.repeat(43)}`,
        key,
        config,
        NOW,
      ),
    ).toBe(false)
  })

  it('キー・backendUrl・accountId が変わると無効になること', () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL) ?? Buffer.alloc(0)
    const otherKey =
      deriveDbDiagnosticAuthKey('postgres://other/db') ?? Buffer.alloc(0)
    const value = createDbDiagnosticSessionValue(config, NOW + 1_000, key)

    expect(verifyDbDiagnosticSessionValue(value, otherKey, config, NOW)).toBe(
      false,
    )
    expect(
      verifyDbDiagnosticSessionValue(
        value,
        key,
        { accountId: OWNER_ID, backendUrl: 'https://other.example' },
        NOW,
      ),
    ).toBe(false)
    expect(
      verifyDbDiagnosticSessionValue(
        value,
        key,
        { accountId: 'other-id', backendUrl: OWNER_URL },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('isDbDiagnosticSessionAuthenticated (オーナー認証ガード)', () => {
  const validCookie = () => {
    const key = deriveDbDiagnosticAuthKey(DB_URL)
    const config = resolveDbDiagnosticOwnerConfig(undefined, undefined)
    if (key == null || config == null) throw new Error('unreachable')
    return createDbDiagnosticSessionValue(config, NOW + 1_000, key)
  }

  it('設定なし・DB シークレットなし・不正クッキーの時、コールバックが一切実行されないこと', () => {
    let calls = 0
    const env = { databaseUrl: DB_URL, now: NOW }

    expect(guardedCallback(undefined, env, () => calls++)).toBe(false)
    expect(guardedCallback('forged.value', env, () => calls++)).toBe(false)
    expect(
      guardedCallback(
        validCookie(),
        { databaseUrl: '', now: NOW },
        () => calls++,
      ),
    ).toBe(false)
    expect(
      guardedCallback(
        validCookie(),
        {
          databaseUrl: DB_URL,
          now: NOW,
          ownerBackendUrl: 'http://evil.example',
        },
        () => calls++,
      ),
    ).toBe(false)
    expect(
      guardedCallback(
        validCookie(),
        { databaseUrl: DB_URL, now: NOW, ownerAccountId: 'only-id' },
        () => calls++,
      ),
    ).toBe(false)

    expect(calls).toBe(0)
  })

  it('正しいオーナー証明のクッキーで読み書きコールバックが実行されること', () => {
    const env = { databaseUrl: DB_URL, now: NOW }
    const cookie = validCookie()
    let saves = 0
    let reads = 0

    expect(guardedCallback(cookie, env, () => saves++)).toBe(true)
    expect(guardedCallback(cookie, env, () => reads++)).toBe(true)
    expect(saves).toBe(1)
    expect(reads).toBe(1)
  })
})

describe('verifyDbDiagnosticOwnerToken', () => {
  const config = { accountId: OWNER_ID, backendUrl: OWNER_URL }

  it('verify_credentials へ GET 固定で Bearer 認証するリクエストを送ること', async () => {
    const fetchImpl = vi.fn<DbDiagnosticVerifyFetch>(async () => ({
      json: async () => ({ id: OWNER_ID }),
      ok: true,
    }))

    const result = await verifyDbDiagnosticOwnerToken(config, TOKEN, fetchImpl)

    expect(result).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://pl.waku.dev/api/v1/accounts/verify_credentials')
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(init.cache).toBe('no-store')
    expect(init.redirect).toBe('error')
    expect('method' in init).toBe(false)
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('ネストした account.id 形式の応答を拒否すること', async () => {
    const fetchImpl: DbDiagnosticVerifyFetch = async () => ({
      json: async () => ({ account: { id: OWNER_ID } }),
      ok: true,
    })

    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, fetchImpl)).toBe(
      false,
    )
  })

  it('別 ID・非2xx・非JSON・配列応答・通信失敗を拒否すること', async () => {
    const otherId: DbDiagnosticVerifyFetch = async () => ({
      json: async () => ({ id: 'other-account-id' }),
      ok: true,
    })
    const httpError: DbDiagnosticVerifyFetch = async () => ({
      json: async () => ({ id: OWNER_ID }),
      ok: false,
    })
    const badJson: DbDiagnosticVerifyFetch = async () => ({
      json: async () => {
        throw new Error('not json')
      },
      ok: true,
    })
    const arrayBody: DbDiagnosticVerifyFetch = async () => ({
      json: async () => [{ id: OWNER_ID }],
      ok: true,
    })
    const throws: DbDiagnosticVerifyFetch = async () => {
      throw new Error('network')
    }

    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, otherId)).toBe(
      false,
    )
    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, httpError)).toBe(
      false,
    )
    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, badJson)).toBe(
      false,
    )
    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, arrayBody)).toBe(
      false,
    )
    expect(await verifyDbDiagnosticOwnerToken(config, TOKEN, throws)).toBe(
      false,
    )
  })
})

describe('selectDbDiagnosticOwnerToken', () => {
  it('複数アプリからオーナーの backendUrl に一致するトークンのみ返すこと', () => {
    const apps = [
      makeApp('https://other.example', 'other-token'),
      makeApp('https://pl.waku.dev', 'the-owner-token'),
      makeApp('https://third.example', 'third-token'),
    ]

    expect(selectDbDiagnosticOwnerToken(apps, OWNER_URL)).toBe(
      'the-owner-token',
    )
  })

  it('末尾スラッシュ付きの登録 URL でも一致すること', () => {
    const apps = [makeApp('https://pl.waku.dev/', 'the-owner-token')]

    expect(selectDbDiagnosticOwnerToken(apps, OWNER_URL)).toBe(
      'the-owner-token',
    )
  })

  it('オーナーのアプリが無い・トークンが無い時、null を返すこと', () => {
    expect(
      selectDbDiagnosticOwnerToken(
        [makeApp('https://other.example', 't')],
        OWNER_URL,
      ),
    ).toBeNull()
    expect(
      selectDbDiagnosticOwnerToken([makeApp('https://pl.waku.dev')], OWNER_URL),
    ).toBeNull()
    expect(
      selectDbDiagnosticOwnerToken(
        [makeApp('https://pl.waku.dev', '')],
        OWNER_URL,
      ),
    ).toBeNull()
  })

  it('不正な backendUrl に対して null を返すこと', () => {
    expect(
      selectDbDiagnosticOwnerToken([makeApp(OWNER_URL, 't')], 'not-a-url'),
    ).toBeNull()
    expect(
      selectDbDiagnosticOwnerToken(
        [makeApp(OWNER_URL, 't')],
        'http://pl.waku.dev',
      ),
    ).toBeNull()
  })
})

describe('createDbDiagnosticAuthorizer', () => {
  const ownerApp = makeApp('https://pl.waku.dev', 'owner-token')

  it('既認証の時、authorize を呼ばないこと', async () => {
    const authorize = vi.fn(async () => ({ success: true as const }))
    const ensure = createDbDiagnosticAuthorizer({
      apps: () => [ownerApp],
      authorize,
      getTarget: async () => ({
        authenticated: true,
        backendUrl: OWNER_URL,
        success: true,
      }),
    })

    await ensure()

    expect(authorize).not.toHaveBeenCalled()
  })

  it('オーナートークンのみを authorize に渡すこと', async () => {
    const authorize = vi.fn(async () => ({ success: true as const }))
    const ensure = createDbDiagnosticAuthorizer({
      apps: () => [makeApp('https://other.example', 'other-token'), ownerApp],
      authorize,
      getTarget: async () => ({
        authenticated: false,
        backendUrl: OWNER_URL,
        success: true,
      }),
    })

    await ensure()

    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith(OWNER_URL, 'owner-token')
  })

  it('並行呼び出しを1回の認証にまとめること', async () => {
    let resolveAuth: ((v: { success: true }) => void) | undefined
    const authorize = vi.fn(
      () =>
        new Promise<{ success: true }>((resolve) => {
          resolveAuth = resolve
        }),
    )
    const ensure = createDbDiagnosticAuthorizer({
      apps: () => [ownerApp],
      authorize,
      getTarget: async () => ({
        authenticated: false,
        backendUrl: OWNER_URL,
        success: true,
      }),
    })

    const first = ensure()
    const second = ensure()
    await vi.waitFor(() => {
      expect(authorize).toHaveBeenCalledTimes(1)
    })
    resolveAuth?.({ success: true })
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
  })

  it('オーナーアプリ不在の時、汎用エラーで失敗しトークンを漏らさないこと', async () => {
    const authorize = vi.fn(async () => ({ success: true as const }))
    const ensure = createDbDiagnosticAuthorizer({
      apps: () => [makeApp('https://other.example', 'other-token')],
      authorize,
      getTarget: async () => ({
        authenticated: false,
        backendUrl: OWNER_URL,
        success: true,
      }),
    })

    await expect(ensure()).rejects.toThrow('Owner account is not logged in')
    expect(authorize).not.toHaveBeenCalled()
    await expect(ensure()).rejects.toThrow('Owner account is not logged in')
  })

  it('getTarget 失敗・authorize 失敗の時、汎用エラーで失敗し後続で再試行できること', async () => {
    const authorize = vi.fn(async () => ({
      error: 'Authorization failed',
      success: false as const,
    }))
    let targetCalls = 0
    const ensure = createDbDiagnosticAuthorizer({
      apps: () => [ownerApp],
      authorize,
      getTarget: async () => {
        targetCalls++
        if (targetCalls === 1)
          return { error: 'unavailable', success: false as const }
        return {
          authenticated: false,
          backendUrl: OWNER_URL,
          success: true as const,
        }
      },
    })

    await expect(ensure()).rejects.toThrow(
      'Diagnostics authorization unavailable',
    )
    const failure = await ensure().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Diagnostics authorization failed')
    expect((failure as Error).message).not.toContain('owner-token')
    expect(authorize).toHaveBeenCalledTimes(1)

    authorize.mockResolvedValue({ success: true })
    await expect(ensure()).resolves.toBeUndefined()
  })

  it('デッドライン超過の時汎用タイムアウトで失敗し、遅延完了が新しい試行を上書きせず再試行できること', async () => {
    vi.useFakeTimers()
    try {
      const resolvers: Array<() => void> = []
      const authorize = vi.fn(
        (_url: string, _token: string) =>
          new Promise<{ success: true }>((resolve) => {
            resolvers.push(() => resolve({ success: true }))
          }),
      )
      const flush = async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve()
      }
      const ensure = createDbDiagnosticAuthorizer({
        apps: () => [ownerApp],
        authorize,
        getTarget: async () => ({
          authenticated: false,
          backendUrl: OWNER_URL,
          success: true,
        }),
      })

      const first = ensure()
      await flush()
      expect(authorize).toHaveBeenCalledTimes(1)
      const firstResult = first.catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(DB_DIAGNOSTIC_AUTH_DEADLINE_MS)
      const firstError = await firstResult
      expect(firstError).toBeInstanceOf(Error)
      expect((firstError as Error).message).toBe(
        'Diagnostics authorization timed out',
      )
      expect((firstError as Error).message).not.toContain('owner-token')

      const second = ensure()
      await flush()
      expect(authorize).toHaveBeenCalledTimes(2)

      resolvers[0]?.()
      await flush()
      const third = ensure()
      expect(third).toBe(second)

      resolvers[1]?.()
      await expect(second).resolves.toBeUndefined()
      await expect(third).resolves.toBeUndefined()
      expect(authorize).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
