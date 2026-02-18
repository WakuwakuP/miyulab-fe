'use client'

import { TimelineEditPanel } from 'app/_components/TimelineEditPanel'
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
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiFolderAddLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiLogoutBoxRLine,
} from 'react-icons/ri'

import type { TimelineConfigV2, TimelineType } from 'types/types'
import {
  SetTimelineContext,
  TimelineContext,
} from 'util/provider/TimelineProvider'
import { ALL_NOTIFICATION_TYPES, buildQueryFromConfig } from 'util/queryBuilder'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/** 1つのタブグループに含められるタイムラインの最大数 */
const MAX_TABS_PER_GROUP = 3

/** タブグループの色テーマ */
const TAB_GROUP_COLORS: Record<
  string,
  { border: string; header: string; text: string }
> = {
  A: {
    border: 'border-blue-500/50',
    header: 'bg-blue-900/30',
    text: 'text-blue-400',
  },
  B: {
    border: 'border-emerald-500/50',
    header: 'bg-emerald-900/30',
    text: 'text-emerald-400',
  },
  C: {
    border: 'border-amber-500/50',
    header: 'bg-amber-900/30',
    text: 'text-amber-400',
  },
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
  editingId,
  folderGroupKey,
  onDelete,
  onRemoveFromFolder,
  onToggleEdit,
  onToggleVisibility,
  onUpdate,
  timeline,
}: {
  editingId: string | null
  folderGroupKey?: string
  onDelete?: (id: string) => void
  onRemoveFromFolder?: (id: string) => void
  onToggleEdit: (id: string) => void
  onToggleVisibility: (id: string) => void
  onUpdate: (id: string, updates: Partial<TimelineConfigV2>) => void
  timeline: TimelineConfigV2
}) => {
  const displayName = timeline.label || getDefaultTimelineName(timeline)

  const isEditing = editingId === timeline.id

  return (
    <div className="border-b border-gray-600 pb-2">
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

const FolderSection = ({
  children,
  collapsedFolders,
  groupKey,
  memberCount,
  onDeleteFolder,
  onToggleCollapse,
}: {
  children: React.ReactNode
  collapsedFolders: Set<string>
  groupKey: string
  memberCount: number
  onDeleteFolder: (groupKey: string) => void
  onToggleCollapse: (groupKey: string) => void
}) => {
  const colors = TAB_GROUP_COLORS[groupKey] ?? {
    border: 'border-gray-500/50',
    header: 'bg-gray-800',
    text: 'text-gray-400',
  }
  const isCollapsed = collapsedFolders.has(groupKey)

  return (
    <div className={`rounded-md border ${colors.border} overflow-hidden`}>
      <button
        className={`flex items-center justify-between w-full px-3 py-2 ${colors.header}`}
        onClick={() => onToggleCollapse(groupKey)}
        type="button"
      >
        <div className="flex items-center space-x-2">
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
          <span className={`text-sm font-semibold ${colors.text}`}>
            Group {groupKey}
          </span>
          <span className="text-xs text-gray-500">
            ({memberCount}/{MAX_TABS_PER_GROUP})
          </span>
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
      </button>
      {!isCollapsed && <div className="p-2 space-y-1">{children}</div>}
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

    const baseConfig: TimelineConfigV2 = {
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

    // クエリを正として設定
    const defaultQuery = buildQueryFromConfig(baseConfig)
    const newConfig: TimelineConfigV2 = {
      ...baseConfig,
      advancedQuery: false,
      customQuery: defaultQuery || undefined,
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
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  )
  const [assigningToFolder, setAssigningToFolder] = useState<string | null>(
    null,
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

  // 利用可能なフォルダキーの一覧（既存 + 未使用）
  const availableFolderKeys = useMemo(() => {
    const allKeys = Object.keys(TAB_GROUP_COLORS)
    return allKeys.filter((key) => {
      const group = folderGroups.get(key)
      return !group || group.length < MAX_TABS_PER_GROUP
    })
  }, [folderGroups])

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

  const onMoveToFolder = useCallback(
    (id: string, groupKey: string) => {
      const group = folderGroups.get(groupKey)
      if (group && group.length >= MAX_TABS_PER_GROUP) return

      setTimelineSettings((prev) => ({
        ...prev,
        timelines: prev.timelines.map((timeline) =>
          timeline.id === id ? { ...timeline, tabGroup: groupKey } : timeline,
        ),
      }))
      setAssigningToFolder(null)
    },
    [setTimelineSettings, folderGroups],
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

      const baseConfig: TimelineConfigV2 = {
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

      // クエリを正として設定: type に基づいたデフォルトクエリを生成
      const defaultQuery = buildQueryFromConfig(baseConfig)
      const newConfig: TimelineConfigV2 = {
        ...baseConfig,
        advancedQuery: false,
        customQuery: defaultQuery || undefined,
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

  // 使われていないフォルダキーの中から次に作成可能なものを返す
  const sortedGroupKeys = useMemo(() => {
    return [...folderGroups.keys()].sort()
  }, [folderGroups])

  return (
    <div className="p-2 pt-4 h-full overflow-y-auto">
      <h3 className="mb-4 text-lg font-semibold">Timeline Management</h3>
      <div className="space-y-4">
        {/* フォルダ（タブグループ） */}
        {sortedGroupKeys.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Folders</h4>
            <div className="space-y-2">
              {sortedGroupKeys.map((groupKey) => {
                const members = folderGroups.get(groupKey) ?? []
                return (
                  <FolderSection
                    collapsedFolders={collapsedFolders}
                    groupKey={groupKey}
                    key={groupKey}
                    memberCount={members.length}
                    onDeleteFolder={onDeleteFolder}
                    onToggleCollapse={onToggleCollapse}
                  >
                    {members.map((timeline) => (
                      <TimelineItem
                        editingId={editingId}
                        folderGroupKey={groupKey}
                        key={timeline.id}
                        onDelete={onDelete}
                        onRemoveFromFolder={onRemoveFromFolder}
                        onToggleEdit={onToggleEdit}
                        onToggleVisibility={onToggleVisibility}
                        onUpdate={onUpdate}
                        timeline={timeline}
                      />
                    ))}
                    {members.length === 0 && (
                      <p className="text-xs text-gray-500 py-1">
                        Empty folder — add timelines below
                      </p>
                    )}
                  </FolderSection>
                )
              })}
            </div>
          </div>
        )}

        {/* 未グループのタイムライン */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">Timelines</h4>
          <div className="space-y-2">
            {ungroupedTimelines.map((timeline) => (
              <div key={timeline.id}>
                <TimelineItem
                  editingId={editingId}
                  key={timeline.id}
                  onDelete={onDelete}
                  onToggleEdit={onToggleEdit}
                  onToggleVisibility={onToggleVisibility}
                  onUpdate={onUpdate}
                  timeline={timeline}
                />
                {/* フォルダ振り分けUI */}
                {assigningToFolder === timeline.id ? (
                  <div className="flex items-center gap-2 py-1 pl-6">
                    <span className="text-xs text-gray-400">Move to:</span>
                    {availableFolderKeys.map((key) => {
                      const colors = TAB_GROUP_COLORS[key]
                      return (
                        <button
                          className={`rounded px-2 py-0.5 text-xs border ${colors.border} ${colors.text} hover:opacity-80`}
                          key={key}
                          onClick={() => onMoveToFolder(timeline.id, key)}
                          type="button"
                        >
                          {key}
                        </button>
                      )
                    })}
                    <button
                      className="text-xs text-gray-500 hover:text-gray-300"
                      onClick={() => setAssigningToFolder(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  availableFolderKeys.length > 0 && (
                    <button
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 pl-6 py-0.5"
                      onClick={() => setAssigningToFolder(timeline.id)}
                      title="Add to folder"
                      type="button"
                    >
                      <RiFolderAddLine size={14} />
                      <span>Add to folder</span>
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
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
      </div>
    </div>
  )
}
