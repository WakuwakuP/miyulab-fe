'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { ReactNode, createContext, useEffect, useState } from 'react'

import generator, { OAuth } from 'megalodon'

import { APP_NAME, APP_URL, BACKEND_URL } from 'util/environment'

import bgImage from '@public/miyu.webp'

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

export const AppContext = createContext<OAuth.AppData>(initialAppData)

export const TokenContext = createContext<OAuth.TokenData | null>(null)

export const AppProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const router = useRouter()

  const code = useSearchParams().get('code')

  const [appData, setAppData] = useState<OAuth.AppData>(initialAppData)

  const [tokenData, setTokenData] = useState<OAuth.TokenData | null>(null)
  const [isRequestedToken, setIsRequestedToken] = useState<boolean>(false)

  const [storageLoading, setStorageLoading] = useState<boolean>(true)
  const [finishLoading, setFinishLoading] = useState<boolean>(false)

  const updateAppData = (data: OAuth.AppData) => {
    setAppData(data)
    localStorage.setItem('app', JSON.stringify(data))
  }

  const updateTokenData = (data: OAuth.TokenData) => {
    setTokenData(data)
    localStorage.setItem('token', JSON.stringify(data))
  }

  useEffect(() => {
    if (localStorage.getItem('app') != null) {
      setAppData(JSON.parse(localStorage.getItem('app') as string))
    }
    if (localStorage.getItem('token') != null) {
      setTokenData(JSON.parse(localStorage.getItem('token') as string))
    }
    setStorageLoading(false)
  }, [])

  useEffect(() => {
    // ストレージの読み込みが終わっていない場合は何もしない
    if (storageLoading) {
      return
    }

    const client = generator('pleroma', `https://${BACKEND_URL}`)

    // codeがある場合はトークンを取得
    if (appData.id !== '' && code != null) {
      // リクエストを1度だけ実行するようにする
      if (isRequestedToken) {
        return
      }
      setIsRequestedToken(true)
      client.fetchAccessToken(appData.client_id, appData.client_secret, code).then((tokenData) => {
        updateTokenData(tokenData)
        router.replace('/')
      })
      return
    }

    // codeがない場合
    if (code == null) {
      // アプリケーションの登録
      if (appData.id === '') {
        client
          .registerApp(APP_NAME, {
            scopes: ['read', 'write', 'follow', 'push', 'notifications'],
            website: APP_URL,
            redirect_uris: APP_URL,
          })
          .then((appData) => {
            updateAppData(appData)
          })

        return
      } else {
        // アプリケーションの登録が終わっている場合
        if (tokenData?.refresh_token == null) {
          return
        } else {
          // 有効期限が残り10日ならリフレッシュトークンを使って更新
          if (tokenData.expires_in != null && tokenData.created_at != null) {
            const now = new Date().getTime()
            const expires = tokenData.created_at * 1000 + tokenData.expires_in
            if (expires - now < 10 * 24 * 60 * 60 * 1000) {
              client.refreshToken(appData.client_id, appData.client_secret, tokenData.refresh_token).then((tokenData) => {
                updateTokenData(tokenData)
              })
            }
          }
        }
        setFinishLoading(true)
        return
      }
    }
  }, [appData.client_id, appData.client_secret, appData.id, appData.url, code, isRequestedToken, router, storageLoading, tokenData])

  if (finishLoading === false) {
    return (
      <div className="relative h-[100vh] w-[100vw]">
        <Image
          className="h-full w-full"
          src={bgImage}
          alt="Miyulab-FE"
          fill={true}
          objectFit="contain"
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border p-12 text-center">
          <h1 className="pb-8 text-4xl">Miyulab-FE</h1>
          {appData.url != null ? (
            <a
              className="rounded-md border px-4 py-2"
              href={appData.url}
            >
              Login
            </a>
          ) : (
            <div>Loading</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={appData}>
      <TokenContext.Provider value={tokenData}>{children}</TokenContext.Provider>
    </AppContext.Provider>
  )
}
