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
import { TimelineEditPanel } from 'app/_components/TimelineEditPanel'
import { TimelineSummary } from 'app/_components/TimelineSummary'
import { type ChangeEvent, useCallback, useContext, useState } from 'react'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
} from 'react-icons/ri'

import type { TimelineConfigV2, TimelineType } from 'types/types'
import {
  SetTimelineContext,
  TimelineContext,
} from 'util/provider/TimelineProvider'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/**
 * UUID v4 の簡易生成
 * crypto.randomUUID が使えない環境へのフォールバック付き
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

const SortableTimelineItem = ({
  canMoveDown,
  canMoveUp,
  editingId,
  onDelete,
  onMoveDown,
  onMoveUp,
  onToggleEdit,
  onToggleVisibility,
  onUpdate,
  timeline,
}: {
  canMoveDown: boolean
  canMoveUp: boolean
  editingId: string | null
  onDelete?: (id: string) => void
  onMoveDown: (id: string) => void
  onMoveUp: (id: string) => void
  onToggleEdit: (id: string) => void
  onToggleVisibility: (id: string) => void
  onUpdate: (id: string, updates: Partial<TimelineConfigV2>) => void
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

  const isEditing = editingId === timeline.id

  return (
    <div
      className={`border-b border-gray-600 pb-2 ${
        isDragging ? 'opacity-50' : ''
      }`}
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
              isEditing ? 'text-blue-400' : 'text-gray-400'
            }`}
            onClick={() => onToggleEdit(timeline.id)}
            title="Edit timeline settings"
            type="button"
          >
            <RiEditLine size={16} />
          </button>
          <button
            className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
            disabled={!canMoveUp}
            onClick={() => onMoveUp(timeline.id)}
            title="Move up"
            type="button"
          >
            ↑
          </button>
          <button
            className="text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed"
            disabled={!canMoveDown}
            onClick={() => onMoveDown(timeline.id)}
            title="Move down"
            type="button"
          >
            ↓
          </button>
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

      {isEditing && (
        <TimelineEditPanel
          config={timeline}
          onCancel={() => onToggleEdit(timeline.id)}
          onSave={(updates) => {
            onUpdate(timeline.id, updates)
            onToggleEdit(timeline.id)
          }}
        />
      )}
    </div>
  )
}

const AddTagTimelineDialog = ({
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

export const TimelineManagement = () => {
  const timelineSettings = useContext(TimelineContext)
  const setTimelineSettings = useContext(SetTimelineContext)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAddTagDialog, setShowAddTagDialog] = useState(false)

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
      if (editingId === id) {
        setEditingId(null)
      }
    },
    [setTimelineSettings, editingId],
  )

  const onUpdate = useCallback(
    (id: string, updates: Partial<TimelineConfigV2>) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.id === id ? { ...timeline, ...updates } : timeline,
        ),
      }))
    },
    [setTimelineSettings],
  )

  const onToggleEdit = useCallback((id: string) => {
    setEditingId((prev) => (prev === id ? null : id))
  }, [])

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

  const onAddCoreTimeline = useCallback(
    (type: TimelineType) => {
      const maxOrder = Math.max(
        ...timelineSettings.timelines.map((t) => t.order),
        -1,
      )

      const newConfig: TimelineConfigV2 = {
        backendFilter: { mode: 'all' },
        id: generateId(),
        onlyMedia: type === 'public',
        order: maxOrder + 1,
        type,
        visible: true,
      }

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: [...prev.timelines, newConfig],
      }))
    },
    [timelineSettings.timelines, setTimelineSettings],
  )

  const onAddTagTimeline = useCallback(
    (config: TimelineConfigV2) => {
      const maxOrder = Math.max(
        ...timelineSettings.timelines.map((t) => t.order),
        -1,
      )

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: [...prev.timelines, { ...config, order: maxOrder + 1 }],
      }))

      setShowAddTagDialog(false)
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
                    editingId={editingId}
                    key={timeline.id}
                    onDelete={onDelete}
                    onMoveDown={onMoveDown}
                    onMoveUp={onMoveUp}
                    onToggleEdit={onToggleEdit}
                    onToggleVisibility={onToggleVisibility}
                    onUpdate={onUpdate}
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
            <div className="flex flex-wrap gap-1">
              {(
                ['home', 'local', 'public', 'notification'] as TimelineType[]
              ).map((type) => (
                <button
                  className="rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500"
                  key={type}
                  onClick={() => onAddCoreTimeline(type)}
                  type="button"
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
              <button
                className={`rounded px-2 py-1 text-xs ${
                  showAddTagDialog
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-600 hover:bg-slate-500'
                }`}
                onClick={() => setShowAddTagDialog(!showAddTagDialog)}
                type="button"
              >
                Tag
              </button>
            </div>

            {showAddTagDialog && (
              <AddTagTimelineDialog
                onAdd={onAddTagTimeline}
                onCancel={() => setShowAddTagDialog(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
