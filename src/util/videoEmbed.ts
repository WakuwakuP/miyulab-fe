const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]+)/,
]

/**
 * Check if a URL is an external video platform (e.g. YouTube) that should be
 * embedded via an iframe with the `credentialless` attribute to bypass COEP.
 */
export const isExternalVideo = (url: string): boolean => {
  return YOUTUBE_PATTERNS.some((pattern) => pattern.test(url))
}

/**
 * Extract the direct embed URL for an external video platform.
 * Returns the platform's embed URL (e.g. https://www.youtube.com/embed/VIDEO_ID)
 * or null if the URL is not recognized.
 */
export const getDirectEmbedUrl = (url: string): string | null => {
  for (const pattern of YOUTUBE_PATTERNS) {
    const m = url.match(pattern)
    if (m?.[1]) {
      return `https://www.youtube.com/embed/${m[1]}`
    }
  }
  return null
}
