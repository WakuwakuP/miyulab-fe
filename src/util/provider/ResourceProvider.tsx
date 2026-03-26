'use client'

import type { Entity } from 'megalodon'
import * as emoji from 'node-emoji'
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import unicodeEmojiData from 'unicode-emoji-json/data-by-emoji.json'

import { bulkUpsertCustomEmojis } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'

import { AppsContext } from './AppsProvider'

type PleromaInstance =
  | (Entity.Instance & {
      upload_limit?: number
    })
  | null

export const InstanceContext = createContext<PleromaInstance>(null)

export const EmojiContext = createContext<Entity.Emoji[]>([])

/**
 * サーバ別カスタム絵文字カタログ
 *
 * backendUrl をキーとして各サーバのカスタム絵文字一覧を保持する。
 * マルチアカウント環境で、Status が属するサーバの絵文字を正しく解決するために使用する。
 */
export const EmojiCatalogContext = createContext<Map<string, Entity.Emoji[]>>(
  new Map(),
)

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
  const [emojiCatalog, setEmojiCatalog] = useState<Map<string, Entity.Emoji[]>>(
    () => new Map(),
  )
  const [users, setUsers] = useState<
    Pick<Entity.Account, 'id' | 'acct' | 'avatar' | 'display_name'>[]
  >(JSON.parse(localStorage.getItem('users') ?? '[]'))

  const [tags, setTags] = useState<string[]>(
    JSON.parse(localStorage.getItem('tags') ?? '[]'),
  )

  const sortedTags = useMemo(() => {
    return [...tags].sort((a, b) => a.length - b.length)
  }, [tags])

  useEffect(() => {
    if (users.length === 0) return
    localStorage.setItem('users', JSON.stringify(users))
  }, [users])

  useEffect(() => {
    if (tags.length === 0) return
    localStorage.setItem('tags', JSON.stringify(tags))
  }, [tags])

  /** カタログに 1 サーバ分を追加（immutable 更新） */
  const addToCatalog = useCallback(
    (backendUrl: string, serverEmojis: Entity.Emoji[]) => {
      setEmojiCatalog((prev) => {
        const next = new Map(prev)
        next.set(backendUrl, serverEmojis)
        return next
      })
    },
    [],
  )

  useEffect(() => {
    if (apps.length <= 0) return

    // 全アカウントのサーバからカスタム絵文字を取得し DB + カタログにキャッシュ
    const fetchedServers = new Set<string>()
    for (const app of apps) {
      if (fetchedServers.has(app.backendUrl)) continue
      fetchedServers.add(app.backendUrl)

      const client = GetClient(app)
      client
        .getInstanceCustomEmojis()
        .then((res) => {
          // 最初のアカウントの絵文字はピッカー用 React state にも反映（従来互換）
          if (app === apps[0]) {
            setEmojis([...res.data, ...emojiList])
          }

          // サーバ別カタログに登録
          addToCatalog(app.backendUrl, res.data)

          // DB にキャッシュ（ストリーミング時のフォールバック解決用）
          bulkUpsertCustomEmojis(app.backendUrl, res.data).catch((error) => {
            console.error(
              `Failed to cache custom emojis for ${app.backendUrl}:`,
              error,
            )
          })
        })
        .catch((error) => {
          console.error('Failed to fetch custom emojis:', error)
        })
    }

    const client = GetClient(apps[0])
    client
      .getInstance()
      .then((res) => {
        setInstance(res.data as PleromaInstance)
      })
      .catch((error) => {
        console.error('Failed to fetch instance:', error)
      })
  }, [apps, emojiList, addToCatalog])

  return (
    <InstanceContext.Provider value={instance}>
      <EmojiContext.Provider value={emojis}>
        <EmojiCatalogContext.Provider value={emojiCatalog}>
          <UsersContext.Provider value={users}>
            <SetUsersContext.Provider value={setUsers}>
              <TagsContext.Provider value={sortedTags}>
                <SetTagsContext.Provider value={setTags}>
                  {children}
                </SetTagsContext.Provider>
              </TagsContext.Provider>
            </SetUsersContext.Provider>
          </UsersContext.Provider>
        </EmojiCatalogContext.Provider>
      </EmojiContext.Provider>
    </InstanceContext.Provider>
  )
}
