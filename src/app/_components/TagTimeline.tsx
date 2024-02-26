'use client'

import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Entity } from 'megalodon'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { GetClient, GetStreamClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

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
    if (token == null) return
    const client = GetClient(token?.access_token)

    const streamClient = GetStreamClient(
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
        setTimeline((prev) =>
          ArrayLengthControl([status, ...prev])
        )
      }
    })
    stream.on('connect', () => {
      // eslint-disable-next-line no-console
      console.info('connected tagSocket')
    })
  }, [tag, token])

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
