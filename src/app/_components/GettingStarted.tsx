'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'
import { RiArrowLeftSLine } from 'react-icons/ri'

import { SettingPanel } from 'app/_components/SettingPanel'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

export const GettingStarted = () => {
  const token = useContext(TokenContext)
  const [selected, setSelected] = useState<
    'bookmark' | 'dm' | 'setting' | null
  >(null)

  const [title, setTitle] = useState<string>(
    'Getting Started'
  )

  const [lists, setLists] = useState<Entity.List[]>([])

  const [bookmarks, setBookmarks] = useState<
    Entity.Status[]
  >([])

  const [conversations, setConversations] = useState<
    Entity.Conversation[]
  >([])

  useEffect(() => {
    if (token === null) return
    const client = GetClient(token?.access_token)

    client.getLists().then((res) => {
      setLists(res.data)
    })

    switch (selected) {
      case 'bookmark':
        setTitle('Bookmark')
        client.getBookmarks().then((res) => {
          setBookmarks(res.data)
        })
        break
      case 'dm':
        setTitle('Direct Message')
        client.getConversationTimeline().then((res) => {
          setConversations(res.data)
        })
        break
      default:
        setTitle('Getting Started')
        break
    }
  }, [token, selected])

  return (
    <Panel name={title}>
      <div>
        {selected !== null ? (
          <button
            className="flex rounded-md border pr-4 text-xl text-blue-500"
            onClick={() => setSelected(null)}
          >
            <RiArrowLeftSLine size={30} />
            <span>戻る</span>
          </button>
        ) : (
          <>
            <button
              className="w-full border-b-2 px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('bookmark')}
            >
              Bookmark
            </button>
            <button
              className="w-full border-b-2 px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('dm')}
            >
              Direct Message
            </button>
            <button
              className="w-full border-b-2 px-4 py-2 text-xl hover:bg-slate-800"
              onClick={() => setSelected('setting')}
            >
              Setting
            </button>
          </>
        )}
      </div>

      {selected === 'bookmark' &&
        bookmarks.map((status) => (
          <Status
            key={status.id}
            status={status}
          />
        ))}

      {selected === 'dm' &&
        conversations.map((conversation) => (
          <div key={conversation.id}>
            {conversation.last_status != null && (
              <Status status={conversation.last_status} />
            )}
          </div>
        ))}
      {selected === 'setting' && <SettingPanel />}
    </Panel>
  )
}
