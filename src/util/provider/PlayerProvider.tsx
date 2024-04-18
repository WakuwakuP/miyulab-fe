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

export const PlayerContext = createContext<{
  attachment: Entity.Attachment[]
  index: number | null
}>({
  attachment: [],
  index: null,
})

export const SetPlayerContext = createContext<
  Dispatch<
    SetStateAction<{
      attachment: Entity.Attachment[]
      index: number | null
    }>
  >
>(() => {})

export const PlayerSettingContext = createContext<{
  volume: number
}>({
  volume: 1,
})

export const SetPlayerSettingContext = createContext<
  Dispatch<
    SetStateAction<{
      volume: number
    }>
  >
>(() => {})

export const PlayerProvider = ({
  children,
}: Readonly<{
  children: ReactNode
}>) => {
  const [settingLoading, setSettingLoading] =
    useState<boolean>(true)
  const [attachment, setAttachment] = useState<{
    attachment: Entity.Attachment[]
    index: number | null
  }>({
    attachment: [],
    index: null,
  })

  const [playerSetting, setPlayerSetting] = useState<{
    volume: number
  }>({
    volume: 1,
  })

  useEffect(() => {
    const settingStr = localStorage.getItem('playerSetting')
    if (settingStr != null) {
      setPlayerSetting((prev) => ({
        ...prev,
        ...JSON.parse(settingStr),
      }))
    }
    setSettingLoading(false)
  }, [])

  useEffect(() => {
    if (settingLoading) {
      return
    }
    localStorage.setItem(
      'playerSetting',
      JSON.stringify(playerSetting)
    )
  }, [playerSetting, settingLoading])

  return (
    <PlayerContext.Provider value={attachment}>
      <SetPlayerContext.Provider value={setAttachment}>
        <PlayerSettingContext.Provider
          value={playerSetting}
        >
          <SetPlayerSettingContext.Provider
            value={setPlayerSetting}
          >
            {children}
          </SetPlayerSettingContext.Provider>
        </PlayerSettingContext.Provider>
      </SetPlayerContext.Provider>
    </PlayerContext.Provider>
  )
}
