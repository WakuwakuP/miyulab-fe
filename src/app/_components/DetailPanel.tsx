'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'
import { RiArrowLeftSLine } from 'react-icons/ri'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import {
  DetailContext,
  SetDetailContext,
} from 'util/provider/DetailProvider'

export const DetailPanel = () => {
  const token = useContext(TokenContext)
  const detail = useContext(DetailContext)
  const setDetail = useContext(SetDetailContext)

  const [context, setContext] =
    useState<Entity.Context | null>(null)

  useEffect(() => {
    if (token == null || detail.content == null) return

    if (detail.type === 'Status') {
      const client = GetClient(token?.access_token)

      client
        .getStatusContext(detail.content.id)
        .then((res) => {
          setContext(res.data)
        })
    }
  }, [detail.content, detail.type, token])

  const panelNames = {
    Status: 'Toot and Reply',
    Account: 'Profile',
  }

  if (detail.type === null) {
    return null
  }

  return (
    <Panel name={panelNames[detail.type]}>
      <div>
        <button
          className="flex rounded-md border pr-4 text-xl text-blue-500"
          onClick={() =>
            setDetail({
              type: null,
              content: null,
            })
          }
        >
          <RiArrowLeftSLine size={30} />
          <span>戻る</span>
        </button>
      </div>
      {detail.type === 'Status' && (
        <>
          {(context?.ancestors ?? []).map((status) => (
            <Status
              status={status}
              key={status.id}
            />
          ))}
          <Status status={detail.content} />{' '}
        </>
      )}

      {detail.type === 'Account' && (
        <UserInfo account={detail.content} />
      )}
    </Panel>
  )
}
