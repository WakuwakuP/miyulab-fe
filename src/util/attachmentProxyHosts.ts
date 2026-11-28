const DEFAULT_BACKEND_URL = 'https://pl.waku.dev'

function splitHostList(value: string | undefined): string[] {
  if (value == null || value.length === 0) return []
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
}

function hostnameFromUrlOrHost(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  try {
    if (trimmed.includes('://')) {
      const hostname = new URL(trimmed).hostname.toLowerCase()
      return hostname.length > 0 ? hostname : null
    }
  } catch {
    return null
  }
  if (trimmed.includes('/') || trimmed.includes('?') || trimmed.includes('#')) {
    return null
  }
  const hostname = trimmed
    .replace(/^\[(.+)\]$/, '$1')
    .split('%')[0]
    .split(':')[0]
  return hostname.length > 0 ? hostname : null
}

function addHost(hosts: Set<string>, value: string | undefined): void {
  if (value == null) return
  const hostname = hostnameFromUrlOrHost(value)
  if (hostname) hosts.add(hostname)
}

/** Client-visible media hosts (NEXT_PUBLIC_* only). */
export function getClientAllowedMediaHosts(): Set<string> {
  const hosts = new Set<string>()
  addHost(hosts, process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL)
  for (const host of splitHostList(
    process.env.NEXT_PUBLIC_ATTACHMENT_PROXY_ALLOWED_MEDIA_HOSTS,
  )) {
    addHost(hosts, host)
  }
  return hosts
}

/** Server media hosts: public list plus ATTACHMENT_PROXY_ALLOWED_MEDIA_HOSTS. */
export function getAllowedMediaHosts(): Set<string> {
  const hosts = getClientAllowedMediaHosts()
  for (const host of splitHostList(
    process.env.ATTACHMENT_PROXY_ALLOWED_MEDIA_HOSTS,
  )) {
    addHost(hosts, host)
  }
  return hosts
}

export function normalizeMediaHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[(.+)\]$/, '$1')
    .split('%')[0]
    .split(':')[0]
}

export function isAllowedMediaHost(
  hostname: string,
  allowed: ReadonlySet<string> = getAllowedMediaHosts(),
): boolean {
  if (allowed.size === 0) return false
  return allowed.has(normalizeMediaHostname(hostname))
}

/**
 * Same-origin proxy path for allowlisted media. Other hosts stay on the
 * original URL so the server is not used as an open proxy.
 */
export function toProxiedAttachmentSrc(originalSrc: string): string {
  try {
    const url = new URL(originalSrc)
    if (!isAllowedMediaHost(url.hostname, getClientAllowedMediaHosts())) {
      return originalSrc
    }
    const path = url.pathname.replace(/^\//, '')
    const qs = url.search ? `?${url.searchParams.toString()}` : ''
    const proxiedPath = path ? `/${path}` : ''
    return `/api/attachment/${url.host}${proxiedPath}${qs}`
  } catch {
    return originalSrc
  }
}

/** Mint the HMAC cookie only for first-party document navigations. */
export function shouldIssueAttachmentProxyCookie(input: {
  pathname: string
  secFetchDest: string | null
}): boolean {
  if (input.pathname.startsWith('/api/')) return false
  const dest = input.secFetchDest?.toLowerCase() ?? ''
  return dest === 'document'
}
