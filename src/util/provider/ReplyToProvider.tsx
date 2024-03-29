'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useState,
} from 'react'

import { Entity } from 'megalodon'

export const ReplyToContext = createContext<
  Entity.Status | undefined
>(undefined)
export const SetReplyToContext = createContext<
  Dispatch<SetStateAction<Entity.Status | undefined>>
>(() => {})

export const ReplyToProvider = ({
  children,
}: Readonly<{
  children: ReactNode
}>) => {
  const [replyTo, setReplyTo] = useState<
    Entity.Status | undefined
  >(undefined)

  return (
    <ReplyToContext.Provider value={replyTo}>
      <SetReplyToContext.Provider value={setReplyTo}>
        {children}
      </SetReplyToContext.Provider>
    </ReplyToContext.Provider>
  )
}
