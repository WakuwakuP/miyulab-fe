import { Status } from 'app/_parts/Status'
import { useCallback, useContext, useEffect, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import type { StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

export const HashtagDetail = ({ hashtag }: { hashtag?: string }) => {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<StatusAddAppIndex[]>([])

  useEffect(() => {
    if (apps.length <= 0) return
    if (hashtag === undefined) return

    const client = GetClient(apps[0])

    setStatuses([])
    client
      .getTagTimeline(hashtag, {
        limit: 50,
      })
      .then((res) => {
        setStatuses(
          res.data.map((status) => ({
            ...status,
            appIndex: 0,
          })),
        )
      })
  }, [apps, hashtag])

  const moreStatus = useCallback(() => {
    if (apps.length <= 0) return
    if (hashtag === undefined) return

    const client = GetClient(apps[0])

    client
      .getTagTimeline(hashtag, {
        limit: 50,
        max_id: statuses[statuses.length - 1].id,
      })
      .then((res) => {
        setStatuses((prev) => [
          ...prev,
          ...res.data.map((status) => ({
            ...status,
            appIndex: 0,
          })),
        ])
      })
  }, [apps, hashtag, statuses])

  if (hashtag === undefined) return null

  return (
    <Virtuoso
      data={statuses}
      endReached={moreStatus}
      itemContent={(_, status) => <Status key={status.id} status={status} />}
    />
  )
}
