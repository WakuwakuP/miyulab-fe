'use client'

import { DatabaseStatsPanel } from 'app/_components/DatabaseStatsPanel'
import { HashtagHistory } from 'app/_components/HashtagHistory'
import { SettingPanel } from 'app/_components/SettingPanel'
import { TimelineManagement } from 'app/_components/TimelineManagement'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import type { Entity, Response } from 'megalodon'
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { CiWarning } from 'react-icons/ci'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'
import type { StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import {
  navigatePanel,
  routeToAccountIndex,
  routeToView,
  usePanelRoute,
} from 'util/panelNavigation'
import { AppsContext } from 'util/provider/AppsProvider'

import { AccountsPanel } from './AccountsPanel'

export const GettingStarted = () => {
  const apps = useContext(AppsContext)
  const route = usePanelRoute()
  const selected = routeToView(route)
  const appIndex = routeToAccountIndex(route)

  const title = useMemo(() => {
    switch (selected) {
      case 'bookmark':
        return 'Bookmark'
      case 'dm':
        return 'Direct Message'
      default:
        return 'Getting Started'
    }
  }, [selected])

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

  const setMaxIdEvent = useEffectEvent(setMaxId)
  const setMaxIdCallback = useCallback(
    (res: Response<Entity.Status[]>, index: number) => {
      if (res.headers.link == null) {
        setMaxIdEvent((prev) => ({
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
            rel: rel.replace(/"/g, '').replace('rel=', '').trim(),
            url: url.replace(/[<>]/g, '').trim(),
          }
        })
      const next = links.find((link) => link.rel === 'next')

      if (next == null) {
        setMaxIdEvent((prev) => ({
          ...prev,
          [index]: null,
        }))
        return
      }

      const maxId = new URL(next.url).searchParams.get('max_id')

      if (maxId == null) {
        setMaxIdEvent((prev) => ({
          ...prev,
          [index]: null,
        }))
        return
      }

      setMaxIdEvent((prev) => ({
        ...prev,
        [index]: maxId,
      }))
    },
    [],
  )

  useEffect(() => {
    if (apps.length <= 0) return

    const client = GetClient(apps[appIndex])

    switch (selected) {
      case 'bookmark':
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
          .catch((error) => {
            console.error('Failed to fetch bookmarks:', error)
          })
        break
      case 'dm':
        client
          .getConversationTimeline()
          .then((res) => {
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
          .catch((error) => {
            console.error('Failed to fetch conversations:', error)
          })
        break
      default:
        break
    }
  }, [appIndex, apps, selected, setMaxIdCallback])

  const moreBookmarks = useCallback(() => {
    if (apps.length <= 0) return
    if (maxId[appIndex] === null) return
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
      .catch((error) => {
        console.error('Failed to fetch more bookmarks:', error)
      })
  }, [appIndex, apps, maxId, setMaxIdCallback])

  const moreConversations = useCallback(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[appIndex])

    client
      .getConversationTimeline({
        max_id: conversations[appIndex][conversations[appIndex].length - 1].id,
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
      .catch((error) => {
        console.error('Failed to fetch more conversations:', error)
      })
  }, [appIndex, apps, conversations])

  return (
    <Panel name={title}>
      <div className="box-border">
        {selected !== null ? (
          <button
            className="flex rounded-md border pr-4 text-xl text-blue-500"
            onClick={() => navigatePanel('/')}
            type="button"
          >
            <RiArrowLeftSLine size={30} />
            <span>戻る</span>
          </button>
        ) : (
          <>
            {apps.map((app, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: App には index で key を付ける
              <Fragment key={index}>
                <div className="flex w-full items-center space-x-2 border-b px-4 py-2 text-xl">
                  {app.tokenData == null && (
                    <button
                      className="text-orange-500 hover:text-orange-300"
                      onClick={() => {
                        localStorage.setItem(
                          'processingAppData',
                          JSON.stringify({ ...app, index }),
                        )
                        window.location.href = app.appData.url as string
                      }}
                      type="button"
                    >
                      <CiWarning size={24} />
                    </button>
                  )}
                  <span>{app.backendUrl}</span>
                </div>
                <button
                  className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
                  onClick={() => navigatePanel(`/bookmark/${index}`)}
                  type="button"
                >
                  Bookmark
                </button>
                <button
                  className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
                  onClick={() => navigatePanel(`/dm/${index}`)}
                  type="button"
                >
                  Direct Message
                </button>
              </Fragment>
            ))}
            <div className="w-full border-b px-4 py-2 text-xl">Setting</div>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => navigatePanel('/setting')}
              type="button"
            >
              Setting
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => navigatePanel('/timeline')}
              type="button"
            >
              Timeline Management
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => navigatePanel('/accounts')}
              type="button"
            >
              Accounts
            </button>
            <button
              className="w-full border-b px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => navigatePanel('/database')}
              type="button"
            >
              Database
            </button>
            <HashtagHistory />
          </>
        )}
      </div>
      {apps.map((_app, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: App には index で key を付ける
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
                        scrolling={isScrolling}
                        status={status}
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
                        {conversation.last_status != null && (
                          <Status
                            scrolling={isScrolling}
                            status={{
                              ...conversation.last_status,
                              appIndex: index,
                            }}
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

      {selected === 'timeline' && (
        <div className="h-[calc(100%-32px)]">
          <TimelineManagement />
        </div>
      )}

      {selected === 'accounts' && (
        <div className="h-[calc(100%-32px)]">
          <AccountsPanel />
        </div>
      )}

      {selected === 'database' && (
        <div className="h-[calc(100%-32px)]">
          <DatabaseStatsPanel />
        </div>
      )}
    </Panel>
  )
}
