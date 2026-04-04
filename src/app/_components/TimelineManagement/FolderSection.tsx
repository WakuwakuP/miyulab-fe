'use client'

import { useDroppable } from '@dnd-kit/core'
import { type ChangeEvent, useState } from 'react'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiFolderLine,
  RiFolderOpenLine,
} from 'react-icons/ri'

import { getFolderColors } from './constants'

export const FolderSection = ({
  allFolderKeys,
  children,
  collapsedFolders,
  dragAttributes,
  dragListeners,
  groupKey,
  isDragging,
  isDropTarget,
  memberCount,
  onDeleteFolder,
  onRenameFolder,
  onToggleCollapse,
}: {
  allFolderKeys: string[]
  children: React.ReactNode
  collapsedFolders: Set<string>
  dragAttributes?: React.HTMLAttributes<HTMLElement>
  // biome-ignore lint/complexity/noBannedTypes: matches @dnd-kit SyntheticListenerMap type
  dragListeners?: Record<string, Function> | undefined
  groupKey: string
  isDragging?: boolean
  isDropTarget?: boolean
  memberCount: number
  onDeleteFolder: (groupKey: string) => void
  onRenameFolder: (groupKey: string, newName: string) => void
  onToggleCollapse: (groupKey: string) => void
}) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `droppable-folder-${groupKey}`,
  })
  const colors = getFolderColors(groupKey, allFolderKeys)
  const isCollapsed = collapsedFolders.has(groupKey)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(groupKey)
  const highlighted = isDropTarget || isOver

  return (
    <div
      className={`rounded-md border ${highlighted ? 'border-white ring-2 ring-white/30' : colors.border} overflow-hidden ${isDragging ? 'opacity-50' : ''} transition-all`}
      ref={setNodeRef}
    >
      <div
        className={`flex items-center justify-between w-full px-3 py-2 ${highlighted ? 'bg-white/10' : colors.header} transition-colors`}
      >
        <div className="flex items-center space-x-2">
          <button onClick={() => onToggleCollapse(groupKey)} type="button">
            <div className="flex items-center space-x-1">
              {isCollapsed ? (
                <>
                  <RiArrowRightSLine className={colors.text} size={16} />
                  <RiFolderLine className={colors.text} size={16} />
                </>
              ) : (
                <>
                  <RiArrowDownSLine className={colors.text} size={16} />
                  <RiFolderOpenLine className={colors.text} size={16} />
                </>
              )}
            </div>
          </button>
          <button
            aria-label="Reorder folder"
            className="cursor-move text-gray-400 hover:text-white"
            onClick={(e) => e.stopPropagation()}
            type="button"
            {...dragAttributes}
            {...dragListeners}
          >
            <RiDragMove2Line size={16} />
          </button>
          {isRenaming ? (
            <input
              className="bg-gray-700 text-sm text-white rounded px-1 py-0.5 max-w-full"
              onBlur={() => {
                const trimmed = renameValue.trim()
                if (trimmed && trimmed !== groupKey) {
                  onRenameFolder(groupKey, trimmed)
                }
                setIsRenaming(false)
              }}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setRenameValue(e.target.value)
              }
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const trimmed = renameValue.trim()
                  if (trimmed && trimmed !== groupKey) {
                    onRenameFolder(groupKey, trimmed)
                  }
                  setIsRenaming(false)
                }
                if (e.key === 'Escape') {
                  setRenameValue(groupKey)
                  setIsRenaming(false)
                }
              }}
              ref={(el) => el?.focus()}
              type="text"
              value={renameValue}
            />
          ) : (
            <span
              className={`text-sm font-semibold ${colors.text}`}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenameValue(groupKey)
                setIsRenaming(true)
              }}
            >
              {groupKey}
            </span>
          )}
          <span className="text-xs text-gray-500">({memberCount})</span>
        </div>
        <button
          className="text-gray-500 hover:text-red-400 p-1"
          onClick={(e) => {
            e.stopPropagation()
            onDeleteFolder(groupKey)
          }}
          title="Delete folder (timelines will be ungrouped)"
          type="button"
        >
          <RiDeleteBinLine size={14} />
        </button>
      </div>
      {!isCollapsed && <div className="p-2 space-y-1">{children}</div>}
    </div>
  )
}
