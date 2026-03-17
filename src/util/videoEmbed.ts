const EXTERNAL_VIDEO_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]+)/,
]

/**
 * Check if a URL is an external video platform that needs the embed proxy
 * to work under Cross-Origin-Embedder-Policy.
 */
export const isExternalVideo = (url: string): boolean => {
  return EXTERNAL_VIDEO_PATTERNS.some((pattern) => pattern.test(url))
}

/**
 * Get the embed proxy URL for an external video URL.
 * Returns the /embed/video route URL that serves the video without COEP restrictions.
 */
export const getEmbedProxyUrl = (url: string): string => {
  return `/embed/video?url=${encodeURIComponent(url)}`
}
