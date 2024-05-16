'use client'

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useState,
} from 'react'

import {
  type AccountAddAppIndex,
  type StatusAddAppIndex,
} from 'types/types'

export type DetailType =
  | 'Account'
  | 'Status'
  | 'SearchUser'
  | 'Hashtag'
  | null

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

export const DetailContext = createContext<SetDetailParams>(
  {
    type: null,
    content: null,
  }
)

export const SetDetailContext = createContext<
  Dispatch<SetStateAction<SetDetailParams>>
>(() => {})

export const DetailProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [detail, setDetail] = useState<SetDetailParams>({
    type: null,
    content: null,
  })

  return (
    <DetailContext.Provider value={detail}>
      <SetDetailContext.Provider value={setDetail}>
        {children}
      </SetDetailContext.Provider>
    </DetailContext.Provider>
  )
}
