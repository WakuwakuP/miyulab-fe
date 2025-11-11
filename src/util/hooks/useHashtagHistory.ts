import { useCallback, useEffect, useState } from 'react'

export type HashtagHistoryItem = {
  tag: string
  isPinned: boolean
  lastAccessed: number
}

export const useHashtagHistory = () => {
  const [hashtags, setHashtags] = useState<HashtagHistoryItem[]>([])

  // Load hashtags from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('hashtagHistory')
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as HashtagHistoryItem[]
        setHashtags(parsed)
      } catch (e) {
        console.error('Failed to parse hashtag history:', e)
        setHashtags([])
      }
    }
  }, [])

  // Save hashtags to localStorage whenever they change
  useEffect(() => {
    if (hashtags.length > 0) {
      localStorage.setItem('hashtagHistory', JSON.stringify(hashtags))
    }
  }, [hashtags])

  const addHashtag = useCallback((tag: string) => {
    setHashtags((prev) => {
      const existing = prev.find((item) => item.tag === tag)
      if (existing) {
        // Update last accessed time for existing hashtag
        return prev.map((item) =>
          item.tag === tag ? { ...item, lastAccessed: Date.now() } : item,
        )
      }
      // Add new hashtag
      return [{ isPinned: false, lastAccessed: Date.now(), tag }, ...prev]
    })
  }, [])

  const togglePin = useCallback((tag: string) => {
    setHashtags((prev) =>
      prev.map((item) =>
        item.tag === tag ? { ...item, isPinned: !item.isPinned } : item,
      ),
    )
  }, [])

  const sortedHashtags = [...hashtags].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.lastAccessed - a.lastAccessed
  })

  return {
    addHashtag,
    hashtags: sortedHashtags,
    togglePin,
  }
}
