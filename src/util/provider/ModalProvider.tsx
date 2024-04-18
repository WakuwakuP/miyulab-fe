'use client'

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useState,
} from 'react'

import { type Entity } from 'megalodon'

export const MediaModalContext = createContext<{
  attachment: Entity.Attachment[]
  index: number | null
}>({
  attachment: [],
  index: null,
})

export const SetMediaModalContext = createContext<
  Dispatch<
    SetStateAction<{
      attachment: Entity.Attachment[]
      index: number | null
    }>
  >
>(() => {})

export const MediaModalProvider = ({
  children,
}: Readonly<{
  children: ReactNode
}>) => {
  const [attachment, setAttachment] = useState<{
    attachment: Entity.Attachment[]
    index: number | null
  }>({
    attachment: [],
    index: null,
  })

  return (
    <MediaModalContext.Provider value={attachment}>
      <SetMediaModalContext.Provider value={setAttachment}>
        {children}
      </SetMediaModalContext.Provider>
    </MediaModalContext.Provider>
  )
}
