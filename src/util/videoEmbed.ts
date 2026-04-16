const VALID_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]+$/

const sanitizeVideoId = (videoId: string | null): string | null => {
  if (videoId === null) return null
  return YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null
}

const getYouTubeVideoIdFromParsedUrl = (parsedUrl: URL): string | null => {
  if (!VALID_YOUTUBE_HOSTS.has(parsedUrl.hostname)) return null

  const segments = parsedUrl.pathname.split('/').filter(Boolean)
  if (
    parsedUrl.hostname === 'youtu.be' ||
    parsedUrl.hostname === 'www.youtu.be'
  ) {
    return sanitizeVideoId(segments[0] ?? null)
  }

  if (segments[0] === 'watch') {
    return sanitizeVideoId(parsedUrl.searchParams.get('v'))
  }

  if (segments[0] === 'embed' || segments[0] === 'shorts') {
    return sanitizeVideoId(segments[1] ?? null)
  }

  return null
}

export const extractYouTubeVideoId = (url: string): string | null => {
  try {
    const parsedUrl = new URL(url)
    return getYouTubeVideoIdFromParsedUrl(parsedUrl)
  } catch {
    return null
  }
}

/**
 * Check if a URL is an external video platform (e.g. YouTube) that should be
 * embedded via an iframe with the `credentialless` attribute to bypass COEP.
 */
export const isExternalVideo = (url: string): boolean => {
  return extractYouTubeVideoId(url) !== null
}

/**
 * Extract the direct embed URL for an external video platform.
 * Returns the platform's embed URL
 * (e.g. https://www.youtube-nocookie.com/embed/VIDEO_ID)
 * or null if the URL is not recognized.
 */
export const getDirectEmbedUrl = (url: string): string | null => {
  const videoId = extractYouTubeVideoId(url)
  if (videoId === null) return null

  return `https://www.youtube-nocookie.com/embed/${videoId}`
}
