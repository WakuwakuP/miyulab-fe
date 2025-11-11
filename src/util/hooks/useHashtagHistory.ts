import { useCallback, useEffect, useMemo, useState } from 'react'

export type HashtagHistoryItem = {
  tag: string
  isPinned: boolean
  lastAccessed: number
}

export const useHashtagHistory = () => {
  const [hashtags, setHashtags] = useState<HashtagHistoryItem[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

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
    setIsLoaded(true)
  }, [])

  // Save hashtags to localStorage whenever they change (after initial load)
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('hashtagHistory', JSON.stringify(hashtags))
    }
  }, [hashtags, isLoaded])

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

  const removeHashtag = useCallback((tag: string) => {
    setHashtags((prev) => prev.filter((item) => item.tag !== tag))
  }, [])

  const sortedHashtags = useMemo(() => {
    return [...hashtags].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      return b.lastAccessed - a.lastAccessed
    })
  }, [hashtags])

  return {
    addHashtag,
    hashtags: sortedHashtags,
    removeHashtag,
    togglePin,
  }
}
