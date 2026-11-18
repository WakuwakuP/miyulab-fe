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

// Persist only a credential fingerprint and the verified ID for offline row mapping.
async function timelineAccountId(app: App, verifiedId?: string) {
  const token = app.tokenData?.access_token
  if (!token) return verifiedId
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify([app.backendUrl, token])),
    )
    const key =
      'timeline-login:' +
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    if (verifiedId) localStorage.setItem(key, verifiedId)
    return verifiedId ?? localStorage.getItem(key) ?? undefined
  } catch {
    return verifiedId
  }
}

export const TimelineAccountIdsContext = createContext<
  readonly (string | undefined)[]
>([])
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
  const [timelineIds, setTimelineIds] = useState<(string | undefined)[]>([])
  const [prevApps, setPrevApps] = useState(apps)

  // Synchronously clear stale accounts when apps changes (before children render)
  // This prevents stale account indices from referencing out-of-bounds apps
  if (apps !== prevApps) {
    setPrevApps(apps)
    setAccounts(null)
    setTimelineIds([])
  }

  useEffect(() => {
    if (apps.length <= 0) {
      setAccounts([])
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        const shared = apps.map((app, i) =>
          apps.some(
            (other, j) => j !== i && other.backendUrl === app.backendUrl,
          ),
        )
        const verification = Promise.allSettled(
          apps.map((app, index) => verifyAppAccount(app, index)),
        )
        if (cancelled) return
        const cachedIds = await Promise.all(
          apps.map((app, i) =>
            shared[i] ? timelineAccountId(app) : undefined,
          ),
        )
        if (cancelled) return
        setTimelineIds(cachedIds)
        const results = await verification
        if (cancelled) return
        const fulfilled = results
          .filter(
            (r): r is PromiseFulfilledResult<VerifiedAccount> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value)
        const ids = await Promise.all(
          apps.map((app, i) => {
            const result = results[i]
            const id =
              result.status === 'fulfilled'
                ? result.value.account.id
                : undefined
            return shared[i] && id
              ? timelineAccountId(app, id)
              : (id ?? cachedIds[i])
          }),
        )
        if (cancelled) return
        setTimelineIds(ids)
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
    <TimelineAccountIdsContext.Provider value={timelineIds}>
      <AccountVerificationReadyContext.Provider value={accounts !== null}>
        <PostAccountContext.Provider value={accounts ?? []}>
          <SelectedAppIndexContext.Provider value={selectedAppIndex}>
            <SetSelectedAppIndexContext.Provider value={setSelectedAppIndex}>
              {children}
            </SetSelectedAppIndexContext.Provider>
          </SelectedAppIndexContext.Provider>
        </PostAccountContext.Provider>
      </AccountVerificationReadyContext.Provider>
    </TimelineAccountIdsContext.Provider>
  )
}
