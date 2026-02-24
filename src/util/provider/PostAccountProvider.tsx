'use client'

import type { Entity } from 'megalodon'
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from 'react'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

export type VerifiedAccount = {
  account: Entity.Account
  index: number
}

export const PostAccountContext = createContext<VerifiedAccount[]>([])

export const SelectedAppIndexContext = createContext<number>(0)

export const SetSelectedAppIndexContext = createContext<
  Dispatch<SetStateAction<number>>
>(() => {})

export const PostAccountProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const apps = useContext(AppsContext)
  const [selectedAppIndex, setSelectedAppIndex] = useState(0)
  const [accounts, setAccounts] = useState<VerifiedAccount[]>([])

  useEffect(() => {
    if (apps.length <= 0) {
      setAccounts([])
      return
    }

    ;(async () => {
      try {
        const results = await Promise.allSettled(
          apps.map((app, index) => {
            const client = GetClient(app)
            return client
              .verifyAccountCredentials()
              .then((res) => ({ account: res.data, index }))
          }),
        )
        const fulfilled = results
          .filter(
            (r): r is PromiseFulfilledResult<VerifiedAccount> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value)
        setAccounts(fulfilled)
        setSelectedAppIndex((prev) => {
          if (fulfilled.some((a) => a.index === prev)) return prev
          return fulfilled.length > 0 ? fulfilled[0].index : 0
        })
      } catch (error) {
        console.error('Failed to verify account credentials:', error)
      }
    })()
  }, [apps])

  return (
    <PostAccountContext.Provider value={accounts}>
      <SelectedAppIndexContext.Provider value={selectedAppIndex}>
        <SetSelectedAppIndexContext.Provider value={setSelectedAppIndex}>
          {children}
        </SetSelectedAppIndexContext.Provider>
      </SelectedAppIndexContext.Provider>
    </PostAccountContext.Provider>
  )
}
