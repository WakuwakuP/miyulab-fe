'use client'

import type { Entity } from 'megalodon'
import * as emoji from 'node-emoji'
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import unicodeEmojiData from 'unicode-emoji-json/data-by-emoji.json'

import { GetClient } from 'util/GetClient'

import { AppsContext } from './AppsProvider'

type PleromaInstance =
  | (Entity.Instance & {
      upload_limit?: number
    })
  | null

export const InstanceContext = createContext<PleromaInstance>(null)

export const EmojiContext = createContext<Entity.Emoji[]>([])
export const UsersContext = createContext<
  Pick<Entity.Account, 'id' | 'acct' | 'avatar' | 'display_name'>[]
>([])

export const SetUsersContext = createContext<
  Dispatch<
    SetStateAction<
      Pick<Entity.Account, 'id' | 'acct' | 'avatar' | 'display_name'>[]
    >
  >
>(() => {})

export const TagsContext = createContext<string[]>([])
export const SetTagsContext = createContext<Dispatch<SetStateAction<string[]>>>(
  () => {},
)

export const ResourceProvider = ({
  children,
}: Readonly<{ children: ReactNode }>) => {
  const apps = useContext(AppsContext)

  const emojiList = useMemo(() => {
    const emojiData: {
      [key: string]: { slug: string; group: string }
    } = unicodeEmojiData
    const list: Entity.Emoji[] = []
    Object.keys(emojiData).forEach((key) => {
      if (emoji.which(key) == null) return
      list.push({
        category: emojiData[key].group,
        shortcode: emoji.which(key),
        static_url: '',
        url: '',
        visible_in_picker: false,
      } as Entity.Emoji)
    })

    return list.sort((a, b) => a.shortcode.length - b.shortcode.length)
  }, [])

  const [instance, setInstance] = useState<PleromaInstance>(null)
  const [emojis, setEmojis] = useState<Entity.Emoji[]>([])
  const [users, setUsers] = useState<
    Pick<Entity.Account, 'id' | 'acct' | 'avatar' | 'display_name'>[]
  >(JSON.parse(localStorage.getItem('users') ?? '[]'))

  const [tags, setTags] = useState<string[]>(
    JSON.parse(localStorage.getItem('tags') ?? '[]'),
  )

  const sortedTags = useMemo(() => {
    return tags.sort((a, b) => a.length - b.length)
  }, [tags])

  useEffect(() => {
    if (users.length === 0) return
    localStorage.setItem('users', JSON.stringify(users))
  }, [users])

  useEffect(() => {
    if (tags.length === 0) return
    localStorage.setItem('tags', JSON.stringify(tags))
  }, [tags])

  useEffect(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])
    client.getInstanceCustomEmojis().then((res) => {
      setEmojis([...res.data, ...emojiList])
    })

    client.getInstance().then((res) => {
      setInstance(res.data as PleromaInstance)
    })
  }, [apps, emojiList])

  return (
    <InstanceContext.Provider value={instance}>
      <EmojiContext.Provider value={emojis}>
        <UsersContext.Provider value={users}>
          <SetUsersContext.Provider value={setUsers}>
            <TagsContext.Provider value={sortedTags}>
              <SetTagsContext.Provider value={setTags}>
                {children}
              </SetTagsContext.Provider>
            </TagsContext.Provider>
          </SetUsersContext.Provider>
        </UsersContext.Provider>
      </EmojiContext.Provider>
    </InstanceContext.Provider>
  )
}
