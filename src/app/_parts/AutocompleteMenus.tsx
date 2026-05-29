/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import type { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'

function selectAutocompleteItem(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  complete: (index: number) => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  event.stopPropagation()
  complete(index)
}

/** Reset native button appearance so rows match the previous div-based list. */
const autocompleteMenuItemBaseStyle = {
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontFamily: 'inherit',
  margin: 0,
  padding: '4px',
  textAlign: 'left' as const,
  width: '100%',
}

function autocompleteMenuItemStyle(
  selected: boolean,
  layout: 'block' | 'flex',
): CSSProperties {
  return {
    ...autocompleteMenuItemBaseStyle,
    display: layout,
    ...(selected && {
      backgroundColor: 'blue',
      color: 'white',
    }),
  }
}

const autocompleteMenuContainerStyle: CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid black',
  color: 'black',
  listStyle: 'none',
  margin: 0,
  padding: 0,
  position: 'fixed',
}

const autocompleteMenuItemWrapperStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

function AutocompleteMenuList({
  ariaLabel,
  top,
  left,
  children,
}: {
  ariaLabel: string
  top: number
  left: number
  children: ReactNode
}) {
  return (
    <ul
      aria-label={ariaLabel}
      data-autocomplete-menu
      style={{
        ...autocompleteMenuContainerStyle,
        left,
        top,
      }}
    >
      {children}
    </ul>
  )
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
    <AutocompleteMenuList ariaLabel="Mention suggestions" left={left} top={top}>
      {chars.map((char, i) => (
        <li key={char.id} style={autocompleteMenuItemWrapperStyle}>
          <button
            aria-current={index === i ? 'true' : undefined}
            onKeyDown={(e) => {
              selectAutocompleteItem(e, i, complete)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              complete(i)
            }}
            style={autocompleteMenuItemStyle(index === i, 'block')}
            type="button"
          >
            <ProxyImage
              alt={char.display_name}
              className="mr-2 inline-block h-8 w-8 rounded-full"
              disableContextMenu
              height={32}
              src={char.avatar}
              width={32}
            />
            <span>{`@${char.acct}`}</span>
          </button>
        </li>
      ))}
    </AutocompleteMenuList>
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
    <AutocompleteMenuList ariaLabel="Emoji suggestions" left={left} top={top}>
      {chars.map((char, i) => (
        <li key={char.shortcode} style={autocompleteMenuItemWrapperStyle}>
          <button
            aria-current={index === i ? 'true' : undefined}
            onKeyDown={(e) => {
              selectAutocompleteItem(e, i, complete)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              complete(i)
            }}
            style={autocompleteMenuItemStyle(index === i, 'flex')}
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
        </li>
      ))}
    </AutocompleteMenuList>
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
    <AutocompleteMenuList ariaLabel="Hashtag suggestions" left={left} top={top}>
      {chars.map((char, i) => (
        <li key={char} style={autocompleteMenuItemWrapperStyle}>
          <button
            aria-current={index === i ? 'true' : undefined}
            onKeyDown={(e) => {
              selectAutocompleteItem(e, i, complete)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              complete(i)
            }}
            style={autocompleteMenuItemStyle(index === i, 'block')}
            type="button"
          >
            {char}
          </button>
        </li>
      ))}
    </AutocompleteMenuList>
  )
}
