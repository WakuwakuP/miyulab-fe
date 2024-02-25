'use client'

import generator, { Entity } from 'megalodon'
import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { BACKEND_URL } from 'util/environment'
import { TokenContext } from 'util/provider/AppProvider'
import { Status } from 'app/_parts/Status'
import { Panel } from 'app/_parts/Panel'

export const TagTimeline = ({ tag }: { tag: string }) => {
  const refFirstRef = useRef(true)
  const token = useContext(TokenContext)
  const [timeline, setTimeline] = useState<Entity.Status[]>(
    []
  )

  useEffect(() => {
    if (
      process.env.NODE_ENV === 'development' &&
      refFirstRef.current
    ) {
      refFirstRef.current = false
      return
    }
    if (!token) return
    const client = generator(
      'pleroma',
      `https://${BACKEND_URL}`,
      token?.access_token
    )

    const streamClient = generator(
      'pleroma',
      `wss://${BACKEND_URL}`,
      token?.access_token
    )
    client
      .getTagTimeline(tag, { limit: 40 })
      .then((res) => {
        setTimeline(res.data)
      })

    const stream = streamClient.tagSocket(tag)

    stream.on('update', (status) => {
      if (status.media_attachments.length > 0) {
        setTimeline((prev) => [status, ...prev])
      }
    })
  }, [])

  return (
    <Panel name={`#${tag}`}>
      {timeline.map((status) => (
        <Status
          key={status.id}
          status={status}
        />
      ))}
    </Panel>
  )
}
