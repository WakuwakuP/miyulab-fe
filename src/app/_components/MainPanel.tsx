'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'

import { Panel } from 'app/_parts/Panel'
import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

export const MainPanel = () => {
  const token = useContext(TokenContext)

  const [account, setAccount] =
    useState<Entity.Account | null>(null)

  useEffect(() => {
    if (token == null) return
    const client = GetClient(token?.access_token)

    client.verifyAccountCredentials().then((res) => {
      setAccount(res.data)
    })
  }, [token])

  if (token == null || account == null) {
    return null
  }

  return (
    <Panel>
      <UserInfo account={account} />
    </Panel>
  )
}
