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

function autocompleteMenuListStyle(top: number, left: number): CSSProperties {
  return {
    backgroundColor: 'white',
    border: '1px solid black',
    color: 'black',
    left: left,
    listStyle: 'none',
    margin: 0,
    padding: 0,
    position: 'fixed',
    top: top,
  }
}

function AutocompleteMenuList({
  top,
  left,
  children,
}: Readonly<{
  top: number
  left: number
  children: ReactNode
}>) {
  return (
    <ul data-autocomplete-menu style={autocompleteMenuListStyle(top, left)}>
      {children}
    </ul>
  )
}

function AutocompleteMenuItem({
  selected,
  layout,
  itemIndex,
  complete,
  children,
}: Readonly<{
  selected: boolean
  layout: 'block' | 'flex'
  itemIndex: number
  complete: (index: number) => void
  children: ReactNode
}>) {
  return (
    <li>
      <button
        aria-current={selected ? 'true' : undefined}
        onKeyDown={(e) => {
          selectAutocompleteItem(e, itemIndex, complete)
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          complete(itemIndex)
        }}
        style={autocompleteMenuItemStyle(selected, layout)}
        type="button"
      >
        {children}
      </button>
    </li>
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
    <AutocompleteMenuList left={left} top={top}>
      {chars.map((char, i) => (
        <AutocompleteMenuItem
          complete={complete}
          itemIndex={i}
          key={char.id}
          layout="block"
          selected={index === i}
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
        </AutocompleteMenuItem>
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
    <AutocompleteMenuList left={left} top={top}>
      {chars.map((char, i) => (
        <AutocompleteMenuItem
          complete={complete}
          itemIndex={i}
          key={char.shortcode}
          layout="flex"
          selected={index === i}
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
        </AutocompleteMenuItem>
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
    <AutocompleteMenuList left={left} top={top}>
      {chars.map((char, i) => (
        <AutocompleteMenuItem
          complete={complete}
          itemIndex={i}
          key={char}
          layout="block"
          selected={index === i}
        >
          {char}
        </AutocompleteMenuItem>
      ))}
    </AutocompleteMenuList>
  )
}
