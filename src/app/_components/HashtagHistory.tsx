'use client'

import { useContext, useState } from 'react'
import { RiHashtag, RiPushpinFill } from 'react-icons/ri'
import { useHashtagHistory } from 'util/hooks/useHashtagHistory'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const HashtagHistory = () => {
  const setDetail = useContext(SetDetailContext)
  const { recentHashtagsCount } = useContext(SettingContext)
  const { hashtags, addHashtag, togglePin: togglePinFn } = useHashtagHistory()
  const [hoveredTag, setHoveredTag] = useState<string | null>(null)

  const handleHashtagClick = (tag: string) => {
    // Update last accessed time
    addHashtag(tag)

    // Open hashtag detail
    setDetail({
      content: tag,
      type: 'Hashtag',
    })
  }

  const handleTogglePin = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation()
    togglePinFn(tag)
  }

  // Limit display count
  const displayCount = recentHashtagsCount || 10
  const displayedHashtags = hashtags.slice(0, displayCount)

  if (displayedHashtags.length === 0) {
    return null
  }

  return (
    <div className="px-4 py-2 border-t">
      <div className="text-sm text-gray-400 mb-2">Recent Hashtags</div>
      <div className="flex flex-wrap gap-2">
        {displayedHashtags.map((item) => (
          <button
            className="group relative flex items-center gap-1 px-2 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            key={item.tag}
            onClick={() => handleHashtagClick(item.tag)}
            onMouseEnter={() => setHoveredTag(item.tag)}
            onMouseLeave={() => setHoveredTag(null)}
            type="button"
          >
            <span className="flex items-center">
              {item.isPinned ? (
                <RiPushpinFill className="w-4 h-4 text-blue-400" />
              ) : (
                <RiHashtag className="w-4 h-4" />
              )}
            </span>
            <span>{item.tag}</span>
            {hoveredTag === item.tag && (
              <button
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center"
                onClick={(e) => handleTogglePin(item.tag, e)}
                type="button"
              >
                <RiPushpinFill className="w-3 h-3 text-white" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
