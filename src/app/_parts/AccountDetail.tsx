/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'

import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

import { Status } from './Status'

export const AccountDetail = ({
  account,
}: {
  account: Entity.Account
}) => {
  const token = useContext(TokenContext)
  const [toots, setToots] = useState<Entity.Status[]>([])
  const [media, setMedia] = useState<Entity.Status[]>([])
  const [relationship, setRelationship] = useState<
    Entity.Relationship | undefined
  >(undefined)

  const [tab, setTab] = useState<
    'toots' | 'media' | 'favourite'
  >('toots')

  const getNote = (account: Entity.Account) => {
    let note = account.note
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        note = note.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" loading="lazy" />`
        )
      })
    }
    return note
  }

  useEffect(() => {
    setToots([])
    setMedia([])
  }, [account.id])

  useEffect(() => {
    if (token === null) return

    const client = GetClient(token?.access_token)

    client.getRelationship(account.id).then((res) => {
      setRelationship(res.data)
    })

    client
      .getAccountStatuses(account.id, {
        limit: 100,
      })
      .then((res) => {
        setToots(res.data)
      })

    client
      .getAccountStatuses(account.id, {
        limit: 100,
        only_media: true,
      })
      .then((res) => {
        setMedia(res.data)
      })
  }, [account.id, token])

  return (
    <>
      <div className="mb-2">
        <img
          src={account.header}
          alt="header"
          className="max-h-80 w-full object-cover"
          loading="lazy"
        />
      </div>
      <UserInfo account={account} />
      {relationship != null && (
        <div className="my-2">
          <div className="my-2">
            <span className="text-gray-400">
              {relationship.followed_by
                ? 'フォローされています'
                : ''}
            </span>
          </div>
          <div className="my-2">
            <div>
              <span className="text-gray-400">
                {relationship.following ? (
                  'フォロー中'
                ) : (
                  <button
                    className="rounded-md border border-blue-500 px-2 py-1 text-blue-500 transition-colors duration-300 ease-in-out hover:bg-blue-500 hover:text-white"
                    onClick={() => {
                      if (token == null) return
                      const client = GetClient(
                        token.access_token
                      )
                      client
                        .followAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            following: true,
                          })
                        })
                    }}
                  >
                    フォローする
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      <div
        className="my-2"
        dangerouslySetInnerHTML={{
          __html: getNote(account),
        }}
      />

      <div>
        <div className="grid grid-cols-2 [&>button]:box-border">
          <button
            className={[
              'border',
              tab === 'toots' ? 'border-blue-500' : '',
            ].join(' ')}
            onClick={() => {
              setTab('toots')
            }}
          >
            Toots
          </button>
          <button
            className={[
              'border',
              tab === 'media' ? 'border-blue-500' : '',
            ].join(' ')}
            onClick={() => {
              setTab('media')
            }}
          >
            Media
          </button>
        </div>
        {tab === 'toots' && (
          <div>
            {toots.map((status) => (
              <Status
                status={status}
                key={status.id}
              />
            ))}
          </div>
        )}
        {tab === 'media' && (
          <div>
            {media.map((status) => (
              <Status
                status={status}
                key={status.id}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
