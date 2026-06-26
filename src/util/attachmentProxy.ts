const ALLOWED_CONTENT_TYPES = ['image/', 'audio/', 'video/']

export function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  return ALLOWED_CONTENT_TYPES.some((prefix) => normalized.startsWith(prefix))
}

export function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '127.0.0.1') return true
  if (
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized === '0.0.0.0'
  )
    return true
  if (normalized.startsWith('10.')) return true
  if (normalized.startsWith('192.168.')) return true
  if (normalized.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(normalized)) return true
  if (normalized.endsWith('.local') || normalized.endsWith('.internal'))
    return true
  return false
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

export function isRequestFromAllowedOrigin(
  referer: string | null,
  origin: string | null,
  allowedDomains: string[],
): boolean {
  const allowedHosts = new Set(allowedDomains.map(normalizeAllowedDomain))
  const requestHosts = [
    extractHostnameFromHeader(referer),
    extractHostnameFromHeader(origin),
  ].filter((host): host is string => host !== null)

  return requestHosts.some((host) => allowedHosts.has(host))
}
