'use client'

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type ChangeEvent, useCallback, useContext, useState } from 'react'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEyeLine,
  RiEyeOffLine,
} from 'react-icons/ri'

import type { TimelineConfig, TimelineType } from 'types/types'
import {
  SetTimelineContext,
  TimelineContext,
} from 'util/provider/TimelineProvider'

const SortableTimelineItem = ({
  timeline,
  onToggleVisibility,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  timeline: TimelineConfig
  onToggleVisibility: (id: string) => void
  onDelete?: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  canMoveUp: boolean
  canMoveDown: boolean
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: timeline.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const getTimelineName = (timeline: TimelineConfig) => {
    switch (timeline.type) {
      case 'home':
        return 'Home'
      case 'local':
        return 'Local'
      case 'public':
        return 'Public'
      case 'notification':
        return 'Notification'
      case 'tag':
        return `Tag: ${timeline.tag ?? 'Unknown'}`
      default:
        return 'Unknown'
    }
  }

  return (
    <div
      className={`flex items-center justify-between py-1 border-b border-gray-600 pb-2 ${
        isDragging ? 'opacity-50' : ''
      }`}
      ref={setNodeRef}
      style={style}
    >
      <div className="flex items-center space-x-2 flex-1">
        <button
          className="text-gray-400 hover:text-white"
          onClick={() => onToggleVisibility(timeline.id)}
          title={timeline.visible ? 'Hide timeline' : 'Show timeline'}
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
          <span className={timeline.visible ? '' : 'text-gray-500'}>
            {getTimelineName(timeline)}
          </span>
        </div>
      </div>
      <div className="flex items-center space-x-1">
        <button
          className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          disabled={!canMoveUp}
          onClick={() => onMoveUp(timeline.id)}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
          disabled={!canMoveDown}
          onClick={() => onMoveDown(timeline.id)}
          title="Move down"
        >
          ↓
        </button>
        {onDelete != null && (
          <button
            className="text-red-400 hover:text-red-300"
            onClick={() => onDelete(timeline.id)}
            title="Delete timeline"
          >
            <RiDeleteBinLine size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export const TimelineManagement = () => {
  const timelineSettings = useContext(TimelineContext)
  const setTimelineSettings = useContext(SetTimelineContext)
  const [newTagName, setNewTagName] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  )

  const sortedTimelines = [...timelineSettings.timelines].sort(
    (a, b) => a.order - b.order,
  )

  const onToggleVisibility = useCallback(
    (id: string) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.id === id
            ? { ...timeline, visible: !timeline.visible }
            : timeline,
        ),
      }))
    },
    [setTimelineSettings],
  )

  const onDelete = useCallback(
    (id: string) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.filter((timeline) => timeline.id !== id),
      }))
    },
    [setTimelineSettings],
  )

  const onMoveUp = useCallback(
    (id: string) => {
      const timeline = timelineSettings.timelines.find((t) => t.id === id)
      if (timeline == null) return

      const currentIndex = sortedTimelines.findIndex((t) => t.id === id)
      if (currentIndex <= 0) return

      const targetTimeline = sortedTimelines[currentIndex - 1]

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((t) => {
          if (t.id === timeline.id) {
            return { ...t, order: targetTimeline.order }
          }
          if (t.id === targetTimeline.id) {
            return { ...t, order: timeline.order }
          }
          return t
        }),
      }))
    },
    [timelineSettings.timelines, sortedTimelines, setTimelineSettings],
  )

  const onMoveDown = useCallback(
    (id: string) => {
      const timeline = timelineSettings.timelines.find((t) => t.id === id)
      if (timeline == null) return

      const currentIndex = sortedTimelines.findIndex((t) => t.id === id)
      if (currentIndex >= sortedTimelines.length - 1) return

      const targetTimeline = sortedTimelines[currentIndex + 1]

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((t) => {
          if (t.id === timeline.id) {
            return { ...t, order: targetTimeline.order }
          }
          if (t.id === targetTimeline.id) {
            return { ...t, order: timeline.order }
          }
          return t
        }),
      }))
    },
    [timelineSettings.timelines, sortedTimelines, setTimelineSettings],
  )

  const onAddTagTimeline = useCallback(() => {
    if (newTagName.trim() === '') return

    const newId = `tag-${newTagName.trim()}`

    // Check if tag timeline already exists
    if (timelineSettings.timelines.some((t) => t.id === newId)) {
      alert('This tag timeline already exists')
      return
    }

    const maxOrder = Math.max(
      ...timelineSettings.timelines.map((t) => t.order),
      -1,
    )

    setTimelineSettings((prev) => ({
      ...prev,
      timelines: [
        ...prev.timelines,
        {
          id: newId,
          order: maxOrder + 1,
          tag: newTagName.trim(),
          type: 'tag' as TimelineType,
          visible: true,
        },
      ],
    }))

    setNewTagName('')
  }, [newTagName, timelineSettings.timelines, setTimelineSettings])

  const onAddCoreTimeline = useCallback(
    (type: TimelineType) => {
      const newId = type

      // Check if timeline already exists
      if (timelineSettings.timelines.some((t) => t.id === newId)) {
        alert('This timeline already exists')
        return
      }

      const maxOrder = Math.max(
        ...timelineSettings.timelines.map((t) => t.order),
        -1,
      )

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: [
          ...prev.timelines,
          {
            id: newId,
            order: maxOrder + 1,
            type,
            visible: true,
          },
        ],
      }))
    },
    [timelineSettings.timelines, setTimelineSettings],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over == null || active.id === over.id) {
        return
      }

      const oldIndex = sortedTimelines.findIndex(
        (timeline) => timeline.id === active.id,
      )
      const newIndex = sortedTimelines.findIndex(
        (timeline) => timeline.id === over.id,
      )

      if (oldIndex === -1 || newIndex === -1) {
        return
      }

      // Create new order values
      const updatedTimelines = [...sortedTimelines]
      const [movedTimeline] = updatedTimelines.splice(oldIndex, 1)
      updatedTimelines.splice(newIndex, 0, movedTimeline)

      // Update orders
      const newTimelineSettings = updatedTimelines.map((timeline, index) => ({
        ...timeline,
        order: index,
      }))

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: newTimelineSettings,
      }))
    },
    [sortedTimelines, setTimelineSettings],
  )

  return (
    <div className="p-2 pt-4 h-full overflow-y-auto">
      <h3 className="mb-4 text-lg font-semibold">Timeline Management</h3>
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold">Timelines</h4>
          <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
            <SortableContext
              items={sortedTimelines.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {sortedTimelines.map((timeline, index) => (
                  <SortableTimelineItem
                    canMoveDown={index < sortedTimelines.length - 1}
                    canMoveUp={index > 0}
                    key={timeline.id}
                    onDelete={onDelete}
                    onMoveDown={onMoveDown}
                    onMoveUp={onMoveUp}
                    onToggleVisibility={onToggleVisibility}
                    timeline={timeline}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-semibold">Add Timeline</h4>
          <div className="space-y-2">
            <div className="flex space-x-2">
              {(
                ['home', 'local', 'public', 'notification'] as TimelineType[]
              ).map((type) => (
                <button
                  className="rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500 disabled:bg-slate-700 disabled:text-gray-500"
                  disabled={timelineSettings.timelines.some(
                    (t) => t.id === type,
                  )}
                  key={type}
                  onClick={() => onAddCoreTimeline(type)}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex space-x-2">
              <input
                className="flex-1 rounded bg-gray-700 px-2 py-1 text-sm text-white"
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setNewTagName(e.target.value)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onAddTagTimeline()
                  }
                }}
                placeholder="Tag name"
                type="text"
                value={newTagName}
              />
              <button
                className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
                disabled={newTagName.trim() === ''}
                onClick={onAddTagTimeline}
              >
                <RiAddLine size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
