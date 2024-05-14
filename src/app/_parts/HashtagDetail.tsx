import {
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { type Entity } from 'megalodon'
import { Virtuoso } from 'react-virtuoso'

import { Status } from 'app/_parts/Status'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

export const HashtagDetail = ({
  hashtag,
}: {
  hashtag?: string
}) => {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<Entity.Status[]>(
    []
  )

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
        setStatuses(res.data)
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
        setStatuses((prev) => [...prev, ...res.data])
      })
  }, [apps, hashtag, statuses])

  if (hashtag === undefined) return null

  return (
    <Virtuoso
      data={statuses}
      endReached={moreStatus}
      itemContent={(_, status) => (
        <Status
          key={status.id}
          status={status}
        />
      )}
    />
  )
}
