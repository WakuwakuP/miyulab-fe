'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useEffect,
  useState,
} from 'react'

type SettingData = {
  showSensitive: boolean
}

const initialSettingData: SettingData = {
  showSensitive: false,
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
  const [setting, setSetting] = useState<{
    showSensitive: boolean
  }>(initialSettingData)

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