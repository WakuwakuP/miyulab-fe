const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube(?:-nocookie)?\.com\/embed\/|youtube\.com\/shorts\/)([\w-]+)/,
]

export const extractYouTubeVideoId = (url: string): string | null => {
  for (const pattern of YOUTUBE_PATTERNS) {
    const m = url.match(pattern)
    if (m?.[1]) {
      return m[1]
    }
  }

  return null
}

/**
 * Check if a URL is an external video platform (e.g. YouTube) that should be
 * embedded via an iframe with the `credentialless` attribute to bypass COEP.
 */
export const isExternalVideo = (url: string): boolean => {
  return extractYouTubeVideoId(url) != null
}

/**
 * Extract the direct embed URL for an external video platform.
 * Returns the platform's embed URL (e.g. https://www.youtube.com/embed/VIDEO_ID)
 * or null if the URL is not recognized.
 */
export const getDirectEmbedUrl = (url: string): string | null => {
  const videoId = extractYouTubeVideoId(url)
  if (videoId == null) return null

  return `https://www.youtube-nocookie.com/embed/${videoId}`
}
