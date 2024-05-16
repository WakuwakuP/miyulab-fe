/* eslint-disable @next/next/no-img-element */
'use client'

import {
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import generator, { type Entity } from 'megalodon'
import { createPortal } from 'react-dom'
import { RiCloseCircleFill } from 'react-icons/ri'

import {
  type App,
  type Backend,
  backendList,
} from 'types/types'
import { APP_NAME, APP_URL } from 'util/environment'
import { GetClient } from 'util/GetClient'
import {
  AppsContext,
  UpdateAppsContext,
} from 'util/provider/AppsProvider'

const AddAccountModal = ({
  onClose,
}: {
  onClose: () => void
}) => {
  const apps = useContext(AppsContext)
  const [backend, setBackend] = useState<Backend | ''>('')
  const [backendUrl, setBackendUrl] = useState('')

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
          scopes: ['read', 'write', 'follow', 'push'],
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

  return (
    <>
      <div
        className="absolute bottom-0 left-0 right-0 top-0 bg-black/60"
        onClick={() => {
          onClose()
        }}
      ></div>
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
    </>
  )
}

export const AccountsPanel = () => {
  const apps = useContext(AppsContext)
  const updateApps = useContext(UpdateAppsContext)

  const [showAddAccountModal, setShowAddAccountModal] =
    useState(false)
  const [
    showDeleteAccountModal,
    setShowDeleteAccountModal,
  ] = useState<{
    app: App | null
    account: Entity.Account | null
  }>({
    app: null,
    account: null,
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
        return client
          .verifyAccountCredentials()
          .then((res) => {
            return { app, account: res.data }
          })
      })

      const res = await Promise.all(data)
      setAccounts(res)
    })()
  }, [apps])

  const deleteAccount = async (backendUrl: string) => {
    updateApps(
      apps.filter((app) => app.backendUrl !== backendUrl)
    )
  }

  return (
    <div className="pt-4">
      <div>アカウント管理</div>
      <div>
        {accountsMemo.map(({ app, account }) => (
          <div
            key={account.id}
            className="flex items-center"
          >
            <img
              className="h-12 w-12 flex-none rounded-lg object-contain"
              src={account.avatar}
              alt="avatar"
              loading="lazy"
            />
            <div className="truncate">
              {account.display_name} @{account.acct}
            </div>
            <div className="ml-auto shrink-0 p-1">
              <RiCloseCircleFill
                size={20}
                onClick={() => {
                  setShowDeleteAccountModal({
                    app,
                    account,
                  })
                }}
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
          document.body
        )}
      {showDeleteAccountModal.app != null &&
        showDeleteAccountModal.account != null &&
        createPortal(
          <>
            <div
              className="absolute bottom-0 left-0 right-0 top-0 bg-black/60"
              onClick={() => {
                setShowDeleteAccountModal({
                  app: null,
                  account: null,
                })
              }}
            ></div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
              <div>アカウントを削除しますか？</div>
              <div>
                {
                  showDeleteAccountModal.account
                    ?.display_name
                }{' '}
                @{showDeleteAccountModal.account?.acct}
              </div>
              <div className="flex justify-center space-x-2">
                <button
                  className="rounded-md border bg-gray-900 px-4 py-2"
                  onClick={() => {
                    deleteAccount(
                      showDeleteAccountModal.app
                        ?.backendUrl ?? ''
                    )

                    setShowDeleteAccountModal({
                      app: null,
                      account: null,
                    })
                  }}
                >
                  はい
                </button>
                <button
                  className="rounded-md border bg-gray-900 px-4 py-2"
                  onClick={() => {
                    setShowDeleteAccountModal({
                      app: null,
                      account: null,
                    })
                  }}
                >
                  いいえ
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  )
}
