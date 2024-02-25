'use client'
import Image from 'next/image'
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

export const PublicTimeline = () => {
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
    if (token == null) return
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
      .getPublicTimeline({ limit: 40, only_media: true })
      .then((res) => {
        setTimeline(res.data)
        const stream = streamClient.publicSocket()

        stream.on('update', (status) => {
          if (status.media_attachments.length > 0) {
            setTimeline((prev) => [status, ...prev])
          }
        })
      })
  }, [token])

  return (
    <section>
      <h3>Public</h3>
      {timeline.map((status) => (
        <Status
          key={status.id}
          status={status}
        />
      ))}
    </section>
  )
}
