'use client'

import { Media } from 'app/_parts/Media'
import type { Entity } from 'megalodon'
import { useEffect, useRef } from 'react'
import { RiRefreshLine, RiZoomInLine, RiZoomOutLine } from 'react-icons/ri'
import {
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from 'react-zoom-pan-pinch'

export const ZoomableImage = ({
  media,
  className,
  onZoomChange,
  onRef,
}: {
  media: Entity.Attachment
  className?: string
  onZoomChange?: (isZoomed: boolean) => void
  onRef?: (ref: ReactZoomPanPinchRef | null) => void
}) => {
  const transformRef = useRef<ReactZoomPanPinchRef>(null)

  useEffect(() => {
    onRef?.(transformRef.current)
    return () => {
      onRef?.(null)
    }
  }, [onRef])

  return (
    <TransformWrapper
      doubleClick={{ disabled: false }}
      initialScale={1}
      maxScale={8}
      minScale={1}
      onPanning={(ref) => {
        onZoomChange?.(ref.state.scale > 1)
      }}
      onZoom={(ref) => {
        onZoomChange?.(ref.state.scale > 1)
      }}
      // Disable inertia/velocity so panning stops immediately on release
      panning={{ velocityDisabled: true }}
      ref={transformRef}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <div className="relative h-full w-full">
          <TransformComponent
            contentStyle={{ height: '100%', width: '100%' }}
            wrapperStyle={{ height: '100%', width: '100%' }}
          >
            <Media className={className} fullSize media={media} />
          </TransformComponent>
          <div className="absolute bottom-4 right-4 z-10 flex gap-2">
            <button
              aria-label="Zoom in"
              className="rounded-full bg-black/70 p-2 text-white"
              onClick={(e) => {
                e.stopPropagation()
                zoomIn()
              }}
              type="button"
            >
              <RiZoomInLine size={20} />
            </button>
            <button
              aria-label="Zoom out"
              className="rounded-full bg-black/70 p-2 text-white"
              onClick={(e) => {
                e.stopPropagation()
                zoomOut()
              }}
              type="button"
            >
              <RiZoomOutLine size={20} />
            </button>
            <button
              aria-label="Reset zoom"
              className="rounded-full bg-black/70 p-2 text-white"
              onClick={(e) => {
                e.stopPropagation()
                resetTransform()
              }}
              type="button"
            >
              <RiRefreshLine size={20} />
            </button>
          </div>
        </div>
      )}
    </TransformWrapper>
  )
}

export type { ReactZoomPanPinchRef }
