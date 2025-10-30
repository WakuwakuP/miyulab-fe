import ReactPlayer from 'react-player'

/**
 * Check if ReactPlayer can play the given URL
 * This is a wrapper around ReactPlayer.canPlay to handle potential undefined cases
 * in react-player v3
 */
export const canPlay = (url: string): boolean => {
  try {
    // In react-player v3, canPlay might be undefined in some cases
    if (typeof ReactPlayer.canPlay === 'function') {
      return ReactPlayer.canPlay(url)
    }

    // Fallback: Basic URL validation for common media types
    if (url.length === 0) return false

    const lowerUrl = url.toLowerCase()
    const commonMediaExtensions = [
      '.mp4',
      '.webm',
      '.ogg',
      '.mp3',
      '.wav',
      '.m4a',
      '.m3u8',
      '.mpd',
      '.flv',
      '.mov',
      '.avi',
      '.wmv',
    ]

    const commonDomains = [
      'youtube.com',
      'youtu.be',
      'vimeo.com',
      'twitch.tv',
      'soundcloud.com',
      'facebook.com',
      'dailymotion.com',
    ]

    // Check for file extensions
    if (commonMediaExtensions.some((ext) => lowerUrl.includes(ext))) {
      return true
    }

    // Check for common video/audio domains
    if (commonDomains.some((domain) => lowerUrl.includes(domain))) {
      return true
    }

    return false
  } catch (error) {
    console.warn('Error checking if ReactPlayer can play URL:', error)
    return false
  }
}
