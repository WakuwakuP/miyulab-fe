export function toSecureResourceUrl(
  url: string | null | undefined,
): string | undefined {
  if (url == null || url === '') return undefined
  if (url.startsWith('//')) return `https:${url}`

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:'
      return parsedUrl.href
    }
  } catch {
    return url
  }

  return url
}
