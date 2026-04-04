/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import type { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'

export const MentionMenu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: Pick<Entity.Account, 'id' | 'acct' | 'avatar' | 'display_name'>[]
  index: number
  top: number
  left: number
  complete: (index: number) => void
}) => {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: '1px solid black',
        color: 'black',
        left: left,
        position: 'fixed',
        top: top,
      }}
    >
      {chars.map((char, i) => (
        <div
          key={char.id}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            padding: '4px',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
        >
          <ProxyImage
            alt={char.display_name}
            className="mr-2 inline-block h-8 w-8 rounded-full"
            height={32}
            src={char.avatar}
            width={32}
          />
          <span>{`@${char.acct}`}</span>
        </div>
      ))}
    </div>
  )
}

export const EmojiMenu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: Entity.Emoji[]
  index: number
  top: number
  left: number
  complete: (index: number) => void
}) => {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: '1px solid black',
        color: 'black',
        left: left,
        position: 'fixed',
        top: top,
      }}
    >
      {chars.map((char, i) => (
        <div
          key={char.shortcode}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            display: 'flex',
            padding: '4px',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
        >
          {char.url === '' ? (
            <div>{Emoji.emojify(`:${char.shortcode}:`)}</div>
          ) : (
            <img
              alt={char.shortcode}
              className="mr-1 h-6 w-6"
              loading="lazy"
              src={char.url}
            />
          )}
          <div>:{char.shortcode}:</div>
        </div>
      ))}
    </div>
  )
}

export const TagMenu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: string[]
  index: number
  top: number
  left: number
  complete: (index: number) => void
}) => {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: '1px solid black',
        color: 'black',
        left: left,
        position: 'fixed',
        top: top,
      }}
    >
      {chars.map((char, i) => (
        <div
          key={char}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            padding: '4px',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
        >
          {char}
        </div>
      ))}
    </div>
  )
}
