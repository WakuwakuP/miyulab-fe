/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import generator, { detector, type Entity } from 'megalodon'
import { useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { RiCloseCircleFill } from 'react-icons/ri'

import { type App, type Backend, backendList } from 'types/types'
import { APP_NAME, APP_URL } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { detectMisskey } from 'util/misskey/auth'
import { MisskeyAdapter } from 'util/misskey/MisskeyAdapter'
import { AppsContext } from 'util/provider/AppsProvider'

const AddAccountModal = ({ onClose }: { onClose: () => void }) => {
  const apps = useContext(AppsContext)
  const [backend, setBackend] = useState<Backend | ''>('')
  const [backendUrl, setBackendUrl] = useState('')

  const onRegister = async () => {
    if (backendUrl === '') {
      return
    }

    const detectedBackend = await (async () => {
      if (backend !== '') return backend
      try {
        return await detector(backendUrl)
      } catch (e) {
        console.error('Failed to detect backend via megalodon:', e)
        // megalodon が検出できない場合、Misskey かどうか確認
        try {
          if (await detectMisskey(backendUrl)) {
            return 'misskey' as Backend
          }
        } catch (e2) {
          console.error('Failed to detect Misskey:', e2)
        }
        return null
      }
    })()
    if (detectedBackend == null) {
      return
    }
    const client =
      detectedBackend === 'misskey'
        ? new MisskeyAdapter(backendUrl)
        : generator(detectedBackend, backendUrl)

    const findApp = apps.find(
      (app) => app.backend === detectedBackend && app.backendUrl === backendUrl,
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
          backend: detectedBackend,
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
      ></div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
        <h1 className="pb-8 text-4xl">Miyulab-FE</h1>
        <div className="w-72 space-y-2">
          <input
            className="w-full"
            onChange={(e) => {
              setBackendUrl(e.target.value)
            }}
            placeholder="https://pl.waku.dev"
            type="text"
            value={backendUrl}
          />
          <select
            className="w-full rounded-md border bg-gray-800 px-2 py-1 text-white"
            onChange={(e) => {
              setBackend(e.target.value as Backend | '')
            }}
            value={backend}
          >
            <option value="">自動検出</option>
            {backendList.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
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

  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [showReloadModal, setShowReloadModal] = useState(false)
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
      try {
        const data = apps.map((app) => {
          const client = GetClient(app)
          return client.verifyAccountCredentials().then((res) => {
            return { account: res.data, app }
          })
        })

        const res = await Promise.all(data)
        setAccounts(res)
      } catch (error) {
        console.error('Failed to verify account credentials:', error)
      }
    })()
  }, [apps])

  const deleteAccount = (index: number | null) => {
    if (index == null) return
    const newApps = apps.filter((_, i) => i !== index)
    // Update localStorage directly without triggering React state update
    // to avoid stale-index errors across the app during re-render.
    // The reload modal will prompt the user to reload the page.
    try {
      localStorage.setItem('apps', JSON.stringify(newApps))
    } catch (error) {
      console.error('Failed to update localStorage:', error)
    }
    setShowReloadModal(true)
  }

  return (
    <div className="pt-4">
      <div>アカウント管理</div>
      <div>
        {accountsMemo.map(({ app, account }, index) => (
          <div className="flex items-center" key={account.id}>
            <ProxyImage
              alt="avatar"
              className="h-12 w-12 flex-none rounded-lg object-contain"
              height={48}
              src={account.avatar}
              width={48}
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
      {showReloadModal &&
        createPortal(
          <>
            <div className="absolute bottom-0 left-0 right-0 top-0 bg-black/60" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border bg-gray-600 p-12 text-center">
              <div className="pb-4">タイムラインを再構築します</div>
              <button
                className="rounded-md border bg-gray-900 px-4 py-2"
                onClick={() => {
                  window.location.reload()
                }}
                type="button"
              >
                リロード
              </button>
            </div>
          </>,
          document.body,
        )}
    </div>
  )
}
