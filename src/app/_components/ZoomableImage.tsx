'use client'

import type { Entity } from 'megalodon'
import { useEffect, useRef } from 'react'
import { RiAddLine, RiRefreshLine, RiSubtractLine } from 'react-icons/ri'
import {
  type ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from 'react-zoom-pan-pinch'

export const ZoomableImage = ({
  media,
  className,
  onZoomChange,
}: {
  media: Entity.Attachment
  className?: string
  onZoomChange?: (isZoomed: boolean) => void
}) => {
  const transformRef = useRef<ReactZoomPanPinchRef>(null)
  const isZoomedRef = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset transform when media changes
  useEffect(() => {
    transformRef.current?.resetTransform()
    isZoomedRef.current = false
  }, [media.id])

  if (media.type !== 'image') return null

  const handleZoomStateChange = (scale: number) => {
    const nowZoomed = scale > 1
    if (nowZoomed !== isZoomedRef.current) {
      isZoomedRef.current = nowZoomed
      onZoomChange?.(nowZoomed)
    }
  }

  return (
    <div className="relative h-full w-full">
      <TransformWrapper
        doubleClick={{ mode: 'reset' }}
        initialScale={1}
        maxScale={8}
        minScale={1}
        onPanning={(ref) => {
          handleZoomStateChange(ref.state.scale)
        }}
        onZoom={(ref) => {
          handleZoomStateChange(ref.state.scale)
        }}
        onZoomStop={(ref) => {
          handleZoomStateChange(ref.state.scale)
        }}
        panning={{ velocityDisabled: false }}
        ref={transformRef}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            <TransformComponent
              contentStyle={{ height: '100%', width: '100%' }}
              wrapperStyle={{ height: '100%', width: '100%' }}
            >
              <img
                alt=""
                className={[
                  'cursor-grab active:cursor-grabbing object-contain',
                  className,
                ].join(' ')}
                draggable={false}
                src={media.url ?? media.preview_url ?? undefined}
              />
            </TransformComponent>
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
              <button
                aria-label="Zoom in"
                className="rounded-full bg-black/70 p-2 text-white"
                onClick={(e) => {
                  e.stopPropagation()
                  zoomIn()
                }}
                type="button"
              >
                <RiAddLine size={20} />
              </button>
              <button
                aria-label="Reset zoom"
                className="rounded-full bg-black/70 p-2 text-white"
                onClick={(e) => {
                  e.stopPropagation()
                  resetTransform()
                  isZoomedRef.current = false
                  onZoomChange?.(false)
                }}
                type="button"
              >
                <RiRefreshLine size={20} />
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
                <RiSubtractLine size={20} />
              </button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  )
}
