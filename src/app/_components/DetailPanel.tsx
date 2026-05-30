'use client'

import { AccountDetail } from 'app/_parts/AccountDetail'
import { HashtagDetail } from 'app/_parts/HashtagDetail'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import type { Entity, MegalodonInterface } from 'megalodon'
import {
  type Dispatch,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from 'react'
import { RiArrowLeftSLine } from 'react-icons/ri'
import { Virtuoso } from 'react-virtuoso'
import type { StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { useHashtagHistory } from 'util/hooks/useHashtagHistory'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  DetailContext,
  SetDetailContext,
  type SetDetailParams,
} from 'util/provider/DetailProvider'

import { GettingStarted } from './GettingStarted'

const pickAccountFromSearchResults = (
  accounts: Entity.Account[],
  searchQuery: string,
) => accounts.find((account) => account.acct === searchQuery) ?? accounts[0]

const normalizeSearchQuery = (rawQuery: string): string => {
  if (!/^https?:\/\//.test(rawQuery)) return rawQuery

  try {
    const url = new URL(rawQuery)
    const pathMatch = url.pathname.match(/^\/(?:@|users\/)([^/@]+)\/?$/)
    if (pathMatch?.[1]) {
      return `${pathMatch[1]}@${url.host}`
    }
  } catch {
    // URL パース失敗時はそのまま使用
  }
  return rawQuery
}

const resolveStatusByUri = (
  content: StatusAddAppIndex,
  client: MegalodonInterface,
  setDetail: Dispatch<SetStateAction<SetDetailParams>>,
) => {
  if (!content.uri) return

  client
    .search(content.uri, {
      limit: 1,
      resolve: true,
      type: 'statuses',
    })
    .then((res) => {
      const found = res.data.statuses[0]
      if (found) {
        setDetail({
          content: {
            ...found,
            appIndex: content.appIndex,
          },
          type: 'Status',
        })
      }
    })
    .catch((error) => {
      console.error('Failed to resolve status by URI:', error)
    })
}

const fetchStatusContext = (
  content: StatusAddAppIndex,
  client: MegalodonInterface,
  setContext: (context: StatusAddAppIndex[]) => void,
) => {
  client
    .getStatusContext(content.id)
    .then((res) => {
      setContext([
        ...(res.data.ancestors.map((status) => ({
          ...status,
          appIndex: content.appIndex,
        })) ?? []),
        content,
        ...(res.data.descendants.map((status) => ({
          ...status,
          appIndex: content.appIndex,
        })) ?? []),
      ])
    })
    .catch((error) => {
      console.error('Failed to fetch status context:', error)
    })
}

const loadStatusDetail = (
  content: StatusAddAppIndex,
  client: MegalodonInterface,
  setDetail: Dispatch<SetStateAction<SetDetailParams>>,
  setContext: (context: StatusAddAppIndex[]) => void,
) => {
  if (!content.id) {
    resolveStatusByUri(content, client, setDetail)
    return
  }
  fetchStatusContext(content, client, setContext)
}

type ResolveAsAccount = (account: Entity.Account) => void

const searchAccountWithFallback = (
  client: MegalodonInterface,
  searchQuery: string,
  resolveAsAccount: ResolveAsAccount,
) => {
  client
    .getAccount(searchQuery)
    .then((res) => resolveAsAccount(res.data))
    .catch((error) => {
      console.error('Failed to fetch account:', error)
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
}

const searchAccountByQuery = (
  client: MegalodonInterface,
  searchQuery: string,
  resolveAsAccount: ResolveAsAccount,
) => {
  client
    .searchAccount(searchQuery, { limit: 5, resolve: true })
    .then((res) => {
      const found = pickAccountFromSearchResults(res.data, searchQuery)
      if (found) resolveAsAccount(found)
    })
    .catch((error) => {
      console.error('Failed to search account:', error)
    })
}

const loadSearchUserDetail = (
  content: string,
  appIndex: number,
  client: MegalodonInterface,
  setDetail: Dispatch<SetStateAction<SetDetailParams>>,
) => {
  const resolveAsAccount: ResolveAsAccount = (account) => {
    setDetail({
      content: {
        ...account,
        appIndex,
      },
      type: 'Account',
    })
  }

  const searchQuery = normalizeSearchQuery(content)
  const isAcctFormat = /^@?\w[\w.-]*@[\w.-]+\.\w+$/.test(searchQuery)
  const isNumericId = /^\d+$/.test(searchQuery)

  if (isNumericId) {
    searchAccountWithFallback(client, searchQuery, resolveAsAccount)
  } else if (isAcctFormat) {
    searchAccountByQuery(client, searchQuery, resolveAsAccount)
  } else {
    client
      .getAccount(searchQuery)
      .then((res) => resolveAsAccount(res.data))
      .catch(() => {
        searchAccountByQuery(client, searchQuery, resolveAsAccount)
      })
  }
}

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
      loadStatusDetail(detail.content, client, setDetail, setContext)
    }

    if (detail.type === 'SearchUser' && detail.content) {
      const client = GetClient(apps[detail.appIndex])
      loadSearchUserDetail(detail.content, detail.appIndex, client, setDetail)
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
