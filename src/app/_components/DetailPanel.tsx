'use client'

import { AccountDetail } from 'app/_parts/AccountDetail'
import { HashtagDetail } from 'app/_parts/HashtagDetail'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { useContext, useEffect, useState } from 'react'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'
import type { StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { DetailContext, SetDetailContext } from 'util/provider/DetailProvider'

import { GettingStarted } from './GettingStarted'

export const DetailPanel = () => {
  const apps = useContext(AppsContext)
  const detail = useContext(DetailContext)
  const setDetail = useContext(SetDetailContext)

  const [context, setContext] = useState<StatusAddAppIndex[]>([])

  useEffect(() => {
    if (apps.length <= 0 || detail.content == null) return

    if (detail.type === 'Status') {
      const client = GetClient(apps[detail.content.appIndex])

      client.getStatusContext(detail.content.id).then((res) => {
        setContext([
          ...(res.data.ancestors.map((status) => ({
            ...status,
            appIndex: detail.content.appIndex,
          })) ?? []),
          detail.content,
          ...(res.data.descendants.map((status) => ({
            ...status,
            appIndex: detail.content.appIndex,
          })) ?? []),
        ])
      })
    }

    if (detail.type === 'SearchUser') {
      const client = GetClient(apps[detail.appIndex])

      client.getAccount(detail.content).then((res) => {
        setDetail({
          content: {
            ...res.data,
            appIndex: detail.appIndex,
          },
          type: 'Account',
        })
      })
    }
  }, [apps, detail, detail.content, detail.type, setDetail])

  const panelNames = {
    Account: 'Profile',
    Hashtag:
      typeof detail.content == 'string' ? `#${detail.content}` : 'Hashtag',
    SearchUser: 'Profile',
    Status: 'Toot and Reply',
  }

  if (detail.type === null) {
    return <GettingStarted />
  }

  return (
    <Panel name={panelNames[detail.type]}>
      <div>
        <button
          className="flex rounded-md border pr-4 text-xl text-blue-500"
          onClick={() =>
            setDetail({
              content: null,
              type: null,
            })
          }
        >
          <RiArrowLeftSLine size={30} />
          <span>戻る</span>
        </button>
      </div>
      {detail.type === 'Status' && (
        <div className="h-[calc(100%-32px)]">
          <Virtuoso
            data={context}
            itemContent={(_, status) => (
              <Status key={status.id} status={status} />
            )}
          />
        </div>
      )}

      {detail.type === 'Account' && (
        <div className="h-[calc(100%-32px)] overflow-y-scroll scroll-smooth">
          <AccountDetail account={detail.content} />
        </div>
      )}
      {detail.type === 'Hashtag' && (
        <div className="h-[calc(100%-32px)]">
          <HashtagDetail hashtag={detail.content} />
        </div>
      )}
    </Panel>
  )
}
