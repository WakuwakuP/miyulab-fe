/* eslint-disable @next/next/no-img-element */
'use client'

import { ZoomableImage } from 'app/_components/ZoomableImage'
import { Modal } from 'app/_parts/Modal'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from 'components/ui/carousel'
import {
  type MouseEventHandler,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri'
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import {
  MediaModalContext,
  SetMediaModalContext,
} from 'util/provider/ModalProvider'

const ModalContent = ({
  onZoomChange,
}: {
  onZoomChange: (isZoomed: boolean) => void
}) => {
  const { attachment, index } = useContext(MediaModalContext)

  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentSlide, setCurrentSlide] = useState(index ?? 0)
  const zoomRefs = useRef<Map<string, ReactZoomPanPinchRef>>(new Map())

  useEffect(() => {
    if (carouselApi == null) return

    const onSelect = () => {
      const newSlide = carouselApi.selectedScrollSnap()
      setCurrentSlide(newSlide)
      // Reset zoom on all slides when slide changes
      for (const ref of zoomRefs.current.values()) {
        ref.resetTransform()
      }
      onZoomChange(false)
    }

    carouselApi.on('select', onSelect)
    return () => {
      carouselApi.off('select', onSelect)
    }
  }, [carouselApi, onZoomChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') {
        carouselApi?.scrollPrev()
      } else if (e.code === 'ArrowRight') {
        carouselApi?.scrollNext()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [carouselApi])

  const onClickPrev: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.stopPropagation()
    carouselApi?.scrollPrev()
  }

  const onClickNext: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.stopPropagation()
    carouselApi?.scrollNext()
  }

  if (attachment.length === 0 || index == null) return null

  if (['video', 'gifv', 'audio'].includes(attachment[index].type)) {
    return null
  }
  return (
    <>
      {attachment.length > 1 ? (
        <>
          <div className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw]">
            <Carousel
              opts={{
                loop: true,
                startIndex: index,
                // Disable carousel drag to prevent conflicts with image pan gestures
                watchDrag: false,
              }}
              setApi={setCarouselApi}
            >
              <CarouselContent>
                {attachment.map((media) => {
                  return (
                    <CarouselItem key={media.id}>
                      <div className="h-[90vh] w-[90vw]">
                        <ZoomableImage
                          className="h-[90vh] max-h-none w-[90vw] max-w-none"
                          media={media}
                          onRef={(ref) => {
                            if (ref) {
                              zoomRefs.current.set(media.id, ref)
                            } else {
                              zoomRefs.current.delete(media.id)
                            }
                          }}
                          onZoomChange={onZoomChange}
                        />
                      </div>
                    </CarouselItem>
                  )
                })}
              </CarouselContent>
            </Carousel>
          </div>
          <div className="fixed right-4 top-4 z-51 rounded-md bg-black/70 px-2 py-1 text-sm text-white">
            {currentSlide + 1}/{attachment.length}
          </div>
          <button
            className="fixed left-3 top-1/2 z-51 -translate-y-1/2 rounded-full bg-gray-50/50"
            onClick={onClickPrev}
            type="button"
          >
            <RiArrowLeftSLine className="pr-1" size={60} />
          </button>
          <button
            className="fixed right-3 top-1/2 z-51 -translate-y-1/2 rounded-full bg-gray-50/50"
            onClick={onClickNext}
            type="button"
          >
            <RiArrowRightSLine className="pl-1" size={60} />
          </button>
        </>
      ) : (
        attachment[index].type === 'image' && (
          <div className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw]">
            <ZoomableImage
              className="h-[90vh] max-h-none w-[90vw] max-w-none"
              media={attachment[index]}
              onZoomChange={onZoomChange}
            />
          </div>
        )
      )}
    </>
  )
}

export const MediaModal = () => {
  const { attachment, index } = useContext(MediaModalContext)

  const setAttachment = useContext(SetMediaModalContext)
  const [isZoomed, setIsZoomed] = useState(false)

  if (attachment.length === 0 || index == null) return null

  if (['video', 'gifv', 'audio'].includes(attachment[index].type)) {
    return null
  }

  return (
    <Modal
      onClick={() => {
        if (isZoomed) return
        setAttachment({
          attachment: [],
          index: null,
        })
      }}
    >
      <ModalContent onZoomChange={setIsZoomed} />
    </Modal>
  )
}
