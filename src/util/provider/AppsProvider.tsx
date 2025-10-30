'use client'

import bgImage from '@public/miyu.webp'
import generator from 'megalodon'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { createContext, type ReactNode, useCallback, useEffect, useState } from 'react'
import { type App, type Backend, backendList } from 'types/types'
import { APP_NAME, APP_URL, BACKEND_SNS, BACKEND_URL } from 'util/environment'

export const AppsContext = createContext<App[]>([])

/* eslint-disable indent, func-call-spacing */
export const UpdateAppsContext = createContext<(data: App[]) => void>(() => {})
/* eslint-enable indent, func-call-spacing */

export const AppsProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const router = useRouter()
  const code = useSearchParams().get('code')
  const [apps, setApps] = useState<App[]>([])

  const [backend, setBackend] = useState<Backend | ''>(BACKEND_SNS)
  const [backendUrl, setBackendUrl] = useState<string>(BACKEND_URL)
  const [isRequestedToken, setIsRequestedToken] = useState<boolean>(false)
  const [storageLoading, setStorageLoading] = useState<boolean>(true)
  const [finishLoading, setFinishLoading] = useState<boolean>(false)

  useEffect(() => {
    if (localStorage.getItem('apps') != null) {
      setApps(JSON.parse(localStorage.getItem('apps') as string))
    }
    setStorageLoading(false)
  }, [])

  const updateApps = useCallback((data: App[]) => {
    setApps(data)
    localStorage.setItem('apps', JSON.stringify(data))
  }, [])

  useEffect(() => {
    if (storageLoading) {
      return
    }

    if (code != null) {
      if (isRequestedToken) {
        return
      }
      const processingAppData = JSON.parse(
        localStorage.getItem('processingAppData') as string,
      )

      if (processingAppData == null) {
        router.replace('/')
        return
      }

      const client = generator(
        processingAppData.backend,
        processingAppData.backendUrl,
      )
      setIsRequestedToken(true)
      client
        .fetchAccessToken(
          processingAppData.appData.client_id,
          processingAppData.appData.client_secret,
          code,
          APP_URL,
        )
        .then((tokenData) => {
          const newApp: App = {
            appData: processingAppData.appData,
            backend: processingAppData.backend,
            backendUrl: processingAppData.backendUrl,
            tokenData: tokenData,
          }

          if (processingAppData?.index != null) {
            const index = processingAppData.index as number
            const newApps = [...apps]
            newApps[index] = newApp
            updateApps(newApps)
          } else {
            updateApps([...apps, newApp])
          }

          setFinishLoading(true)
          router.replace('/')
          localStorage.removeItem('processingAppData')
        })
        .catch((e) => {
          console.error(e)
        })
    }

    if (apps.length > 0) {
      const now = Date.now()
      apps.forEach(async (app) => {
        if (app.tokenData == null || app.tokenData?.refresh_token == null) {
          return
        } else {
          if (
            app.tokenData.expires_in != null &&
            app.tokenData.created_at != null
          ) {
            const expires =
              app.tokenData.created_at * 1000 + app.tokenData.expires_in

            if (expires < now) {
              app.tokenData = null
              return
            }

            if (expires - now < 1000 * 60 * 60 * 24) {
              const client = generator(app.backend, app.backendUrl)
              await client
                .refreshToken(
                  app.appData.client_id,
                  app.appData.client_secret,
                  app.tokenData?.refresh_token,
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
  }, [apps, code, isRequestedToken, router, storageLoading, updateApps])

  const onRegister = async () => {
    if (backend === '' || backendUrl === '') {
      return
    }

    const client = generator(backend, backendUrl)

    const findApp = apps.find(
      (app) => app.backend === backend && app.backendUrl === backendUrl,
    )

    const processingAppData = await (async () => {
      if (findApp === undefined || findApp.appData.id === '') {
        const appData = await client.registerApp(APP_NAME, {
          redirect_uris: APP_URL,
          scopes: ['read', 'write', 'follow', 'push'],
          website: APP_URL,
        })

        return {
          appData,
          backend,
          backendUrl,
          tokenData: null,
        }
      } else {
        return findApp
      }
    })()

    if (processingAppData?.appData?.url != null) {
      localStorage.setItem(
        'processingAppData',
        JSON.stringify(processingAppData),
      )

      window.location.href = processingAppData.appData.url
    }
  }

  if (finishLoading === false) {
    return (
      <div className="relative h-screen w-screen">
        <Image
          alt="Miyulab-FE"
          className="h-full w-full object-contain"
          fill={true}
          priority={true}
          src={bgImage}
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
          <h1 className="pb-8 text-4xl">Miyulab-FE</h1>
          <div className="w-72 space-y-2">
            <select
              className="w-full"
              onChange={(e) => {
                setBackend(e.target.value as Backend | '')
              }}
              value={backend}
            >
              <option value="">Select backend</option>
              {backendList.map((backend) => (
                <option key={backend} value={backend}>
                  {backend}
                </option>
              ))}
            </select>
            <input
              className="w-full"
              onChange={(e) => {
                setBackendUrl(e.target.value)
              }}
              placeholder="https://pl.waku.dev"
              type="text"
              value={backendUrl}
            />
          </div>
          <div className="pt-4">
            <button
              type="button"
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
      <UpdateAppsContext.Provider value={updateApps}>
        {children}
      </UpdateAppsContext.Provider>
    </AppsContext.Provider>
  )
}
