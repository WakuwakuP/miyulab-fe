'use client'

import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FlowQueryEditorModal } from 'app/_components/FlowEditor'
import { TimelineSummary } from 'app/_components/TimelineSummary'
import {
  type ChangeEvent,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiDragMove2Line,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFolderAddLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiLogoutBoxRLine,
} from 'react-icons/ri'

import type { TimelineConfigV2, TimelineType } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  SetTimelineContext,
  TimelineContext,
} from 'util/provider/TimelineProvider'
import { ALL_NOTIFICATION_TYPES } from 'util/queryBuilder'
import { getDefaultTimelineName } from 'util/timelineDisplayName'
import { notifyRefresh } from 'util/timelineRefresh'

/** タブグループの色テーマパレット（フォルダ数に応じてローテーション） */
const TAB_GROUP_COLOR_PALETTE: {
  border: string
  header: string
  text: string
}[] = [
  {
    border: 'border-blue-500/50',
    header: 'bg-blue-900/30',
    text: 'text-blue-400',
  },
  {
    border: 'border-emerald-500/50',
    header: 'bg-emerald-900/30',
    text: 'text-emerald-400',
  },
  {
    border: 'border-amber-500/50',
    header: 'bg-amber-900/30',
    text: 'text-amber-400',
  },
  {
    border: 'border-purple-500/50',
    header: 'bg-purple-900/30',
    text: 'text-purple-400',
  },
  {
    border: 'border-rose-500/50',
    header: 'bg-rose-900/30',
    text: 'text-rose-400',
  },
  {
    border: 'border-cyan-500/50',
    header: 'bg-cyan-900/30',
    text: 'text-cyan-400',
  },
]

/** フォルダキーに対応する色を取得（パレットをローテーション） */
function getFolderColors(
  groupKey: string,
  allKeys: string[],
): { border: string; header: string; text: string } {
  const index = allKeys.indexOf(groupKey)
  const palette = TAB_GROUP_COLOR_PALETTE
  if (index >= 0) {
    return palette[index % palette.length]
  }
  return {
    border: 'border-gray-500/50',
    header: 'bg-gray-800',
    text: 'text-gray-400',
  }
}

/**
 * UUID v4 の簡易生成
 * crypto.randomUUID が使えない環境へのフォールバック付き
 */
