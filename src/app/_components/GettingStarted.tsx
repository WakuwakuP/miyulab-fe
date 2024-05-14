'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { type Entity, type Response } from 'megalodon'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'

import { SettingPanel } from 'app/_components/SettingPanel'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

export const GettingStarted = () => {
  const apps = useContext(AppsContext)
  const [selected, setSelected] = useState<
    'bookmark' | 'dm' | 'setting' | null
  >(null)

  const [title, setTitle] = useState<string>(
    'Getting Started'
  )

  const [bookmarks, setBookmarks] = useState<
    Entity.Status[]
  >([])

  const [conversations, setConversations] = useState<
    Entity.Conversation[]
  >([])

  const [isScrolling, setIsScrolling] = useState(false)

  const [maxId, setMaxId] = useState<string | null>(null)

  const setMaxIdCallback = useCallback(
    (res: Response<Entity.Status[]>) => {
      if (res.headers.link == null) {
        setMaxId(null)
        return
      }
      const links = (res.headers.link as string)
        .split(',')
        .map((link: string) => {
          const [url, rel] = link.split(';')
          return {
            url: url.replace(/[<>]/g, '').trim(),
            rel: rel
              .replace(/"/g, '')
              .replace('rel=', '')
              .trim(),
          }
        })
      const next = links.find((link) => link.rel === 'next')

      if (next == null) {
        setMaxId(null)
        return
      }

      const maxId = new URL(next.url).searchParams.get(
        'max_id'
      )

      if (maxId == null) {
        setMaxId(null)
        return
      }

      setMaxId(maxId)
    },
    [setMaxId]
  )

  useEffect(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    switch (selected) {
      case 'bookmark':
        setTitle('Bookmark')
        client
          .getBookmarks({
            limit: 20,
          })
          .then((res) => {
            setBookmarks(res.data)
            setMaxIdCallback(res)
          })
        break
      case 'dm':
        setTitle('Direct Message')
        client.getConversationTimeline().then((res) => {
          setConversations(res.data)
        })
        break
      default:
        setTitle('Getting Started')
        break
    }
  }, [apps, selected, setMaxIdCallback])

  const moreBookmarks = useCallback(() => {
    if (apps.length <= 0) return
    if (maxId === null) return
    const client = GetClient(apps[0])

    client
      .getBookmarks({
        limit: 20,
        max_id: maxId,
      })
      .then((res) => {
        setBookmarks((prev) => [...prev, ...res.data])
        setMaxIdCallback(res)
      })
  }, [apps, maxId, setMaxIdCallback])

  const moreConversations = useCallback(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client
      .getConversationTimeline({
        max_id: conversations[conversations.length - 1].id,
      })
      .then((res) => {
        setConversations((prev) => [...prev, ...res.data])
      })
  }, [apps, conversations])

  return (
    <Panel name={title}>
      <div className="box-border">
        {selected !== null ? (
          <button
            className="flex rounded-md border pr-4 text-xl text-blue-500"
            onClick={() => setSelected(null)}
          >
            <RiArrowLeftSLine size={30} />
            <span>戻る</span>
          </button>
        ) : (
          <>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('bookmark')}
            >
              Bookmark
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('dm')}
            >
              Direct Message
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('setting')}
            >
              Setting
            </button>
          </>
        )}
      </div>
      {selected === 'bookmark' && (
        <div className="h-[calc(100%-32px)]">
          <Virtuoso
            data={bookmarks}
            endReached={moreBookmarks}
            isScrolling={setIsScrolling}
            itemContent={(_, status) => (
              <Status
                key={status.id}
                status={status}
                scrolling={isScrolling}
              />
            )}
          />
        </div>
      )}
      {selected === 'dm' && (
        <div className="h-[calc(100%-32px)]">
          <Virtuoso
            data={conversations}
            endReached={moreConversations}
            isScrolling={setIsScrolling}
            itemContent={(_, conversation) => (
              <div key={conversation.id}>
                {conversation.last_status != null && (
                  <Status
                    status={conversation.last_status}
                    scrolling={isScrolling}
                  />
                )}
              </div>
            )}
          />
        </div>
      )}
      {selected === 'setting' && (
        <div className="h-[calc(100%-32px)]">
          <SettingPanel />
        </div>
      )}
    </Panel>
  )
}
