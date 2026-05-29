/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import type { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import type { KeyboardEvent } from 'react'

function selectAutocompleteItem(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  complete: (index: number) => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  complete(index)
}

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
        <button
          key={char.id}
          onKeyDown={(e) => {
            selectAutocompleteItem(e, i, complete)
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            border: 'none',
            cursor: 'pointer',
            display: 'block',
            padding: '4px',
            textAlign: 'left',
            width: '100%',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
          type="button"
        >
          <ProxyImage
            alt={char.display_name}
            className="mr-2 inline-block h-8 w-8 rounded-full"
            height={32}
            src={char.avatar}
            width={32}
          />
          <span>{`@${char.acct}`}</span>
        </button>
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
        <button
          key={char.shortcode}
          onKeyDown={(e) => {
            selectAutocompleteItem(e, i, complete)
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            padding: '4px',
            textAlign: 'left',
            width: '100%',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
          type="button"
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
        </button>
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
        <button
          key={char}
          onKeyDown={(e) => {
            selectAutocompleteItem(e, i, complete)
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
          style={{
            border: 'none',
            cursor: 'pointer',
            display: 'block',
            padding: '4px',
            textAlign: 'left',
            width: '100%',
            ...(index === i && {
              backgroundColor: 'blue',
              color: 'white',
            }),
          }}
          type="button"
        >
          {char}
        </button>
      ))}
    </div>
  )
}
