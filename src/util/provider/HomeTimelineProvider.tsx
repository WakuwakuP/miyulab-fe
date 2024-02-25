'use client'

import generator, {
  Entity,
  WebSocketInterface,
} from 'megalodon'

import {
  FC,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { TokenContext } from 'util/provider/AppProvider'

export const HomeTimelineContext = createContext<
  Entity.Status[]
>([])

export const PushTimelineContext = createContext<
  (status: Entity.Status) => void
>(() => {})

export const HomeTimelineProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const token = useContext(TokenContext)
  if (token?.access_token == null) {
    return null
  }

  const [timelineData, setTimelineData] = useState<
    Entity.Status[]
  >([])

  useEffect(() => {
    const client = generator(
      'pleroma',
      'https://pl.waku.dev',
      token?.access_token
    )
    client
      .getHomeTimeline({
        limit: 40,
      })
      .then((res) => {
        setTimelineData(res.data)
      })
  }, [token])

  const pushTimeline = (status: Entity.Status) => {
    setTimelineData([status, ...timelineData])
  }

  return (
    <HomeTimelineContext.Provider value={timelineData}>
      <PushTimelineContext.Provider value={pushTimeline}>
        <Updater />
        {children}
      </PushTimelineContext.Provider>
    </HomeTimelineContext.Provider>
  )
}

const Updater = () => {
  const token = useContext(TokenContext)

  if (token?.access_token != null) {
    
  }
  return null
}
