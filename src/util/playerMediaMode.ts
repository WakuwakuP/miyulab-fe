import type { Entity } from 'megalodon'

import { isExternalVideo } from 'util/videoEmbed'

export const PLAYABLE_ATTACHMENT_TYPES = ['audio', 'video', 'gifv'] as const

export type PlayableAttachmentType = (typeof PLAYABLE_ATTACHMENT_TYPES)[number]

export type PlayerMediaMode =
  | 'native'
  | 'iframe'
  | 'fallback'
  | 'image'
  | 'none'

export type PlayerControlCapabilities = {
  canPlayPause: boolean
  canSeek: boolean
  canVolume: boolean
  canPrevNext: boolean
  canClose: boolean
}

export function isPlayableAttachmentType(
  type: Entity.Attachment['type'],
): type is PlayableAttachmentType {
  return (PLAYABLE_ATTACHMENT_TYPES as readonly string[]).includes(type)
}

/**
 * Derive how the current attachment should be rendered / controlled.
 * - native: ReactPlayer (direct media)
 * - iframe: credentialless external embed (YouTube etc.)
 * - fallback: embed failed; thumbnail + external link only
 * - image: still image attachment
 * - none: missing / unsupported
 */
export function resolvePlayerMediaMode({
  attachmentType,
  currentUrl,
  externalEmbedFailed,
}: {
  attachmentType: Entity.Attachment['type'] | null | undefined
  currentUrl: string
  externalEmbedFailed: boolean
}): PlayerMediaMode {
  if (attachmentType == null) return 'none'
  if (attachmentType === 'image') return 'image'
  if (!isPlayableAttachmentType(attachmentType)) return 'none'
  if (currentUrl === '') return 'none'

  if (!isExternalVideo(currentUrl)) return 'native'
  if (externalEmbedFailed) return 'fallback'
  return 'iframe'
}

export function getPlayerControlCapabilities(
  mediaMode: PlayerMediaMode,
  trackCount: number,
): PlayerControlCapabilities {
  const isNative = mediaMode === 'native'
  return {
    canClose: mediaMode !== 'none',
    canPlayPause: isNative,
    canPrevNext: trackCount > 1 && mediaMode !== 'none',
    canSeek: isNative,
    canVolume: isNative,
  }
}

export type PlayerSizeTokens = {
  hClass: string
  hPx: string
  wClass: string
}

export function getPlayerSizeTokens(
  playerSize: 'small' | 'medium' | 'large',
): PlayerSizeTokens {
  switch (playerSize) {
    case 'small':
      return { hClass: 'h-[180px]', hPx: '180px', wClass: 'w-[320px]' }
    case 'medium':
      return { hClass: 'h-[360px]', hPx: '360px', wClass: 'w-[640px]' }
    case 'large':
      return { hClass: 'h-[460px]', hPx: '460px', wClass: 'w-[820px]' }
  }
}

/**
 * Whether player keyboard shortcuts should be ignored for editable /
 * autocomplete targets. Focus outside `[data-player]` is intentionally allowed
 * while the player is open (portal-rendered UI).
 */
export function shouldIgnorePlayerKeydownTarget(
  target: EventTarget | null,
): boolean {
  if (target == null) return true
  // Node/HTML*Element are browser globals; keep this safe for node unit tests.
  if (typeof Node === 'undefined' || !(target instanceof Node)) return true
  if (
    typeof HTMLInputElement !== 'undefined' &&
    target instanceof HTMLInputElement
  ) {
    return true
  }
  if (
    typeof HTMLSelectElement !== 'undefined' &&
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  if (
    typeof HTMLTextAreaElement !== 'undefined' &&
    target instanceof HTMLTextAreaElement
  ) {
    return true
  }
  if (
    typeof HTMLElement !== 'undefined' &&
    target instanceof HTMLElement &&
    target.closest('[data-autocomplete-menu]') != null
  ) {
    return true
  }
  return false
}
