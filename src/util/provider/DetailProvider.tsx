'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useState,
} from 'react'

import { Entity } from 'megalodon'

export type DetailType =
  | 'Account'
  | 'Status'
  | 'SearchUser'
  | 'Hashtag'
  | null

export type SetDetailParams =
  | {
      type: 'Account'
      content: Entity.Account
    }
  | {
      type: 'Status'
      content: Entity.Status
    }
  | {
      type: 'SearchUser'
      content: string | undefined
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
