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
import { TokenContext } from 'util/provider/AppProvider'

export const HashtagDetail = ({
  hashtag,
}: {
  hashtag?: string
}) => {
  const token = useContext(TokenContext)
  const [statuses, setStatuses] = useState<Entity.Status[]>(
    []
  )

  useEffect(() => {
    if (token === null) return
    if (hashtag === undefined) return

    const client = GetClient(token?.access_token)

    setStatuses([])
    client
      .getTagTimeline(hashtag, {
        limit: 50,
      })
      .then((res) => {
        setStatuses(res.data)
      })
  }, [hashtag, token])

  const moreStatus = useCallback(() => {
    if (token === null) return
    if (hashtag === undefined) return

    const client = GetClient(token?.access_token)

    client
      .getTagTimeline(hashtag, {
        limit: 50,
        max_id: statuses[statuses.length - 1].id,
      })
      .then((res) => {
        setStatuses((prev) => [...prev, ...res.data])
      })
  }, [hashtag, statuses, token])

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
