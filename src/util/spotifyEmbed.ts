const VALID_SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com'])

const SPOTIFY_EMBED_TYPES = new Set([
  'album',
  'episode',
  'playlist',
  'podcast',
  'show',
  'track',
])

const SPOTIFY_ID_PATTERN = /^[\w-]+$/

const SPOTIFY_EMBED_BASE = 'https://open.spotify.com'

export type SpotifyEmbedType =
  | 'album'
  | 'episode'
  | 'playlist'
  | 'podcast'
  | 'show'
  | 'track'

export type SpotifyEmbedTarget = {
  id: string
  type: SpotifyEmbedType
}

const sanitizeSpotifyId = (id: string): string | null => {
  return SPOTIFY_ID_PATTERN.test(id) ? id : null
}

/**
 * Extract the embeddable Spotify target from a URL.
 * Accepts both page URLs (`/track/ID`) and embed URLs (`/embed/track/ID`).
 */
export const extractSpotifyEmbedTarget = (
  url: string,
): SpotifyEmbedTarget | null => {
  try {
    const parsedUrl = new URL(url)
    if (!VALID_SPOTIFY_HOSTS.has(parsedUrl.hostname)) return null

    const segments = parsedUrl.pathname.split('/').filter(Boolean)
    if (segments[0] === 'embed') segments.shift()
    if (segments.length < 2) return null

    const type = segments[0].toLowerCase()
    if (!SPOTIFY_EMBED_TYPES.has(type)) return null

    const id = sanitizeSpotifyId(segments[1])
    if (id === null) return null

    return { id, type: type as SpotifyEmbedType }
  } catch {
    return null
  }
}

export const isSpotifyUrl = (url: string): boolean => {
  return extractSpotifyEmbedTarget(url) !== null
}

/**
 * Embed URL for a `credentialless` iframe. Only this form is allowed inside a
 * COEP-isolated document, so the Player cannot rely on react-player's own
 * Spotify embed (its generated iframe is blocked by COEP).
 */
export const getSpotifyEmbedUrl = (url: string): string | null => {
  const target = extractSpotifyEmbedTarget(url)
  if (target === null) return null

  return `${SPOTIFY_EMBED_BASE}/embed/${target.type}/${target.id}`
}

/** Canonical `spotify:type:id` URI passed to the iFrame API controller. */
export const getSpotifyUri = (url: string): string | null => {
  const target = extractSpotifyEmbedTarget(url)
  if (target === null) return null

  return `spotify:${target.type}:${target.id}`
}
