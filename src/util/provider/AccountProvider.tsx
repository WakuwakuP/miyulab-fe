'use client'

import { createContext, useState } from 'react'

const AccountsContext = createContext<any[]>([])

export const AccountProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [accounts, setAccounts] = useState<any[]>([])

  const addAccount = (account: any) => {
    setAccounts([...accounts, account])
  }

  const removeAccount = (account: any) => {
    setAccounts(accounts.filter((a) => a.id !== account.id))
  }

  return (
    <AccountsContext.Provider value={accounts}>
      {children}
    </AccountsContext.Provider>
  )
}
