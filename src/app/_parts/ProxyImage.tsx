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
import { useEffect, useMemo, useRef } from 'react'

type ProxyImageProps = Omit<ComponentProps<typeof Image>, 'src'> & {
  /** オリジナルの画像URL（https://から始まる完全なURL） */
  src: string
}

export const ProxyImage = ({
  src: originalSrc,
  className,
  ...props
}: ProxyImageProps) => {
  const imgRef = useRef<HTMLImageElement>(null)

  // 元のURLからプロキシURLを生成
  const proxySrc = useMemo(() => {
    try {
      const u = new URL(originalSrc)
      const host = u.host
      const path = u.pathname.replace(/^\//, '')
      const qs = u.search ? `?${u.searchParams.toString()}` : ''
      // If there's no path (i.e., root), avoid trailing slash duplication
      const proxiedPath = path ? `/${path}` : ''
      return `/api/attachment/${host}${proxiedPath}${qs}`
    } catch {
      // URLのパースに失敗した場合は元のURLをそのまま使用
      return originalSrc
    }
  }, [originalSrc])

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
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download image:', error)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Image className={className} ref={imgRef} src={proxySrc} {...props} />
      </ContextMenuTrigger>
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
