import { GET } from 'app/api/attachment/[...path]/route'
import { createProxyAccessToken, PROXY_COOKIE_NAME } from 'util/attachmentProxy'
import { afterEach, describe, expect, it, vi } from 'vitest'

type LookupAll = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<{ address: string; family: 4 | 6 }[]>

const mockedLookup = vi.hoisted(() => vi.fn<LookupAll>())

vi.mock('node:dns/promises', () => ({
  lookup: mockedLookup,
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  mockedLookup.mockReset()
})

async function authorizedRequest(path: string): Promise<Request> {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test')
  vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'https://pl.waku.dev')
  const token = await createProxyAccessToken()
  return new Request(`https://app.test/api/attachment/${path}`, {
    headers: {
      cookie: `${PROXY_COOKIE_NAME}=${token}`,
      host: 'app.test',
      referer: 'https://app.test/',
    },
  })
}

function params(path: string) {
  return { params: Promise.resolve({ path: path.split('/') }) }
}

describe('attachment proxy route', () => {
  it('許可していない宛先は取得せず拒否する', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await GET(
      await authorizedRequest('unlisted.example/files/a.png'),
      params('unlisted.example/files/a.png'),
    )
    expect(response.status).toBe(403)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('許可ホストでもリダイレクトは辿らず 403 にする', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { Location: 'https://unlisted.example/a.png' },
        status: 302,
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)
    const response = await GET(
      await authorizedRequest('pl.waku.dev/files/a.png'),
      params('pl.waku.dev/files/a.png'),
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pl.waku.dev/files/a.png',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(response.status).toBe(403)
  })

  it('上流の失敗はステータスを漏らさず 502 にする', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('missing', {
        headers: { 'Content-Type': 'image/png' },
        status: 404,
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)
    const response = await GET(
      await authorizedRequest('pl.waku.dev/files/a.png'),
      params('pl.waku.dev/files/a.png'),
    )
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch image',
    })
  })

  it('許可ホストのメディアだけを返す', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const body = new Uint8Array([1, 2, 3])
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { 'Content-Type': 'image/png' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)
    const response = await GET(
      await authorizedRequest('pl.waku.dev/files/a.png'),
      params('pl.waku.dev/files/a.png'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
  })
})
