import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * ハッシュタグ履歴の 1 件。永続化キーは `localStorage` の `hashtagHistory`。
 */
export type HashtagHistoryItem = {
  /** ハッシュタグ文字列（先頭の `#` の有無は呼び出し側の規約に従う） */
  tag: string
  /** ピン留めされていると一覧の先頭付近に固定表示される */
  isPinned: boolean
  /** 最終アクセス時刻（Unix ミリ秒） */
  lastAccessed: number
}

/**
 * ハッシュタグの履歴を `localStorage` で保持し、ピン・ソート付きで返す Hook。
 *
 * @returns
 * - `hashtags`: ピン優先、その後 `lastAccessed` 降順に並べた一覧
 * - `addHashtag`: タグを追加または既存なら `lastAccessed` を更新
 * - `togglePin`: 指定タグのピン状態を切り替え
 * - `removeHashtag`: 指定タグを履歴から削除
 */
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
