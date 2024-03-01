import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'

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
    <div>
      {statuses.map((status) => (
        <Status
          key={status.id}
          status={status}
        />
      ))}
    </div>
  )
}
