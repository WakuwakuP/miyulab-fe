'use client'

import {
  Dispatch,
  ReactNode,
  SetStateAction,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { Entity } from 'megalodon'
import * as emoji from 'node-emoji'
import unicodeEmojiData from 'unicode-emoji-json/data-by-emoji.json'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

type PleromaInstance =
  | (Entity.Instance & {
      upload_limit?: number
    })
  | null

export const InstanceContext =
  createContext<PleromaInstance>(null)

export const EmojiContext = createContext<Entity.Emoji[]>(
  []
)
export const UsersContext = createContext<
  Pick<
    Entity.Account,
    'id' | 'acct' | 'avatar' | 'display_name'
  >[]
>([])

export const SetUsersContext = createContext<
  Dispatch<
    SetStateAction<
      Pick<
        Entity.Account,
        'id' | 'acct' | 'avatar' | 'display_name'
      >[]
    >
  >
>(() => {})

export const ResourceProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const token = useContext(TokenContext)

  const emojiList = useMemo(() => {
    const emojiData: {
      [key: string]: { slug: string; group: string }
    } = unicodeEmojiData
    const list: Entity.Emoji[] = []
    Object.keys(emojiData).forEach((key) => {
      if (emoji.which(key) == null) return
      list.push({
        shortcode: emoji.which(key),
        url: '',
        static_url: '',
        category: emojiData[key].group,
        visible_in_picker: false,
      } as Entity.Emoji)
    })

    return list.sort(
      (a, b) => a.shortcode.length - b.shortcode.length
    )
  }, [])

  const [instance, setInstance] =
    useState<PleromaInstance>(null)
  const [emojis, setEmojis] = useState<Entity.Emoji[]>([])
  const [users, setUsers] = useState<
    Pick<
      Entity.Account,
      'id' | 'acct' | 'avatar' | 'display_name'
    >[]
  >(JSON.parse(localStorage.getItem('users') ?? '[]'))

  useEffect(() => {
    if (users.length === 0) return
    localStorage.setItem('users', JSON.stringify(users))
  }, [users])

  useEffect(() => {
    if (token == null) return
    const client = GetClient(token?.access_token)
    client.getInstanceCustomEmojis().then((res) => {
      setEmojis([...res.data, ...emojiList])
    })

    client.getInstance().then((res) => {
      setInstance(res.data as PleromaInstance)
    })
  }, [emojiList, token])

  return (
    <InstanceContext.Provider value={instance}>
      <EmojiContext.Provider value={emojis}>
        <UsersContext.Provider value={users}>
          <SetUsersContext.Provider value={setUsers}>
            {children}
          </SetUsersContext.Provider>
        </UsersContext.Provider>
      </EmojiContext.Provider>
    </InstanceContext.Provider>
  )
}
