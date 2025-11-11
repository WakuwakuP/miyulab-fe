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

type SettingData = {
  showSensitive: boolean
  playerSize: 'small' | 'medium' | 'large'
  defaultStatusVisibility: Entity.StatusVisibility
  recentHashtagsCount: number
}

const initialSettingData: SettingData = {
  defaultStatusVisibility: 'public',
  playerSize: 'medium',
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

  return (
    <SettingContext.Provider value={setting}>
      <SetSettingContext.Provider value={setSetting}>
        {children}
      </SetSettingContext.Provider>
    </SettingContext.Provider>
  )
}
