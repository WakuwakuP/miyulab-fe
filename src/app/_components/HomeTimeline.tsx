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

export const HomeTimeline = () => {
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
    client.getHomeTimeline({ limit: 40 }).then((res) => {
      setTimeline(res.data)
    })

    const stream = streamClient.userSocket()

    stream.on('update', (status) => {
      setTimeline((prev) => [status, ...prev])
    })
  }, [])

  return (
    <section>
      <h3>Home</h3>
      {timeline.map((status) => (
        <Status
          key={status.id}
          status={status}
        />
      ))}
    </section>
  )
}
