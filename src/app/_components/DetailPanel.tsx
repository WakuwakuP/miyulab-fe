'use client'

import { AccountDetail } from 'app/_parts/AccountDetail'
import { HashtagDetail } from 'app/_parts/HashtagDetail'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import type { Entity } from 'megalodon'
import { useContext, useEffect, useState } from 'react'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'
import type { StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { useHashtagHistory } from 'util/hooks/useHashtagHistory'
import { AppsContext } from 'util/provider/AppsProvider'
import { DetailContext, SetDetailContext } from 'util/provider/DetailProvider'

import { GettingStarted } from './GettingStarted'

export const DetailPanel = () => {
  const apps = useContext(AppsContext)
  const detail = useContext(DetailContext)
  const setDetail = useContext(SetDetailContext)
  const { addHashtag } = useHashtagHistory()

  const [context, setContext] = useState<StatusAddAppIndex[]>([])

  useEffect(() => {
    if (apps.length <= 0 || detail.content == null) return

    if (detail.type === 'Status') {
      const client = GetClient(apps[detail.content.appIndex])

      client
        .getStatusContext(detail.content.id)
        .then((res) => {
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
        .catch((error) => {
          console.error('Failed to fetch status context:', error)
        })
    }

    if (detail.type === 'SearchUser' && detail.content) {
      const client = GetClient(apps[detail.appIndex])

      const resolveAsAccount = (account: Entity.Account) => {
        setDetail({
          content: {
            ...account,
            appIndex: detail.appIndex,
          },
          type: 'Account',
        })
      }

      // URL 形式の場合、acct を抽出する (https://domain/@user → user@domain)
      let searchQuery = detail.content
      if (/^https?:\/\//.test(searchQuery)) {
        try {
          const url = new URL(searchQuery)
          const pathMatch = url.pathname.match(/^\/(?:@|users\/)([^/@]+)\/?$/)
          if (pathMatch?.[1]) {
            searchQuery = `${pathMatch[1]}@${url.host}`
          }
        } catch {
          // URL パース失敗時はそのまま使用
        }
      }

      // 数値的な ID の場合は getAccount を優先し、失敗したら searchAccount にフォールバック
      // acct 形式 (user@host) は常に searchAccount を使用し、それ以外 (例: Misskey 英数字 ID) はまず getAccount を試行してから searchAccount にフォールバックする
      const isAcctFormat = /^@?\w[\w.-]*@[\w.-]+\.\w+$/.test(searchQuery)
      const isNumericId = /^\d+$/.test(searchQuery)
      if (isNumericId) {
        client
          .getAccount(searchQuery)
          .then((res) => resolveAsAccount(res.data))
          .catch((error) => {
            console.error('Failed to fetch account:', error)
            // getAccount 失敗時は searchAccount にフォールバック
            client
              .searchAccount(searchQuery, { limit: 5, resolve: true })
              .then((res) => {
                const found = res.data[0]
                if (found) resolveAsAccount(found)
              })
              .catch((fallbackError) => {
                console.error('Fallback search also failed:', fallbackError)
              })
          })
      } else if (isAcctFormat) {
        client
          .searchAccount(searchQuery, { limit: 5, resolve: true })
          .then((res) => {
            const found =
              res.data.find((a) => a.acct === searchQuery) ?? res.data[0]
            if (found) resolveAsAccount(found)
          })
          .catch((error) => {
            console.error('Failed to search account:', error)
          })
      } else {
        // Misskey 英数字 ID などの可能性: まず getAccount を試行し、失敗したら searchAccount
        client
          .getAccount(searchQuery)
          .then((res) => resolveAsAccount(res.data))
          .catch(() => {
            client
              .searchAccount(searchQuery, { limit: 5, resolve: true })
              .then((res) => {
                const found =
                  res.data.find((a) => a.acct === searchQuery) ?? res.data[0]
                if (found) resolveAsAccount(found)
              })
              .catch((error) => {
                console.error('Failed to search account:', error)
              })
          })
      }
    }
  }, [apps, detail, detail.content, detail.type, setDetail])

  useEffect(() => {
    if (detail.type === 'Hashtag' && typeof detail.content === 'string') {
      addHashtag(detail.content)
    }
  }, [detail.type, detail.content, addHashtag])

  const panelNames = {
    Account: 'Profile',
    Hashtag:
      typeof detail.content === 'string' ? `#${detail.content}` : 'Hashtag',
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
          type="button"
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
