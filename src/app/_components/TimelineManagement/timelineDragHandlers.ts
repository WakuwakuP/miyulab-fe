import type { Dispatch, SetStateAction } from 'react'

import type { TimelineConfigV2, TimelineSettings } from 'types/types'

export type TimelineColumn =
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

type SetTimeline = Dispatch<SetStateAction<TimelineSettings>>
type SetEmptyFolders = Dispatch<
  SetStateAction<{ key: string; sortOrder: number }[]>
>

function getDragColumnIndex(id: string, columns: TimelineColumn[]): number {
  if (id.startsWith('folder-')) {
    const key = id.slice('folder-'.length)
    return columns.findIndex((c) => c.type === 'folder' && c.groupKey === key)
  }
  return columns.findIndex((c) => c.type === 'single' && c.timeline.id === id)
}

export function dropTimelineIntoFolder(
  draggedId: string,
  overId: string,
  sortedTimelines: TimelineConfigV2[],
  folderGroups: Map<string, TimelineConfigV2[]>,
  setTimelineSettings: SetTimeline,
): void {
  const folderKey = overId.slice('droppable-folder-'.length)
  const activeTimeline = sortedTimelines.find((t) => t.id === draggedId)
  if (!activeTimeline) return

  const folderMembers = folderGroups.get(folderKey) ?? []
  const otherOrders = sortedTimelines
    .filter((t) => t.id !== draggedId)
    .map((t) => t.order)
  const baseOrder = otherOrders.length > 0 ? Math.min(...otherOrders) - 1 : 0
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

  const normalized = [...updatedTimelines]
    .sort((a, b) => a.order - b.order)
    .map((t, i) => ({ ...t, order: i }))

  setTimelineSettings((prev) => ({
    ...prev,
    timelines: normalized,
  }))
}

export function reorderFolderColumns(
  draggedId: string,
  overId: string,
  columnsWithEmptyFolders: TimelineColumn[],
  setEmptyFolders: SetEmptyFolders,
  setTimelineSettings: SetTimeline,
): void {
  const currentColumns = [...columnsWithEmptyFolders]
  const oldIndex = getDragColumnIndex(draggedId, currentColumns)
  const newIndex = getDragColumnIndex(overId, currentColumns)

  if (oldIndex === -1 || newIndex === -1) return

  const [moved] = currentColumns.splice(oldIndex, 1)
  currentColumns.splice(newIndex, 0, moved)

  const newTimelines: TimelineConfigV2[] = []
  let order = 0
  const newEmptyFolders: { key: string; sortOrder: number }[] = []
  for (const col of currentColumns) {
    if (col.type === 'single') {
      newTimelines.push({ ...col.timeline, order: order++ })
    } else if (col.members.length === 0) {
      newEmptyFolders.push({ key: col.groupKey, sortOrder: order++ })
    } else {
      for (const member of col.members) {
        newTimelines.push({ ...member, order: order++ })
      }
    }
  }

  setEmptyFolders(newEmptyFolders)
  setTimelineSettings((prev) => ({
    ...prev,
    timelines: newTimelines,
  }))
}

export function reorderIndividualTimeline(
  draggedId: string,
  overId: string,
  sortedTimelines: TimelineConfigV2[],
  setTimelineSettings: SetTimeline,
): void {
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
