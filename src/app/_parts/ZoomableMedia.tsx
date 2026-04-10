'use client'

import { Media } from 'app/_parts/Media'
import type { Entity } from 'megalodon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RiZoomInLine, RiZoomOutLine } from 'react-icons/ri'

const MIN_SCALE = 1
const MAX_SCALE = 5
const ZOOM_STEP = 0.5

export const ZoomableMedia = ({
  className,
  media,
}: {
  className?: string
  media: Entity.Attachment
}) => {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })
  const lastTouches = useRef<React.Touch[]>([])

  const clampTranslate = useCallback(
    (nextScale: number, tx: number, ty: number) => {
      const el = containerRef.current
      if (el == null) return { x: tx, y: ty }
      const { width, height } = el.getBoundingClientRect()
      const maxX = (width * (nextScale - 1)) / 2
      const maxY = (height * (nextScale - 1)) / 2
      return {
        x: Math.max(-maxX, Math.min(maxX, tx)),
        y: Math.max(-maxY, Math.min(maxY, ty)),
      }
    },
    [],
  )

  const applyZoom = useCallback(
    (nextScale: number, originX?: number, originY?: number) => {
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale))
      setScale(clamped)
      setTranslate((prev) => {
        if (
          originX != null &&
          originY != null &&
          containerRef.current != null
        ) {
          const rect = containerRef.current.getBoundingClientRect()
          const cx = originX - rect.left - rect.width / 2
          const cy = originY - rect.top - rect.height / 2
          const scaleDelta = clamped / scale
          const tx = cx - scaleDelta * (cx - prev.x)
          const ty = cy - scaleDelta * (cy - prev.y)
          return clampTranslate(clamped, tx, ty)
        }
        return clampTranslate(clamped, prev.x, prev.y)
      })
    },
    [scale, clampTranslate],
  )

  const resetZoom = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  // Wheel zoom
  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.stopPropagation()
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      applyZoom(scale + delta, e.clientX, e.clientY)
    },
    [scale, applyZoom],
  )

  // Mouse drag for pan
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    isDragging.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging.current) return
      const dx = e.clientX - lastPointer.current.x
      const dy = e.clientY - lastPointer.current.y
      lastPointer.current = { x: e.clientX, y: e.clientY }
      setTranslate((prev) => clampTranslate(scale, prev.x + dx, prev.y + dy))
    },
    [scale, clampTranslate],
  )

  const onMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  // Touch events for pinch zoom and pan
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    lastTouches.current = Array.from(e.touches) as unknown as React.Touch[]
  }, [])

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touches = Array.from(e.touches) as unknown as React.Touch[]
      if (touches.length === 2 && lastTouches.current.length === 2) {
        const prevDist = Math.hypot(
          lastTouches.current[0].clientX - lastTouches.current[1].clientX,
          lastTouches.current[0].clientY - lastTouches.current[1].clientY,
        )
        const newDist = Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY,
        )
        const centerX = (touches[0].clientX + touches[1].clientX) / 2
        const centerY = (touches[0].clientY + touches[1].clientY) / 2
        const nextScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, scale * (newDist / prevDist)),
        )
        applyZoom(nextScale, centerX, centerY)
      } else if (touches.length === 1 && lastTouches.current.length === 1) {
        const dx = touches[0].clientX - lastTouches.current[0].clientX
        const dy = touches[0].clientY - lastTouches.current[0].clientY
        setTranslate((prev) => clampTranslate(scale, prev.x + dx, prev.y + dy))
      }
      lastTouches.current = touches
    },
    [scale, applyZoom, clampTranslate],
  )

  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    lastTouches.current = Array.from(e.touches) as unknown as React.Touch[]
  }, [])

  // Keyboard zoom
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        applyZoom(scale + ZOOM_STEP)
      } else if (e.key === '-') {
        applyZoom(scale - ZOOM_STEP)
      } else if (e.key === '0') {
        resetZoom()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scale, applyZoom, resetZoom])

  return (
    <div
      className={['relative overflow-hidden', className].join(' ')}
      onMouseDown={onMouseDown}
      onMouseLeave={onMouseUp}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onWheel={onWheel}
      ref={containerRef}
      style={{
        cursor:
          scale > 1 ? (isDragging.current ? 'grabbing' : 'grab') : 'default',
      }}
    >
      <div
        style={{
          height: '100%',
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: 'center center',
          transition: isDragging.current ? 'none' : 'transform 0.1s ease-out',
          width: '100%',
        }}
      >
        <Media className="h-full w-full" fullSize media={media} />
      </div>
      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 z-10 flex gap-2">
        <button
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          onClick={(e) => {
            e.stopPropagation()
            applyZoom(scale - ZOOM_STEP)
          }}
          title="Zoom out (-)"
          type="button"
        >
          <RiZoomOutLine size={20} />
        </button>
        {scale !== 1 && (
          <button
            className="rounded-full bg-black/60 px-3 py-2 text-xs text-white hover:bg-black/80"
            onClick={(e) => {
              e.stopPropagation()
              resetZoom()
            }}
            title="Reset zoom (0)"
            type="button"
          >
            {Math.round(scale * 100)}%
          </button>
        )}
        <button
          className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          onClick={(e) => {
            e.stopPropagation()
            applyZoom(scale + ZOOM_STEP)
          }}
          title="Zoom in (+)"
          type="button"
        >
          <RiZoomInLine size={20} />
        </button>
      </div>
    </div>
  )
}
