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

const initialTimelineSettings: TimelineSettings = {
  timelines: [
    { id: 'home', order: 0, type: 'home', visible: true },
    {
      id: 'notification',
      order: 1,
      type: 'notification',
      visible: true,
    },
    {
      id: 'tag-gochisou_photo',
      order: 2,
      tag: 'gochisou_photo',
      type: 'tag',
      visible: true,
    },
    {
      id: 'public',
      order: 3,
      type: 'public',
      visible: true,
    },
  ],
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
        const stored = JSON.parse(timelineStr) as TimelineSettings
        setTimelineSettings(stored)
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
    localStorage.setItem('timelineSettings', JSON.stringify(timelineSettings))
  }, [timelineSettings, storageLoading])

  return (
    <TimelineContext.Provider value={timelineSettings}>
      <SetTimelineContext.Provider value={setTimelineSettings}>
        {children}
      </SetTimelineContext.Provider>
    </TimelineContext.Provider>
  )
}
