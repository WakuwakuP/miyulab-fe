'use client'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'components/ui/context-menu'
import Image from 'next/image'
import type { ComponentProps } from 'react'
import { useMemo, useRef } from 'react'
import { toProxiedAttachmentSrc } from 'util/attachmentProxyHosts'

type ProxyImageProps = Omit<ComponentProps<typeof Image>, 'src'> & {
  /** オリジナルの画像URL（https://から始まる完全なURL） */
  src: string
  /** true のときコンテキストメニューを出さない（例: autocomplete 内の行ボタン） */
  disableContextMenu?: boolean
}

export const ProxyImage = ({
  src: originalSrc,
  className,
  disableContextMenu = false,
  ...props
}: ProxyImageProps) => {
  const imgRef = useRef<HTMLImageElement>(null)

  const proxySrc = useMemo(
    () => toProxiedAttachmentSrc(originalSrc),
    [originalSrc],
  )

  const handleOpenInNewTab = () => {
    window.open(originalSrc, '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(originalSrc)
    } catch (error) {
      console.error('Failed to copy link:', error)
    }
  }

  const handleDownload = async () => {
    try {
      // 元のURLから直接ダウンロード
      const response = await fetch(originalSrc)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = originalSrc.split('/').pop() || 'image'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download image:', error)
    }
  }

  const image = (
    <Image
      className={className}
      ref={imgRef}
      src={proxySrc}
      {...props}
      unoptimized
    />
  )

  if (disableContextMenu) {
    return image
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{image}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleOpenInNewTab}>
          新しいタブで開く
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopyLink}>
          リンクをコピー
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleDownload}>画像を保存</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
