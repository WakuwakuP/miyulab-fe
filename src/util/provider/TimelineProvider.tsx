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
import {
  isV1Settings,
  isV2Settings,
  migrateV1toV2,
} from 'util/migration/migrateTimeline'

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
          // V2 形式: そのまま使用
          setTimelineSettings(parsed)
        } else if (isV1Settings(parsed)) {
          // V1 形式: V2 にマイグレーション
          const migrated = migrateV1toV2(parsed)
          console.info('Migrated timeline settings from V1 to V2:', migrated)
          setTimelineSettings(migrated)
        } else {
          // 不明な形式: デフォルト設定を使用
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
