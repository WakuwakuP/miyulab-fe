'use client'

import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { Entity } from 'megalodon'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'

export const TagTimeline = ({ tag }: { tag: string }) => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const token = useContext(TokenContext)
  const setTags = useContext(SetTagsContext)

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

    client
      .getTagTimeline(tag, { limit: 40 })
      .then((res) => {
        setTimeline(res.data)
      })

    client.tagStreaming(tag).then((stream) => {
      stream.on('update', (status: Entity.Status) => {
        setTags((prev) =>
          Array.from(
            new Set([
              ...prev,
              ...status.tags.map((tag) => tag.name),
            ])
          )
        )
        if (status.media_attachments.length > 0) {
          setTimeline((prev) =>
            ArrayLengthControl([status, ...prev])
          )
        }
      })
      stream.on('connect', () => {
        // eslint-disable-next-line no-console
        console.info('connected tagStreaming')
      })

      stream.on('delete', (id: string) => {
        setTimeline((prev) =>
          prev.filter((status) => status.id !== id)
        )
      })

      stream.on('error', (err: Error) => {
        console.error(err)

        stream.stop()
        const timeout = setTimeout(() => {
          stream.start()
          // eslint-disable-next-line no-console
          console.info('reconnected tagSocket')
          clearTimeout(timeout)
        }, 1000)
      })
    })
  }, [setTags, tag, token])

  const scrollToTop = () => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        index: 0,
        behavior: 'smooth',
      })
    }
  }

  return (
    <Panel
      name={`#${tag}`}
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      <Virtuoso
        data={timeline}
        ref={scrollerRef}
        itemContent={(_, status) => (
          <Status
            key={status.id}
            status={status}
          />
        )}
      />
    </Panel>
  )
}
