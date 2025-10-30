'use client'

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useState,
} from 'react'

import type { AccountAddAppIndex, StatusAddAppIndex } from 'types/types'

export type DetailType = 'Account' | 'Status' | 'SearchUser' | 'Hashtag' | null

export type SetDetailParams =
  | {
      type: 'Account'
      content: AccountAddAppIndex
    }
  | {
      type: 'Status'
      content: StatusAddAppIndex
    }
  | {
      type: 'SearchUser'
      content: string | undefined
      appIndex: number
    }
  | {
      type: 'Hashtag'
      content: string | undefined
    }
  | {
      type: null
      content: null
    }

export const DetailContext = createContext<SetDetailParams>({
  content: null,
  type: null,
})

export const SetDetailContext = createContext<
  Dispatch<SetStateAction<SetDetailParams>>
>(() => {})

export const DetailProvider = ({ children }: { children: ReactNode }) => {
  const [detail, setDetail] = useState<SetDetailParams>({
    content: null,
    type: null,
  })

  return (
    <DetailContext.Provider value={detail}>
      <SetDetailContext.Provider value={setDetail}>
        {children}
      </SetDetailContext.Provider>
    </DetailContext.Provider>
  )
}
