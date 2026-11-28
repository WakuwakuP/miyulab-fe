import { NextRequest } from 'next/server'
import { PROXY_COOKIE_NAME } from 'util/attachmentProxy'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxy } from './proxy'

afterEach(() => {
  vi.unstubAllEnvs()
})

function request(path: string, dest: string | null): NextRequest {
  const headers = new Headers()
  if (dest != null) headers.set('sec-fetch-dest', dest)
  return new NextRequest(`https://app.test${path}`, { headers })
}

describe('proxy cookie issuance', () => {
  it('文書ナビゲーションには Cookie を付ける', async () => {
    const response = await proxy(request('/', 'document'))
    expect(response.cookies.get(PROXY_COOKIE_NAME)?.value).toBeTruthy()
  })

  it('API や非文書リクエストには Cookie を付けない', async () => {
    const api = await proxy(
      request('/api/attachment/unlisted.example/a.png', 'empty'),
    )
    expect(api.cookies.get(PROXY_COOKIE_NAME)).toBeUndefined()
    const fetchNav = await proxy(request('/', 'empty'))
    expect(fetchNav.cookies.get(PROXY_COOKIE_NAME)).toBeUndefined()
    const missingDest = await proxy(request('/', null))
    expect(missingDest.cookies.get(PROXY_COOKIE_NAME)).toBeUndefined()
  })
})
