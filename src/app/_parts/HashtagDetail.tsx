import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'
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

  if (hashtag === undefined) return null

  return (
    <Virtuoso
      data={statuses}
      itemContent={(_, status) => (
        <Status
          key={status.id}
          status={status}
        />
      )}
    />
  )
}
