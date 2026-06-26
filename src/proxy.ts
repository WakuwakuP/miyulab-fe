import { type NextRequest, NextResponse } from 'next/server'
import { createProxyAccessToken, PROXY_COOKIE_NAME } from 'util/attachmentProxy'

export async function proxy(request: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless')

  if (!request.cookies.get(PROXY_COOKIE_NAME)) {
    const token = await createProxyAccessToken()
    if (token) {
      response.cookies.set(PROXY_COOKIE_NAME, token, {
        httpOnly: true,
        maxAge: 3600,
        path: '/api/attachment',
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
      })
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
