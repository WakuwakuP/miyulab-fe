'use client'

import { type ChangeEvent, useCallback, useState } from 'react'
import { RiAddLine } from 'react-icons/ri'

import type { TimelineConfigV2 } from 'types/types'
import { generateId } from './constants'

export const AddTagTimelineDialog = ({
  onAdd,
  onCancel,
}: {
  onAdd: (config: TimelineConfigV2) => void
  onCancel: () => void
}) => {
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (trimmed === '' || tags.includes(trimmed)) {
      setTagInput('')
      return
    }
    if (tags.length >= 5) return

    setTags((prev) => [...prev, trimmed])
    setTagInput('')
  }, [tagInput, tags])

  const removeTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const handleCreate = useCallback(() => {
    if (tags.length === 0) return

    const newConfig: TimelineConfigV2 = {
      backendFilter: { mode: 'all' },
      id: generateId(),
      label: undefined,
      onlyMedia: false,
      order: 0, // will be overridden by caller
      tagConfig: {
        mode: 'or',
        tags,
      },
      type: 'tag',
      visible: true,
    }

    onAdd(newConfig)
  }, [tags, onAdd])

  return (
    <div className="border border-gray-600 rounded-md p-3 mt-2 space-y-3 bg-gray-800">
      <h4 className="text-sm font-semibold text-gray-200">Add Tag Timeline</h4>

      {/* Tag list */}
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            className="inline-flex items-center space-x-1 rounded bg-gray-700 px-2 py-0.5 text-xs"
            key={tag}
          >
            <span>#{tag}</span>
            <button
              className="text-red-400 hover:text-red-300 ml-1"
              onClick={() => removeTag(tag)}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Tag input */}
      <div className="flex space-x-2">
        <input
          className="flex-1 rounded bg-gray-700 px-2 py-1 text-sm text-white"
          disabled={tags.length >= 5}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setTagInput(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder={tags.length >= 5 ? 'Max 5 tags' : 'Tag name'}
          type="text"
          value={tagInput}
        />
        <button
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:bg-gray-600"
          disabled={tagInput.trim() === '' || tags.length >= 5}
          onClick={addTag}
          type="button"
        >
          <RiAddLine size={16} />
        </button>
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-2 pt-1">
        <button
          className="rounded bg-gray-600 px-3 py-1 text-sm hover:bg-gray-500"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
          disabled={tags.length === 0}
          onClick={handleCreate}
          type="button"
        >
          Create
        </button>
      </div>

      {tags.length === 0 && (
        <p className="text-xs text-gray-400">
          Add at least one tag to create a tag timeline.
        </p>
      )}
    </div>
  )
}
