'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TimelineSummary } from 'app/_components/TimelineSummary'
import {
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiLogoutBoxRLine,
} from 'react-icons/ri'

import type { TimelineConfigV2 } from 'types/types'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

export const TimelineItem = ({
  flowEditorId,
  folderGroupKey,
  onDelete,
  onOpenFlowEditor,
  onRemoveFromFolder,
  onToggleVisibility,
  timeline,
}: {
  flowEditorId: string | null
  folderGroupKey?: string
  onDelete?: (id: string) => void
  onOpenFlowEditor: (id: string) => void
  onRemoveFromFolder?: (id: string) => void
  onToggleVisibility: (id: string) => void
  timeline: TimelineConfigV2
}) => {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: timeline.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const displayName = timeline.label || getDefaultTimelineName(timeline)

  const isFlowOpen = flowEditorId === timeline.id

  return (
    <div
      className={`border-b border-gray-600 pb-2 ${isDragging ? 'opacity-50' : ''}`}
      ref={setNodeRef}
      style={style}
    >
      <div className="flex items-center justify-between py-1">
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <button
            className="text-gray-400 hover:text-white"
            onClick={() => onToggleVisibility(timeline.id)}
            title={timeline.visible ? 'Hide timeline' : 'Show timeline'}
            type="button"
          >
            {timeline.visible ? (
              <RiEyeLine size={20} />
            ) : (
              <RiEyeOffLine size={20} />
            )}
          </button>
          <div
            className="flex items-center space-x-2 cursor-move"
            {...attributes}
            {...listeners}
          >
            <RiDragMove2Line className="text-gray-400" size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <span className={timeline.visible ? '' : 'text-gray-500'}>
              {displayName}
            </span>
            <TimelineSummary config={timeline} />
          </div>
        </div>
        <div className="flex items-center space-x-1">
          <button
            className={`hover:text-white ${
              isFlowOpen ? 'text-blue-400' : 'text-gray-400'
            }`}
            onClick={() => onOpenFlowEditor(timeline.id)}
            title="フローエディタで編集"
            type="button"
          >
            <RiEditLine size={16} />
          </button>
          {folderGroupKey && onRemoveFromFolder && (
            <button
              className="text-gray-400 hover:text-white"
              onClick={() => onRemoveFromFolder(timeline.id)}
              title="Remove from folder"
              type="button"
            >
              <RiLogoutBoxRLine size={16} />
            </button>
          )}
          {onDelete != null && (
            <button
              className="text-red-400 hover:text-red-300"
              onClick={() => onDelete(timeline.id)}
              title="Delete timeline"
              type="button"
            >
              <RiDeleteBinLine size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
