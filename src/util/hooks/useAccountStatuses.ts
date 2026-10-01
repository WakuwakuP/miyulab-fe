'use client'

import type { Entity } from 'megalodon'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { App } from 'types/types'
import { GetClient } from 'util/GetClient'

export function updateAccountStatus(
  status: Entity.Status,
  statusId: string,
  updates: Partial<Entity.Status>,
) {
  if (status.id !== statusId && status.reblog?.id !== statusId) return status
  return {
    ...status,
    ...updates,
    reblog:
      status.reblog?.id === statusId
        ? { ...status.reblog, ...updates }
        : status.reblog,
  }
}

export function mergeAccountStatusPage(
  statuses: Entity.Status[],
  page: Entity.Status[],
) {
  const ids = new Set(statuses.map((status) => status.id))
  const additions = page.filter((status) => {
    if (ids.has(status.id)) return false
    ids.add(status.id)
    return true
  })
  return {
    hasMore: additions.length > 0 && page.at(-1)?.id !== statuses.at(-1)?.id,
    statuses: [...statuses, ...additions],
  }
}

export function useAccountStatuses(
  app: App | undefined,
  accountId: string,
  onlyMedia = false,
) {
  const [page, setPage] = useState({
    error: false,
    hasMore: true,
    isLoading: false,
    statuses: [] as Entity.Status[],
  })
  const loadMoreRef = useRef<(() => Promise<void>) | null>(null)
  const updateStatusRef = useRef<
    ((statusId: string, updates: Partial<Entity.Status>) => void) | null
  >(null)

  useEffect(() => {
    let cancelled = false
    let isLoading = false
    let hasMore = true
    let statuses: Entity.Status[] = []
    let maxId: string | undefined
    const updatesById = new Map<string, Partial<Entity.Status>>()
    const client = app ? GetClient(app) : undefined

    const loadMore = async () => {
      if (cancelled || isLoading || !hasMore || !client || !accountId) return
      isLoading = true
      setPage({ error: false, hasMore, isLoading: true, statuses })
      try {
        const res = await client.getAccountStatuses(accountId, {
          limit: 40,
          max_id: maxId,
          only_media: onlyMedia,
        })
        if (cancelled) return
        const updated = res.data.map((status) => {
          const statusId = status.reblog?.id ?? status.id
          const updates = updatesById.get(statusId)
          return updates
            ? updateAccountStatus(status, statusId, updates)
            : status
        })
        const merged = mergeAccountStatusPage(statuses, updated)
        statuses = merged.statuses
        hasMore = merged.hasMore
        maxId = res.data.at(-1)?.id
        setPage({ error: false, hasMore, isLoading: false, statuses })
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch account statuses:', error)
        setPage({ error: true, hasMore, isLoading: false, statuses })
      } finally {
        isLoading = false
      }
    }

    setPage({ error: false, hasMore: true, isLoading: false, statuses })
    loadMoreRef.current = loadMore
    updateStatusRef.current = (statusId, updates) => {
      if (cancelled) return
      updatesById.set(statusId, { ...updatesById.get(statusId), ...updates })
      statuses = statuses.map((status) =>
        updateAccountStatus(status, statusId, updates),
      )
      setPage((prev) => ({ ...prev, statuses }))
    }
    void loadMore()
    return () => {
      cancelled = true
    }
  }, [app, accountId, onlyMedia])

  const loadMore = useCallback(() => {
    void loadMoreRef.current?.()
  }, [])
  const updateStatus = useCallback(
    (statusId: string, updates: Partial<Entity.Status>) => {
      updateStatusRef.current?.(statusId, updates)
    },
    [],
  )

  return { ...page, loadMore, updateStatus }
}
