import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const ALLOWED_CONTENT_TYPES = ['image/', 'audio/', 'video/']

export const PROXY_COOKIE_NAME = '__attachment_proxy'

export function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  return ALLOWED_CONTENT_TYPES.some((prefix) => normalized.startsWith(prefix))
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[(.+)\]$/, '$1')
}

function isPrivateIpv4(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized.startsWith('127.')) return true
  if (normalized === '0.0.0.0') return true
  if (normalized.startsWith('10.')) return true
  if (normalized.startsWith('192.168.')) return true
  if (normalized.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true
  return false
}

function isPrivateIpv6(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname.toLowerCase()).split('%')[0]

  if (host === '::1') return true

  const ipv4Mapped = host.match(/^::ffff:(.+)$/i)
  if (ipv4Mapped) {
    const mapped = ipv4Mapped[1]
    if (mapped.includes('.')) {
      if (isPrivateIpv4(mapped)) return true
    } else if (mapped.replace(/:/g, '').toLowerCase() === '7f001') {
      return true
    }
  }

  const firstHextet = host.split(':')[0]
  if (/^fe[89ab][0-9a-f]{0,3}$/i.test(firstHextet)) return true
  if (/^f[cd][0-9a-f]{0,2}$/i.test(firstHextet)) return true

  return false
}

export function isPrivateHost(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname.toLowerCase()).split('%')[0]
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host.includes(':')) return isPrivateIpv6(host)
  return isPrivateIpv4(host)
}

export async function isPrivateHostWithDns(hostname: string): Promise<boolean> {
  if (isPrivateHost(hostname)) return true

  const host = stripIpv6Brackets(hostname.toLowerCase()).split('%')[0]
  if (isIP(host)) return false

  try {
    const addresses = await lookup(host, { all: true, verbatim: true })
    return addresses.some(({ address }) => isPrivateHost(address))
  } catch {
    return true
  }
}

function normalizeHostname(host: string): string {
  return host.toLowerCase()
}

function normalizeAllowedDomain(domain: string): string {
  if (domain.includes('://')) {
    return normalizeHostname(new URL(domain).hostname)
  }
  return normalizeHostname(domain.split(':')[0])
}

function extractHostnameFromHeader(value: string | null): string | null {
  if (!value) return null
  try {
    return normalizeHostname(new URL(value).hostname)
  } catch {
    return null
  }
}

export function getAllowedProxyHosts(allowedDomains: string[]): Set<string> {
  const hosts = new Set(allowedDomains.map(normalizeAllowedDomain))
  if (process.env.NODE_ENV === 'development') {
    hosts.add('localhost')
  }
  return hosts
}

export function isRequestFromAllowedOrigin(
  referer: string | null,
  origin: string | null,
  allowedDomains: string[],
): boolean {
  const allowedHosts = getAllowedProxyHosts(allowedDomains)
  const requestHosts = [
    extractHostnameFromHeader(referer),
    extractHostnameFromHeader(origin),
  ].filter((host): host is string => host !== null)

  return requestHosts.some((host) => allowedHosts.has(host))
}

export function isAllowedRequestHost(
  hostHeader: string | null,
  allowedDomains: string[],
): boolean {
  if (!hostHeader) return false
  const hostname = normalizeHostname(hostHeader.split(':')[0])
  return getAllowedProxyHosts(allowedDomains).has(hostname)
}

function getProxySecret(): string {
  return (
    process.env.ATTACHMENT_PROXY_SECRET ||
    process.env.VERCEL_URL ||
    (process.env.NODE_ENV !== 'production' ? 'dev-attachment-proxy-secret' : '')
  )
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function hmacSha256Base64Url(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  )
  const bytes = new Uint8Array(signature)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function createProxyAccessToken(): Promise<string | null> {
  const secret = getProxySecret()
  if (!secret) return null
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const sig = await hmacSha256Base64Url(secret, String(expiry))
  return `${expiry}.${sig}`
}

export async function verifyProxyAccessToken(
  token: string | null | undefined,
): Promise<boolean> {
  if (!token) return false
  const secret = getProxySecret()
  if (!secret) return false

  const [expiryStr, sig] = token.split('.')
  if (!expiryStr || !sig) return false

  const expiry = Number(expiryStr)
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) {
    return false
  }

  const expected = await hmacSha256Base64Url(secret, expiryStr)
  return timingSafeEqualString(sig, expected)
}
