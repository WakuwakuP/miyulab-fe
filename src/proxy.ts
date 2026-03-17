import { NextResponse } from 'next/server'

export function proxy() {
  const response = NextResponse.next()

  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless')

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
