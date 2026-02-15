'use client'

import { type ChangeEvent, useCallback, useState } from 'react'
import type { TagConfig, TagMode } from 'types/types'

type TagConfigEditorProps = {
  onChange: (value: TagConfig) => void
  value: TagConfig
}

const MAX_TAG_COUNT = 5

export const TagConfigEditor = ({ onChange, value }: TagConfigEditorProps) => {
  const [newTag, setNewTag] = useState('')

  const addTag = useCallback(() => {
    const trimmed = newTag.trim().toLowerCase()
    if (trimmed === '') return

    // 重複チェック
    if (value.tags.includes(trimmed)) {
      setNewTag('')
      return
    }

    // 上限チェック
    if (value.tags.length >= MAX_TAG_COUNT) {
      return
    }

    onChange({
      mode: value.mode,
      tags: [...value.tags, trimmed],
    })
    setNewTag('')
  }, [newTag, value, onChange])

  const removeTag = useCallback(
    (tagToRemove: string) => {
      const updated = value.tags.filter((t) => t !== tagToRemove)
      onChange({
        mode: value.mode,
        tags: updated,
      })
    },
    [value, onChange],
  )

  const handleModeChange = useCallback(
    (mode: TagMode) => {
      onChange({
        mode,
        tags: value.tags,
      })
    },
    [value.tags, onChange],
  )

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    // ハッシュ記号を除去
    setNewTag(e.target.value.replace(/^#/, ''))
  }, [])

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold text-gray-300">Tags</span>

      {/* タグ一覧 */}
      <div className="flex flex-wrap gap-1">
        {value.tags.map((tag) => (
          <span
            className="inline-flex items-center space-x-1 rounded bg-gray-700 px-2 py-0.5 text-xs"
            key={tag}
          >
            <span>#{tag}</span>
            <button
              className="text-red-400 hover:text-red-300 ml-1"
              onClick={() => removeTag(tag)}
              title={`Remove #${tag}`}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* タグ入力 */}
      <div className="flex space-x-2">
        <input
          className="flex-1 rounded bg-gray-700 px-2 py-1 text-sm text-white"
          disabled={value.tags.length >= MAX_TAG_COUNT}
          onChange={handleInputChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder={
            value.tags.length >= MAX_TAG_COUNT
              ? `Max ${MAX_TAG_COUNT} tags`
              : 'Add tag...'
          }
          type="text"
          value={newTag}
        />
        <button
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
          disabled={newTag.trim() === '' || value.tags.length >= MAX_TAG_COUNT}
          onClick={addTag}
          type="button"
        >
          Add
        </button>
      </div>

      {value.tags.length >= MAX_TAG_COUNT && (
        <p className="text-xs text-yellow-400">
          Maximum of {MAX_TAG_COUNT} tags reached
        </p>
      )}

      {/* AND/OR モード切替（2つ以上のタグがある場合のみ表示） */}
      {value.tags.length > 1 && (
        <div className="space-y-1">
          <span className="text-xs font-semibold text-gray-300">Tag Mode</span>
          <div className="flex space-x-1">
            <button
              className={`rounded px-3 py-1 text-xs ${
                value.mode === 'or'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => handleModeChange('or')}
              title="Show posts with any of these tags"
              type="button"
            >
              OR (any)
            </button>
            <button
              className={`rounded px-3 py-1 text-xs ${
                value.mode === 'and'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
              onClick={() => handleModeChange('and')}
              title="Show posts with all of these tags"
              type="button"
            >
              AND (all)
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {value.mode === 'or'
              ? 'Showing posts with any of the selected tags'
              : 'Showing only posts with all selected tags'}
          </p>
        </div>
      )}

      {value.tags.length === 0 && (
        <p className="text-xs text-red-400">At least one tag is required</p>
      )}
    </div>
  )
}
