'use client'

import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { type Entity, type Response } from 'megalodon'
import { CiWarning } from 'react-icons/ci'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'

import { SettingPanel } from 'app/_components/SettingPanel'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { type StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'

import { AccountsPanel } from './AccountsPanel'

export const GettingStarted = () => {
  const apps = useContext(AppsContext)
  const [appIndex, setAppIndex] = useState(0)
  const [selected, setSelected] = useState<
    'bookmark' | 'dm' | 'setting' | 'accounts' | null
  >(null)

  const [title, setTitle] = useState<string>(
    'Getting Started'
  )

  const [bookmarks, setBookmarks] = useState<{
    [key: number]: StatusAddAppIndex[]
  }>(Array.from({ length: apps.length }, () => []))

  const [conversations, setConversations] = useState<{
    [key: number]: Entity.Conversation[]
  }>(Array.from({ length: apps.length }, () => []))

  const [isScrolling, setIsScrolling] = useState(false)

  const [maxId, setMaxId] = useState<{
    [key: number]: string | null
  }>(Array.from({ length: apps.length }, () => null))

  const setMaxIdCallback = useCallback(
    (res: Response<Entity.Status[]>, index: number) => {
      if (res.headers.link == null) {
        setMaxId((prev) => ({
          ...prev,
          [index]: null,
        }))
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
        setMaxId((prev) => ({
          ...prev,
          [index]: null,
        }))
        return
      }

      const maxId = new URL(next.url).searchParams.get(
        'max_id'
      )

      if (maxId == null) {
        setMaxId((prev) => ({
          ...prev,
          [index]: null,
        }))
        return
      }

      setMaxId((prev) => ({
        ...prev,
        [index]: maxId,
      }))
    },
    [setMaxId]
  )

  useEffect(() => {
    if (apps.length <= 0) return

    const client = GetClient(apps[appIndex])

    switch (selected) {
      case 'bookmark':
        setTitle('Bookmark')
        client
          .getBookmarks({
            limit: 20,
          })
          .then((res) => {
            setBookmarks((prev) => ({
              ...prev,
              [appIndex]: res.data.map((status) => ({
                ...status,
                appIndex: appIndex,
              })),
            }))
            setMaxIdCallback(res, appIndex)
          })
        break
      case 'dm':
        setTitle('Direct Message')
        client.getConversationTimeline().then((res) => {
          setConversations((prev) => ({
            ...prev,
            [appIndex]: res.data.map((conversation) => {
              return {
                ...conversation,
                appIndex: appIndex,
              }
            }),
          }))
        })
        break
      default:
        setTitle('Getting Started')
        break
    }
  }, [appIndex, apps, selected, setMaxIdCallback])

  const moreBookmarks = useCallback(() => {
    if (apps.length <= 0) return
    if (maxId === null) return
    const client = GetClient(apps[appIndex])

    client
      .getBookmarks({
        limit: 20,
        max_id: maxId[appIndex] ?? undefined,
      })
      .then((res) => {
        setBookmarks((prev) => ({
          ...prev,
          [appIndex]: [
            ...prev[appIndex],
            ...res.data.map((status) => ({
              ...status,
              appIndex: appIndex,
            })),
          ],
        }))
        setMaxIdCallback(res, appIndex)
      })
  }, [appIndex, apps, maxId, setMaxIdCallback])

  const moreConversations = useCallback(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[appIndex])

    client
      .getConversationTimeline({
        max_id:
          conversations[appIndex][
            conversations[appIndex].length - 1
          ].id,
      })
      .then((res) => {
        setConversations((prev) => ({
          ...prev,
          [appIndex]: [
            ...prev[appIndex],
            ...res.data.map((conversation) => {
              return {
                ...conversation,
                appIndex: appIndex,
              }
            }),
          ],
        }))
      })
  }, [appIndex, apps, conversations])

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
            {apps.map((app, index) => (
              <Fragment key={index}>
                <div className="flex w-full items-center space-x-2 border-b px-4 py-2 text-xl">
                  {app.tokenData == null && (
                    <button
                      className="text-orange-500 hover:text-orange-300"
                      onClick={() => {
                        localStorage.setItem(
                          'processingAppData',
                          JSON.stringify({ ...app, index })
                        )
                        window.location.href = app.appData
                          .url as string
                      }}
                    >
                      <CiWarning size={24} />
                    </button>
                  )}
                  <span>{app.backendUrl}</span>
                </div>
                <button
                  className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
                  onClick={() => {
                    setAppIndex(index)
                    setSelected('bookmark')
                  }}
                >
                  Bookmark
                </button>
                <button
                  className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
                  onClick={() => {
                    setAppIndex(index)
                    setSelected('dm')
                  }}
                >
                  Direct Message
                </button>
              </Fragment>
            ))}
            <div className="w-full border-b px-4 py-2 text-xl">
              Setting
            </div>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('setting')}
            >
              Setting
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('accounts')}
            >
              Accounts
            </button>
          </>
        )}
      </div>
      {apps.map((_app, index) => (
        <Fragment key={index}>
          {appIndex === index && (
            <>
              {selected === 'bookmark' && (
                <div className="h-[calc(100%-32px)]">
                  <Virtuoso
                    data={bookmarks[index]}
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
                    data={conversations[index]}
                    endReached={moreConversations}
                    isScrolling={setIsScrolling}
                    itemContent={(_, conversation) => (
                      <div key={conversation.id}>
                        {conversation.last_status !=
                          null && (
                          <Status
                            status={{
                              ...conversation.last_status,
                              appIndex: index,
                            }}
                            scrolling={isScrolling}
                          />
                        )}
                      </div>
                    )}
                  />
                </div>
              )}
            </>
          )}
        </Fragment>
      ))}

      {selected === 'setting' && (
        <div className="h-[calc(100%-32px)]">
          <SettingPanel />
        </div>
      )}

      {selected === 'accounts' && (
        <div className="h-[calc(100%-32px)]">
          <AccountsPanel />
        </div>
      )}
    </Panel>
  )
}
