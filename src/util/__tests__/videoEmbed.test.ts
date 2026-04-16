import {
  extractYouTubeVideoId,
  getDirectEmbedUrl,
  isExternalVideo,
} from 'util/videoEmbed'
import { describe, expect, it } from 'vitest'

describe('videoEmbed', () => {
  describe('isExternalVideo', () => {
    it('YouTube URL を外部動画として判定する', () => {
      expect(
        isExternalVideo('https://www.youtube.com/watch?v=-2pJ1dyzEE0'),
      ).toBe(true)
      expect(isExternalVideo('https://youtu.be/-2pJ1dyzEE0?t=12')).toBe(true)
      expect(
        isExternalVideo('https://www.youtube.com/shorts/-2pJ1dyzEE0'),
      ).toBe(true)
    })

    it('YouTube 以外は false を返す', () => {
      expect(isExternalVideo('https://example.com/video.mp4')).toBe(false)
      expect(
        isExternalVideo('https://notyoutube.com/watch?v=-2pJ1dyzEE0'),
      ).toBe(false)
    })
  })

  describe('getDirectEmbedUrl', () => {
    it('youtube-nocookie.com の embed URL に変換する', () => {
      expect(
        getDirectEmbedUrl('https://www.youtube.com/watch?v=-2pJ1dyzEE0'),
      ).toBe('https://www.youtube-nocookie.com/embed/-2pJ1dyzEE0')
    })

    it('非 YouTube URL は null を返す', () => {
      expect(getDirectEmbedUrl('https://example.com/video.mp4')).toBeNull()
      expect(
        getDirectEmbedUrl('https://notyoutube.com/watch?v=-2pJ1dyzEE0'),
      ).toBeNull()
    })
  })

  describe('extractYouTubeVideoId', () => {
    it('YouTube URL から動画 ID を抽出する', () => {
      expect(
        extractYouTubeVideoId('https://www.youtube.com/watch?v=-2pJ1dyzEE0'),
      ).toBe('-2pJ1dyzEE0')
      expect(extractYouTubeVideoId('https://youtu.be/-2pJ1dyzEE0')).toBe(
        '-2pJ1dyzEE0',
      )
      expect(
        extractYouTubeVideoId(
          'https://www.youtube-nocookie.com/embed/-2pJ1dyzEE0?autoplay=1',
        ),
      ).toBe('-2pJ1dyzEE0')
    })

    it('非 YouTube URL は null を返す', () => {
      expect(extractYouTubeVideoId('https://example.com/video.mp4')).toBeNull()
      expect(
        extractYouTubeVideoId('https://notyoutube.com/watch?v=-2pJ1dyzEE0'),
      ).toBeNull()
    })
  })
})
