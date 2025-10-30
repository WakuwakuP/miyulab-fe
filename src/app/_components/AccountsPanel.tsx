/* eslint-disable @next/next/no-img-element */
'use client'

import generator, { type Entity } from 'megalodon'
import { useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RiCloseCircleFill } from 'react-icons/ri'

import { type App, type Backend, backendList } from 'types/types'
import { APP_NAME, APP_URL } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { AppsContext, UpdateAppsContext } from 'util/provider/AppsProvider'

const AddAccountModal = ({ onClose }: { onClose: () => void }) => {
  const apps = useContext(AppsContext)
  const [backend, setBackend] = useState<Backend | ''>('')
  const [backendUrl, setBackendUrl] = useState('')

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

  return (
    <>
      <div
        className="absolute bottom-0 left-0 right-0 top-0 bg-black/60"
        onClick={() => {
          onClose()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClose()
          }
        }}
        role="button"
        tabIndex={0}
      ></div>
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
            className="rounded-md border bg-gray-900 px-4 py-2"
            onClick={onRegister}
            type="button"
          >
            Login
          </button>
        </div>
      </div>
    </>
  )
}

export const AccountsPanel = () => {
  const apps = useContext(AppsContext)
  const updateApps = useContext(UpdateAppsContext)

  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState<{
    app: App | null
    account: Entity.Account | null
    index: number | null
  }>({
    account: null,
    app: null,
    index: null,
  })

  const [accounts, setAccounts] = useState<
    {
      app: App
      account: Entity.Account
    }[]
  >([])

  const accountsMemo = useMemo(() => accounts, [accounts])

  useEffect(() => {
    ;(async () => {
      const data = apps.map((app) => {
        const client = GetClient(app)
        return client.verifyAccountCredentials().then((res) => {
          return { account: res.data, app }
        })
      })

      const res = await Promise.all(data)
      setAccounts(res)
    })()
  }, [apps])

  const deleteAccount = async (index: number | null) => {
    if (index == null) return
    apps.splice(index, 1)
    updateApps(apps)
  }

  return (
    <div className="pt-4">
      <div>アカウント管理</div>
      <div>
        {accountsMemo.map(({ app, account }, index) => (
          <div className="flex items-center" key={account.id}>
            <img
              alt="avatar"
              className="h-12 w-12 flex-none rounded-lg object-contain"
              loading="lazy"
              src={account.avatar}
            />
            <div className="truncate">
              {account.display_name} @{account.acct}
            </div>
            <div className="ml-auto shrink-0 p-1">
              <RiCloseCircleFill
                onClick={() => {
                  setShowDeleteAccountModal({
                    account,
                    app,
                    index,
                  })
                }}
                size={20}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="pt-2">
        <button
          className="rounded-md border bg-gray-900 px-4 py-2"
          onClick={() => {
            setShowAddAccountModal(true)
          }}
          type="button"
        >
          アカウント追加
        </button>
      </div>
      {showAddAccountModal &&
        createPortal(
          <AddAccountModal
            onClose={() => {
              setShowAddAccountModal(false)
            }}
          />,
          document.body,
        )}
      {showDeleteAccountModal.app != null &&
        showDeleteAccountModal.account != null &&
        createPortal(
          <>
            <div
              className="absolute bottom-0 left-0 right-0 top-0 bg-black/60"
              onClick={() => {
                setShowDeleteAccountModal({
                  account: null,
                  app: null,
                  index: null,
                })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setShowDeleteAccountModal({
                    account: null,
                    app: null,
                    index: null,
                  })
                }
              }}
              role="button"
              tabIndex={0}
            ></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
              <div>アカウントを削除しますか？</div>
              <div>
                {showDeleteAccountModal.account?.display_name} @
                {showDeleteAccountModal.account?.acct}
              </div>
              <div>{showDeleteAccountModal.index}</div>
              <div className="flex justify-center space-x-2">
                <button
                  className="rounded-md border bg-gray-900 px-4 py-2"
                  onClick={() => {
                    deleteAccount(showDeleteAccountModal.index)

                    setShowDeleteAccountModal({
                      account: null,
                      app: null,
                      index: null,
                    })
                  }}
                  type="button"
                >
                  はい
                </button>
                <button
                  className="rounded-md border bg-gray-900 px-4 py-2"
                  onClick={() => {
                    setShowDeleteAccountModal({
                      account: null,
                      app: null,
                      index: null,
                    })
                  }}
                  type="button"
                >
                  いいえ
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
