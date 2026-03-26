'use client'

import type { Entity } from 'megalodon'
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from 'react'
import { setRawDataCaptureEnabled } from 'util/debug/rawDataCapture'

type SettingData = {
  showSensitive: boolean
  playerSize: 'small' | 'medium' | 'large'
  defaultStatusVisibility: Entity.StatusVisibility
  recentHashtagsCount: number
  reactionEmojis: string[]
  /** Enable raw API/stream data capture for debugging */
  captureRawData: boolean
}

const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😃', '😢', '🙏', '👎', '😡']

const initialSettingData: SettingData = {
  captureRawData: false,
  defaultStatusVisibility: 'public',
  playerSize: 'medium',
  reactionEmojis: DEFAULT_REACTION_EMOJIS,
  recentHashtagsCount: 10,
  showSensitive: false,
} as const

export const SettingContext = createContext<SettingData>(initialSettingData)

export const SetSettingContext = createContext<
  Dispatch<SetStateAction<SettingData>>
>(() => {})

export const SettingProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const [storageLoading, setStorageLoading] = useState<boolean>(true)
  const [setting, setSetting] = useState<SettingData>(initialSettingData)

  useEffect(() => {
    const settingStr = localStorage.getItem('setting')
    if (settingStr != null) {
      setSetting((prev) => ({
        ...prev,
        ...JSON.parse(settingStr),
      }))
    }

    setStorageLoading(false)
  }, [])

  useEffect(() => {
    if (storageLoading) {
      return
    }
    localStorage.setItem('setting', JSON.stringify(setting))
  }, [setting, storageLoading])

  // Sync captureRawData flag with the module-level capture service
  useEffect(() => {
    setRawDataCaptureEnabled(setting.captureRawData)
  }, [setting.captureRawData])

  return (
    <SettingContext.Provider value={setting}>
      <SetSettingContext.Provider value={setSetting}>
        {children}
      </SetSettingContext.Provider>
    </SettingContext.Provider>
  )
}
