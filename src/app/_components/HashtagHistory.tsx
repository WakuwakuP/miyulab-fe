'use client'

import { useContext, useState } from 'react'
import {
  RiCloseLine,
  RiHashtag,
  RiPushpinFill,
  RiSettingsFill,
  RiUnpinFill,
} from 'react-icons/ri'
import { useHashtagHistory } from 'util/hooks/useHashtagHistory'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const HashtagHistory = () => {
  const setDetail = useContext(SetDetailContext)
  const { recentHashtagsCount } = useContext(SettingContext)
  const {
    hashtags,
    removeHashtag,
    togglePin: togglePinFn,
  } = useHashtagHistory()
  const [hoveredTag, setHoveredTag] = useState<string | null>(null)
  const [isSettingsMode, setIsSettingsMode] = useState(false)

  const handleHashtagClick = (tag: string) => {
    // Open hashtag detail (tracking handled in DetailPanel)
    setDetail({
      content: tag,
      type: 'Hashtag',
    })
  }

  const handleTogglePin = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation()
    togglePinFn(tag)
  }

  const handleRemove = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeHashtag(tag)
  }

  // Limit display count
  const displayCount = recentHashtagsCount || 10
  const displayedHashtags = hashtags.slice(0, displayCount)

  if (displayedHashtags.length === 0) {
    return null
  }

  return (
    <div className="px-4 py-2 border-t">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-400">Recent Hashtags</div>
        <button
          aria-label={
            isSettingsMode ? 'Exit settings mode' : 'Enter settings mode'
          }
          className={`p-1.5 rounded transition-colors ${
            isSettingsMode
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-400'
          }`}
          onClick={() => setIsSettingsMode(!isSettingsMode)}
          type="button"
        >
          <RiSettingsFill className="w-4 h-4" />
        </button>
      </div>
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
            {isSettingsMode && hoveredTag === item.tag && (
              <button
                aria-label={item.isPinned ? 'Unpin hashtag' : 'Pin hashtag'}
                className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center"
                onClick={(e) => handleTogglePin(item.tag, e)}
                type="button"
              >
                {item.isPinned ? (
                  <RiUnpinFill className="w-3 h-3 text-white" />
                ) : (
                  <RiPushpinFill className="w-3 h-3 text-white" />
                )}
              </button>
            )}
            <span className="flex items-center">
              {item.isPinned ? (
                <RiPushpinFill className="w-4 h-4 text-blue-400" />
              ) : (
                <RiHashtag className="w-4 h-4" />
              )}
            </span>
            <span>{item.tag}</span>
            {isSettingsMode && hoveredTag === item.tag && (
              <button
                aria-label="Remove hashtag from history"
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center"
                onClick={(e) => handleRemove(item.tag, e)}
                type="button"
              >
                <RiCloseLine className="w-3 h-3 text-white" />
              </button>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
