'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  ReactNode,
  createContext,
  useEffect,
  useState,
} from 'react'

import generator, { OAuth } from 'megalodon'

import {
  APP_NAME,
  APP_URL,
  BACKEND_URL,
} from 'util/environment'

const initialAppData: OAuth.AppData = {
  id: '',
  name: '',
  website: null,
  redirect_uri: null,
  client_id: '',
  client_secret: '',
  url: null,
  session_token: null,
}

export const AppContext =
  createContext<OAuth.AppData>(initialAppData)

export const TokenContext =
  createContext<OAuth.TokenData | null>(null)

export const AppProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const router = useRouter()

  const code = useSearchParams().get('code')

  const [appData, setAppData] = useState<OAuth.AppData>(
    localStorage.getItem('app') != null
      ? JSON.parse(localStorage.getItem('app') as string)
      : initialAppData
  )

  const [tokenData, setTokenData] =
    useState<OAuth.TokenData | null>(
      localStorage.getItem('token') != null
        ? JSON.parse(localStorage.getItem('token') ?? '')
        : null
    )

  const updateAppData = (data: OAuth.AppData) => {
    setAppData(data)
    localStorage.setItem('app', JSON.stringify(data))
  }

  const updateTokenData = (data: OAuth.TokenData) => {
    setTokenData(data)
    localStorage.setItem('token', JSON.stringify(data))
  }
  useEffect(() => {
    const client = generator(
      'pleroma',
      `https://${BACKEND_URL}`
    )
    if (code != null && appData.id !== '') {
      client
        .fetchAccessToken(
          appData.client_id,
          appData.client_secret,
          code
        )
        .then((tokenData) => {
          updateTokenData(tokenData)
          router.replace('/')
        })
    }

    if (code == null && appData.id === '') {
      client
        .registerApp(APP_NAME, {
          scopes: [
            'read',
            'write',
            'follow',
            'push',
            'notifications',
          ],
          website: APP_URL,
          redirect_uris: APP_URL,
        })
        .then((appData) => {
          updateAppData(appData)
          router.push(appData.url as string)
        })
    }
  }, [
    appData.client_id,
    appData.client_secret,
    appData.id,
    code,
    router,
  ])

  if (tokenData == null) {
    return <div>Loading...</div>
  }

  return (
    <AppContext.Provider value={appData}>
      <TokenContext.Provider value={tokenData}>
        {children}
      </TokenContext.Provider>
    </AppContext.Provider>
  )
}
