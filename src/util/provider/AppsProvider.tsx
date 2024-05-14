'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  type ReactNode,
  createContext,
  useEffect,
  useState,
} from 'react'

import generator from 'megalodon'

import {
  type App,
  type Backend,
  backendList,
} from 'types/types'
import {
  APP_NAME,
  APP_URL,
  BACKEND_SNS,
  BACKEND_URL,
} from 'util/environment'

import bgImage from '@public/miyu.webp'

export const AppsContext = createContext<App[]>([])

export const AppsProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const router = useRouter()
  const code = useSearchParams().get('code')
  const [apps, setApps] = useState<App[]>([])

  const [backend, setBackend] = useState<
    'mastodon' | 'pleroma' | 'friendica' | 'firefish' | ''
  >(BACKEND_SNS)
  const [backendUrl, setBackendUrl] =
    useState<string>(BACKEND_URL)
  const [isRequestedToken, setIsRequestedToken] =
    useState<boolean>(false)
  const [storageLoading, setStorageLoading] =
    useState<boolean>(true)
  const [finishLoading, setFinishLoading] =
    useState<boolean>(false)

  useEffect(() => {
    if (localStorage.getItem('apps') != null) {
      setApps(
        JSON.parse(localStorage.getItem('apps') as string)
      )
    }
    setStorageLoading(false)
  }, [])

  const updateApps = (data: App[]) => {
    setApps(data)
    localStorage.setItem('apps', JSON.stringify(data))
  }

  useEffect(() => {
    if (storageLoading) {
      return
    }

    if (code != null) {
      if (isRequestedToken) {
        return
      }
      const processingAppData = JSON.parse(
        localStorage.getItem('processingAppData') as string
      )

      const client = generator(
        processingAppData.backend,
        processingAppData.backendUrl
      )
      setIsRequestedToken(true)
      client
        .fetchAccessToken(
          processingAppData.appData.client_id,
          processingAppData.appData.client_secret,
          code
        )
        .then((tokenData) => {
          const newApp: App = {
            backend: processingAppData.backend,
            backendUrl: processingAppData.backendUrl,
            appData: processingAppData.appData,
            tokenData: tokenData,
          }

          updateApps([...apps, newApp])
          setFinishLoading(true)
          router.replace('/')
          localStorage.removeItem('processingAppData')
        })
        .catch((e) => {
          console.error(e)
        })
    }

    if (apps.length > 0) {
      const now = new Date().getTime()
      apps.map(async (app) => {
        if (
          app.tokenData == null ||
          app.tokenData?.refresh_token == null
        ) {
          return
        } else {
          if (
            app.tokenData.expires_in != null &&
            app.tokenData.created_at != null
          ) {
            const expires =
              app.tokenData.created_at * 1000 +
              app.tokenData.expires_in

            if (expires < now) {
              app.tokenData = null
              return
            }

            if (expires - now < 1000 * 60 * 60 * 24) {
              const client = generator(
                app.backend,
                app.backendUrl
              )
              await client
                .refreshToken(
                  app.appData.client_id,
                  app.appData.client_secret,
                  app.tokenData?.refresh_token
                )
                .then((tokenData) => {
                  app.tokenData = tokenData
                })
              return
            }
          }
        }
      })
      setFinishLoading(true)
    }
  }, [apps, code, isRequestedToken, router, storageLoading])

  const onRegister = async () => {
    if (backend === '' || backendUrl === '') {
      return
    }

    const client = generator(backend, backendUrl)

    const findApp = apps.find(
      (app) =>
        app.backend === backend &&
        app.backendUrl == backendUrl
    )

    const processingAppData = await (async () => {
      if (
        findApp === undefined ||
        findApp.appData.id === ''
      ) {
        const appData = await client.registerApp(APP_NAME, {
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

        return {
          backend,
          backendUrl,
          appData,
          tokenData: null,
        }
      } else {
        return findApp
      }
    })()

    if (processingAppData?.appData?.url != null) {
      localStorage.setItem(
        'processingAppData',
        JSON.stringify(processingAppData)
      )

      window.location.href = processingAppData.appData.url
    }
  }

  if (finishLoading === false) {
    return (
      <div className="relative h-screen w-screen">
        <Image
          className="h-full w-full object-contain"
          src={bgImage}
          alt="Miyulab-FE"
          fill={true}
          priority={true}
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
          <h1 className="pb-8 text-4xl">Miyulab-FE</h1>
          <div className="w-72 space-y-2">
            <select
              className="w-full"
              value={backend}
              onChange={(e) => {
                setBackend(e.target.value as Backend | '')
              }}
            >
              <option value="">Select backend</option>
              {backendList.map((backend) => (
                <option
                  key={backend}
                  value={backend}
                >
                  {backend}
                </option>
              ))}
            </select>
            <input
              className="w-full"
              type="text"
              placeholder="https://pl.waku.dev"
              value={backendUrl}
              onChange={(e) => {
                setBackendUrl(e.target.value)
              }}
            />
          </div>
          <div className="pt-4">
            <button
              className="rounded-md border bg-gray-900 px-4 py-2"
              onClick={onRegister}
            >
              Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AppsContext.Provider value={apps}>
      {children}
    </AppsContext.Provider>
  )
}
