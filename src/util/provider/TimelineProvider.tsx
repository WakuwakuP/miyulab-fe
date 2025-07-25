'use client'

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useEffect,
  useState,
} from 'react'

import { type TimelineSettings } from 'types/types'

const initialTimelineSettings: TimelineSettings = {
  timelines: [
    { id: 'home', type: 'home', visible: true, order: 0 },
    {
      id: 'notification',
      type: 'notification',
      visible: true,
      order: 1,
    },
    {
      id: 'tag-gochisou_photo',
      type: 'tag',
      visible: true,
      order: 2,
      tag: 'gochisou_photo',
    },
    {
      id: 'public',
      type: 'public',
      visible: true,
      order: 3,
    },
  ],
} as const

export const TimelineContext =
  createContext<TimelineSettings>(initialTimelineSettings)

export const SetTimelineContext = createContext<
  Dispatch<SetStateAction<TimelineSettings>>
>(() => {})

export const TimelineProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const [storageLoading, setStorageLoading] =
    useState<boolean>(true)
  const [timelineSettings, setTimelineSettings] =
    useState<TimelineSettings>(initialTimelineSettings)

  useEffect(() => {
    const timelineStr = localStorage.getItem(
      'timelineSettings'
    )
    if (timelineStr != null) {
      try {
        const stored = JSON.parse(
          timelineStr
        ) as TimelineSettings
        setTimelineSettings(stored)
      } catch (error) {
        console.warn(
          'Failed to parse timeline settings from localStorage:',
          error
        )
      }
    }

    setStorageLoading(false)
  }, [])

  useEffect(() => {
    if (storageLoading) {
      return
    }
    localStorage.setItem(
      'timelineSettings',
      JSON.stringify(timelineSettings)
    )
  }, [timelineSettings, storageLoading])

  return (
    <TimelineContext.Provider value={timelineSettings}>
      <SetTimelineContext.Provider
        value={setTimelineSettings}
      >
        {children}
      </SetTimelineContext.Provider>
    </TimelineContext.Provider>
  )
}
