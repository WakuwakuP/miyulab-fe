'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'

import type { TimelineSettings } from 'types/types'
import { isV2Settings } from 'util/migration/migrateTimeline'

const initialTimelineSettings: TimelineSettings = {
  timelines: [
    {
      backendFilter: { mode: 'all' },
      id: 'home',
      order: 0,
      type: 'home',
      visible: true,
    },
    {
      backendFilter: { mode: 'all' },
      id: 'notification',
      order: 1,
      type: 'notification',
      visible: true,
    },
    {
      backendFilter: { mode: 'all' },
      id: 'tag-gochisou_photo',
      onlyMedia: true,
      order: 2,
      tagConfig: {
        mode: 'or',
        tags: ['gochisou_photo'],
      },
      type: 'tag',
      visible: true,
    },
    {
      backendFilter: { mode: 'all' },
      id: 'public',
      onlyMedia: true,
      order: 3,
      type: 'public',
      visible: true,
    },
  ],
  version: 2,
} as const

/**
 * 非 Advanced Query モードのタイムラインから customQuery を除去する。
 *
 * customQuery が設定されていると useTimelineData が useCustomQueryTimeline に
 * ルーティングし、LEFT JOIN ベースの重いクエリが実行される。
 * 通常モードでは個別の設定プロパティ（backendFilter, onlyMedia 等）が正であり、
 * 型別の最適化された Hook（useFilteredTimeline 等）を使用すべきため、
 * customQuery は Advanced Query モード時のみ保持する。
 */
function cleanupNonAdvancedCustomQuery(
  settings: TimelineSettings,
): TimelineSettings {
  let changed = false
  const timelines = settings.timelines.map((tl) => {
    if (!tl.advancedQuery && tl.customQuery != null) {
      changed = true
      const { customQuery: _, ...rest } = tl
      return rest
    }
    return tl
  })
  return changed ? { ...settings, timelines } : settings
}

export const TimelineContext = createContext<TimelineSettings>(
  initialTimelineSettings,
)

export const SetTimelineContext = createContext<
  Dispatch<SetStateAction<TimelineSettings>>
>(() => {})

export const TimelineProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const [storageLoading, setStorageLoading] = useState<boolean>(true)
  const [timelineSettings, setTimelineSettings] = useState<TimelineSettings>(
    initialTimelineSettings,
  )

  useEffect(() => {
    const timelineStr = localStorage.getItem('timelineSettings')
    if (timelineStr != null) {
      try {
        const parsed: unknown = JSON.parse(timelineStr)

        if (isV2Settings(parsed)) {
          // V2 形式: 非 Advanced Query の customQuery をクリーンアップして使用
          setTimelineSettings(cleanupNonAdvancedCustomQuery(parsed))
        } else {
          // V2 以外の形式: デフォルト設定を使用
          console.warn(
            'Unknown timeline settings format, using defaults:',
            parsed,
          )
        }
      } catch (error) {
        console.warn(
          'Failed to parse timeline settings from localStorage:',
          error,
        )
      }
    }

    setStorageLoading(false)
  }, [])

  useEffect(() => {
    if (storageLoading) {
      return
    }
    const toSave: TimelineSettings = {
      timelines: timelineSettings.timelines,
      version: 2,
    }
    localStorage.setItem('timelineSettings', JSON.stringify(toSave))
  }, [timelineSettings, storageLoading])

  return (
    <TimelineContext.Provider value={timelineSettings}>
      <SetTimelineContext.Provider value={setTimelineSettings}>
        {children}
      </SetTimelineContext.Provider>
    </TimelineContext.Provider>
  )
}
