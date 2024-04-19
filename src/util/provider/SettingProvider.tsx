'use client'

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useEffect,
  useState,
} from 'react'

import { type Entity } from 'megalodon'

type SettingData = {
  showSensitive: boolean
  playerSize: 'small' | 'medium' | 'large'
  defaultStatusVisibility: Entity.StatusVisibility
}

const initialSettingData: SettingData = {
  showSensitive: false,
  playerSize: 'medium',
  defaultStatusVisibility: 'public',
} as const

export const SettingContext = createContext<SettingData>(
  initialSettingData
)

export const SetSettingContext = createContext<
  Dispatch<SetStateAction<SettingData>>
>(() => {})

export const SettingProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const [storageLoading, setStorageLoading] =
    useState<boolean>(true)
  const [setting, setSetting] = useState<SettingData>(
    initialSettingData
  )

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
