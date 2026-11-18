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
import type { App } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'
import { verifyLogin } from 'util/verifiedLogin'

export type VerifiedAccount = {
  account: Entity.Account
  index: number
}

function verifyAppAccount(app: App, index: number): Promise<VerifiedAccount> {
  return verifyLogin(app).then((account) => ({ account, index }))
}

export const AccountVerificationReadyContext = createContext(false)

export const PostAccountContext = createContext<VerifiedAccount[]>([])

export const SelectedAppIndexContext = createContext<number>(0)

export const SetSelectedAppIndexContext = createContext<
  Dispatch<SetStateAction<number>>
>(() => {})

function pickSelectedAppIndex(
  fulfilled: VerifiedAccount[],
  previousIndex: number,
): number {
  if (fulfilled.some(({ index }) => index === previousIndex)) {
    return previousIndex
  }
  return fulfilled.length > 0 ? fulfilled[0].index : 0
}

export const PostAccountProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const apps = useContext(AppsContext)
  const [selectedAppIndex, setSelectedAppIndex] = useState(0)
  const [accounts, setAccounts] = useState<VerifiedAccount[] | null>(null)
  const [prevApps, setPrevApps] = useState(apps)

  // Synchronously clear stale accounts when apps changes (before children render)
  // This prevents stale account indices from referencing out-of-bounds apps
  if (apps !== prevApps) {
    setPrevApps(apps)
    setAccounts(null)
  }

  useEffect(() => {
    if (apps.length <= 0) {
      setAccounts([])
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        const results = await Promise.allSettled(
          apps.map((app, index) => verifyAppAccount(app, index)),
        )
        if (cancelled) return
        const fulfilled = results
          .filter(
            (r): r is PromiseFulfilledResult<VerifiedAccount> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value)
        setAccounts(fulfilled)
        setSelectedAppIndex((prev) => pickSelectedAppIndex(fulfilled, prev))
      } catch (error) {
        console.error('Failed to verify account credentials:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apps])

  return (
    <AccountVerificationReadyContext.Provider value={accounts !== null}>
      <PostAccountContext.Provider value={accounts ?? []}>
        <SelectedAppIndexContext.Provider value={selectedAppIndex}>
          <SetSelectedAppIndexContext.Provider value={setSelectedAppIndex}>
            {children}
          </SetSelectedAppIndexContext.Provider>
        </SelectedAppIndexContext.Provider>
      </PostAccountContext.Provider>
    </AccountVerificationReadyContext.Provider>
  )
}