let fallbackIdCounter = 0

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER

  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${fallbackIdCounter.toString(36)}`
}

const TimelineItem = ({
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

const FolderSection = ({
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

/** フォルダをドラッグ可能にするラッパー */
const SortableFolderWrapper = ({
  children,
  id,
}: {
  children: (props: {
    attributes: React.HTMLAttributes<HTMLElement>
    isDragging: boolean
    // biome-ignore lint/complexity/noBannedTypes: matches @dnd-kit SyntheticListenerMap type
    listeners: Record<string, Function> | undefined
  }) => React.ReactNode
  id: string
}) => {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, isDragging, listeners })}
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
  const _apps = useContext(AppsContext)
  const [flowEditorId, setFlowEditorId] = useState<string | null>(null)
  const [showAddTagDialog, setShowAddTagDialog] = useState(false)
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  )
  // 空フォルダを管理する state (key と sortOrder)
  const [emptyFolders, setEmptyFolders] = useState<
    { key: string; sortOrder: number }[]
  >([])
  // ドラッグ中のアクティブID
  const [activeId, setActiveId] = useState<string | null>(null)
  // ドラッグ中にホバーしているフォルダキー
  const [overFolderKey, setOverFolderKey] = useState<string | null>(null)
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

  // タイムラインをグループ別に分類
  const { folderGroups, ungroupedTimelines } = useMemo(() => {
    const groups = new Map<string, TimelineConfigV2[]>()
    const ungrouped: TimelineConfigV2[] = []

    for (const tl of sortedTimelines) {
      if (tl.tabGroup) {
        const existing = groups.get(tl.tabGroup)
        if (existing) {
          existing.push(tl)
        } else {
          groups.set(tl.tabGroup, [tl])
        }
      } else {
        ungrouped.push(tl)
      }
    }

    return { folderGroups: groups, ungroupedTimelines: ungrouped }
  }, [sortedTimelines])

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
      if (flowEditorId === id) {
        setFlowEditorId(null)
      }
    },
    [setTimelineSettings, flowEditorId],
  )

  const onUpdate = useCallback(
    (id: string, updates: Partial<TimelineConfigV2>) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.id === id ? { ...timeline, ...updates } : timeline,
        ),
      }))
      notifyRefresh(id)
    },
    [setTimelineSettings],
  )

  const onOpenFlowEditor = useCallback((id: string) => {
    setFlowEditorId(id)
  }, [])

  const flowEditorConfig = useMemo(
    () => sortedTimelines.find((t) => t.id === flowEditorId) ?? null,
    [sortedTimelines, flowEditorId],
  )

  const onRemoveFromFolder = useCallback(
    (id: string) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.id === id ? { ...timeline, tabGroup: undefined } : timeline,
        ),
      }))
    },
    [setTimelineSettings],
  )

  const onDeleteFolder = useCallback(
    (groupKey: string) => {
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.tabGroup === groupKey
            ? { ...timeline, tabGroup: undefined }
            : timeline,
        ),
      }))
    },
    [setTimelineSettings],
  )

  const onRenameFolder = useCallback(
    (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return
      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.tabGroup === oldKey
            ? { ...timeline, tabGroup: newKey }
            : timeline,
        ),
      }))
    },
    [setTimelineSettings],
  )

  const onToggleCollapse = useCallback((groupKey: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }, [])

  const onAddTimeline = useCallback(
    (type: TimelineType) => {
      const maxOrder = Math.max(
        ...timelineSettings.timelines.map((t) => t.order),
        -1,
      )

      const newConfig: TimelineConfigV2 = {
        backendFilter: { mode: 'all' },
        id: generateId(),
        // notification タイプの場合は全通知タイプを設定してクエリを生成する
        notificationFilter:
          type === 'notification' ? [...ALL_NOTIFICATION_TYPES] : undefined,
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

  // 表示順にカラム（単体 or フォルダ）を構築
  const columns = useMemo(() => {
    const result: (
      | {
          type: 'single'
          timeline: TimelineConfigV2
          sortOrder: number
        }
      | {
          type: 'folder'
          groupKey: string
          members: TimelineConfigV2[]
          sortOrder: number
        }
    )[] = []

    for (const tl of ungroupedTimelines) {
      result.push({ sortOrder: tl.order, timeline: tl, type: 'single' })
    }
    for (const [groupKey, members] of folderGroups) {
      const sortOrder = Math.min(...members.map((m) => m.order))
      result.push({ groupKey, members, sortOrder, type: 'folder' })
    }
    result.sort((a, b) => a.sortOrder - b.sortOrder)
    return result
  }, [ungroupedTimelines, folderGroups])

  // columns に空フォルダを含める
  const columnsWithEmptyFolders = useMemo(() => {
    const activeEmptyFolders = emptyFolders.filter(
      (ef) => !folderGroups.has(ef.key),
    )

    const result = [...columns]
    for (const ef of activeEmptyFolders) {
      result.push({
        groupKey: ef.key,
        members: [],
        sortOrder: ef.sortOrder,
        type: 'folder' as const,
      })
    }
    result.sort((a, b) => a.sortOrder - b.sortOrder)
    return result
  }, [columns, emptyFolders, folderGroups])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setOverFolderKey(null)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event
    if (over == null) {
      setOverFolderKey(null)
      return
    }
    const overId = String(over.id)
    // droppable-folder-* のドロップターゲットにホバー中
    if (overId.startsWith('droppable-folder-')) {
      setOverFolderKey(overId.slice('droppable-folder-'.length))
    } else {
      setOverFolderKey(null)
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      setActiveId(null)
      setOverFolderKey(null)

      if (over == null || active.id === over.id) {
        return
      }

      const draggedId = String(active.id)
      const overId = String(over.id)

      // フォルダ prefix のチェック
      const isActiveFolder = draggedId.startsWith('folder-')
      const isOverDroppableFolder = overId.startsWith('droppable-folder-')
      const isOverFolder = overId.startsWith('folder-')

      // タイムラインをフォルダのドロップゾーンにドロップ
      if (!isActiveFolder && isOverDroppableFolder) {
        const folderKey = overId.slice('droppable-folder-'.length)
        const activeTimeline = sortedTimelines.find((t) => t.id === draggedId)
        if (!activeTimeline) return

        // フォルダ内の最大 order を取得して末尾に追加
        const folderMembers = folderGroups.get(folderKey) ?? []
        const otherOrders = sortedTimelines
          .filter((t) => t.id !== draggedId)
          .map((t) => t.order)
        const baseOrder =
          otherOrders.length > 0 ? Math.min(...otherOrders) - 1 : 0
        const maxFolderOrder =
          folderMembers.length > 0
            ? Math.max(...folderMembers.map((m) => m.order))
            : baseOrder

        const updatedTimelines = sortedTimelines.map((t) => {
          if (t.id === draggedId) {
            return { ...t, order: maxFolderOrder + 0.5, tabGroup: folderKey }
          }
          return t
        })

        // order を正規化
        const normalized = [...updatedTimelines]
          .sort((a, b) => a.order - b.order)
          .map((t, i) => ({ ...t, order: i }))

        setTimelineSettings((prev) => ({
          ...prev,
          timelines: normalized,
        }))
        return
      }

      // columnsWithEmptyFolders ベースで並べ替え
      const currentColumns = [...columnsWithEmptyFolders]
      const getColumnIndex = (id: string) => {
        if (id.startsWith('folder-')) {
          const key = id.slice('folder-'.length)
          return currentColumns.findIndex(
            (c) => c.type === 'folder' && c.groupKey === key,
          )
        }
        return currentColumns.findIndex(
          (c) => c.type === 'single' && c.timeline.id === id,
        )
      }

      if (isActiveFolder || isOverFolder) {
        // フォルダの並べ替え
        const oldIndex = getColumnIndex(draggedId)
        const newIndex = getColumnIndex(overId)

        if (oldIndex === -1 || newIndex === -1) return

        const [moved] = currentColumns.splice(oldIndex, 1)
        currentColumns.splice(newIndex, 0, moved)

        // 新しい order を再計算
        const newTimelines: TimelineConfigV2[] = []
        let order = 0
        const newEmptyFolders: { key: string; sortOrder: number }[] = []
        for (const col of currentColumns) {
          if (col.type === 'single') {
            newTimelines.push({ ...col.timeline, order: order++ })
          } else {
            if (col.members.length === 0) {
              // 空フォルダの sortOrder を更新
              newEmptyFolders.push({ key: col.groupKey, sortOrder: order++ })
            } else {
              for (const member of col.members) {
                newTimelines.push({ ...member, order: order++ })
              }
            }
          }
        }

        setEmptyFolders(newEmptyFolders)

        setTimelineSettings((prev) => ({
          ...prev,
          timelines: newTimelines,
        }))
      } else {
        // 個別タイムラインの移動
        const oldIndex = sortedTimelines.findIndex(
          (timeline) => timeline.id === draggedId,
        )
        const newIndex = sortedTimelines.findIndex(
          (timeline) => timeline.id === overId,
        )

        if (oldIndex === -1 || newIndex === -1) {
          return
        }

        const updatedTimelines = [...sortedTimelines]
        const [movedTimeline] = updatedTimelines.splice(oldIndex, 1)

        // 移動先のタイムラインのフォルダに合わせる
        const overTimeline = sortedTimelines[newIndex]
        const updatedMovedTimeline = {
          ...movedTimeline,
          tabGroup: overTimeline.tabGroup,
        }

        updatedTimelines.splice(newIndex, 0, updatedMovedTimeline)

        const newTimelineSettings = updatedTimelines.map((timeline, index) => ({
          ...timeline,
          order: index,
        }))

        setTimelineSettings((prev) => ({
          ...prev,
          timelines: newTimelineSettings,
        }))
      }
    },
    [
      sortedTimelines,
      columnsWithEmptyFolders,
      folderGroups,
      setTimelineSettings,
    ],
  )

  const onAddFolder = useCallback(() => {
    let index = 1
    const usedKeys = new Set([
      ...folderGroups.keys(),
      ...emptyFolders.map((ef) => ef.key),
    ])
    while (usedKeys.has(`Folder ${index}`)) {
      index++
    }
    const newKey = `Folder ${index}`
    // 最大 sortOrder を取得して末尾に追加
    const maxOrder = Math.max(
      ...columnsWithEmptyFolders.map((c) => c.sortOrder),
      -1,
    )
    setEmptyFolders((prev) => [
      ...prev,
      { key: newKey, sortOrder: maxOrder + 1 },
    ])
  }, [folderGroups, emptyFolders, columnsWithEmptyFolders])

  // 全フォルダキー一覧（色の割り当てに使用）
  const allFolderKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const col of columnsWithEmptyFolders) {
      if (col.type === 'folder') {
        keys.add(col.groupKey)
      }
    }
    return Array.from(keys).sort()
  }, [columnsWithEmptyFolders])

  const sortableIdsWithFolders = useMemo(() => {
    const ids: string[] = []
    for (const col of columnsWithEmptyFolders) {
      if (col.type === 'folder') {
        ids.push(`folder-${col.groupKey}`)
        for (const m of col.members) {
          ids.push(m.id)
        }
      } else {
        ids.push(col.timeline.id)
      }
    }
    return ids
  }, [columnsWithEmptyFolders])

  return (
    <div className="p-2 pt-4 h-full overflow-y-auto">
      <h3 className="mb-4 text-lg font-semibold">Timeline Management</h3>
      <div className="space-y-4">
        {/* カラム順にタイムライン & フォルダを表示 */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Timelines</h4>
          <DndContext
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            sensors={sensors}
          >
            <SortableContext
              items={sortableIdsWithFolders}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {columnsWithEmptyFolders.map((column) => {
                  if (column.type === 'folder') {
                    return (
                      <SortableFolderWrapper
                        id={`folder-${column.groupKey}`}
                        key={`folder-${column.groupKey}`}
                      >
                        {({ attributes, isDragging, listeners }) => (
                          <FolderSection
                            allFolderKeys={allFolderKeys}
                            collapsedFolders={collapsedFolders}
                            dragAttributes={attributes}
                            dragListeners={listeners}
                            groupKey={column.groupKey}
                            isDragging={isDragging}
                            isDropTarget={
                              overFolderKey === column.groupKey &&
                              activeId != null &&
                              !activeId.startsWith('folder-')
                            }
                            memberCount={column.members.length}
                            onDeleteFolder={(key) => {
                              onDeleteFolder(key)
                              setEmptyFolders((prev) =>
                                prev.filter((ef) => ef.key !== key),
                              )
                            }}
                            onRenameFolder={(oldKey, newKey) => {
                              onRenameFolder(oldKey, newKey)
                              setEmptyFolders((prev) =>
                                prev.map((ef) =>
                                  ef.key === oldKey
                                    ? { ...ef, key: newKey }
                                    : ef,
                                ),
                              )
                            }}
                            onToggleCollapse={onToggleCollapse}
                          >
                            {column.members.map((timeline) => (
                              <TimelineItem
                                flowEditorId={flowEditorId}
                                folderGroupKey={column.groupKey}
                                key={timeline.id}
                                onDelete={onDelete}
                                onOpenFlowEditor={onOpenFlowEditor}
                                onRemoveFromFolder={onRemoveFromFolder}
                                onToggleVisibility={onToggleVisibility}
                                timeline={timeline}
                              />
                            ))}
                            {column.members.length === 0 && (
                              <p className="flex items-center gap-1 text-xs text-gray-500 py-1">
                                <RiDragMove2Line aria-hidden="true" />
                                <span>
                                  Empty folder — drag and drop timelines here to
                                  organize them
                                </span>
                              </p>
                            )}
                          </FolderSection>
                        )}
                      </SortableFolderWrapper>
                    )
                  }
                  const timeline = column.timeline
                  return (
                    <TimelineItem
                      flowEditorId={flowEditorId}
                      key={timeline.id}
                      onDelete={onDelete}
                      onOpenFlowEditor={onOpenFlowEditor}
                      onToggleVisibility={onToggleVisibility}
                      timeline={timeline}
                    />
                  )
                })}
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
                  onClick={() => onAddTimeline(type)}
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

        <div>
          <h4 className="mb-2 text-sm font-semibold">Add Folder</h4>
          <button
            className="flex items-center gap-1 rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500"
            onClick={onAddFolder}
            type="button"
          >
            <RiFolderAddLine size={14} />
            <span>New Folder</span>
          </button>
        </div>
      </div>

      {flowEditorConfig && (
        <FlowQueryEditorModal
          config={flowEditorConfig}
          onOpenChange={(o) => {
            if (!o) setFlowEditorId(null)
          }}
          onSave={(updates) => {
            onUpdate(flowEditorConfig.id, updates)
          }}
          open={flowEditorId != null}
        />
      )}
    </div>
  )
}
