'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'

import type { TimelineConfigV2 } from 'types/types'
import {
  cleanupNonAdvancedCustomQuery,
  isV2Settings,
} from 'util/migration/migrateTimeline'

type TimelineProviderState = {
  timelines: TimelineConfigV2[]
  version: 2
}

const initialTimelineSettings: TimelineProviderState = {
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
}

export const TimelineContext = createContext<TimelineProviderState>(
  initialTimelineSettings,
)

export const SetTimelineContext = createContext<
  Dispatch<SetStateAction<TimelineProviderState>>
>(() => {})

export const TimelineProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const [storageLoading, setStorageLoading] = useState<boolean>(true)
  const [timelineSettings, setTimelineSettings] =
    useState<TimelineProviderState>(initialTimelineSettings)

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
    const toSave = {
      timelines: timelineSettings.timelines,
      version: timelineSettings.version,
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
