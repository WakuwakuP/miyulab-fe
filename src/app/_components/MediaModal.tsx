'use client'

import { Modal } from 'app/_parts/Modal'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from 'components/ui/carousel'
import {
  type MouseEventHandler,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { RiArrowLeftSLine, RiArrowRightSLine } from 'react-icons/ri'
import {
  MediaModalContext,
  SetMediaModalContext,
} from 'util/provider/ModalProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import { toSecureResourceUrl } from 'util/secureResourceUrl'
import { ZoomableImage } from './ZoomableImage'

const ModalContent = ({
  onClose,
  onZoomChange,
}: {
  onClose: () => void
  onZoomChange: (isZoomed: boolean) => void
}) => {
  const { attachment, index } = useContext(MediaModalContext)
  const setPlayer = useContext(SetPlayerContext)

  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentSlide, setCurrentSlide] = useState(index ?? 0)
  const isCurrentSlideZoomedRef = useRef(false)
  const mediaElementsRef = useRef<Map<number, HTMLMediaElement>>(new Map())
  const zoomedSlideRef = useRef<Set<number>>(new Set())

  const carouselOpts = useMemo(
    () => ({
      loop: true,
      startIndex: index ?? 0,
      watchDrag: () => !isCurrentSlideZoomedRef.current,
    }),
    [index],
  )

  useEffect(() => {
    if (carouselApi == null) return

    const onSelect = () => {
      const slide = carouselApi.selectedScrollSnap()
      for (const [mediaIndex, mediaElement] of mediaElementsRef.current) {
        if (mediaIndex !== slide) mediaElement.pause()
      }
      setCurrentSlide(slide)
      const nextSlideZoomed = zoomedSlideRef.current.has(slide)
      isCurrentSlideZoomedRef.current = nextSlideZoomed
      onZoomChange(nextSlideZoomed)
    }

    carouselApi.on('select', onSelect)
    return () => {
      carouselApi.off('select', onSelect)
    }
  }, [carouselApi, onZoomChange])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') {
        if (e.target instanceof HTMLMediaElement) return
        carouselApi?.scrollPrev()
      } else if (e.code === 'ArrowRight') {
        if (e.target instanceof HTMLMediaElement) return
        carouselApi?.scrollNext()
      } else if (e.code === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [carouselApi, onClose])

  const onClickPrev: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.stopPropagation()
    carouselApi?.scrollPrev()
  }

  const onClickNext: MouseEventHandler<HTMLButtonElement> = (e) => {
    e.stopPropagation()
    carouselApi?.scrollNext()
  }

  const handleBackgroundClick = useCallback(() => {
    if (isCurrentSlideZoomedRef.current) return
    onClose()
  }, [onClose])

  const openInPlayer = useCallback(
    (mediaIndex: number) => {
      onClose()
      setPlayer({ attachment, index: mediaIndex })
    },
    [attachment, onClose, setPlayer],
  )

  const handleZoomChange = useCallback(
    (slideIndex: number, isZoomed: boolean) => {
      if (isZoomed) {
        zoomedSlideRef.current.add(slideIndex)
      } else {
        zoomedSlideRef.current.delete(slideIndex)
      }
      if (slideIndex === currentSlide) {
        isCurrentSlideZoomedRef.current = isZoomed
        onZoomChange(isZoomed)
      }
    },
    [currentSlide, onZoomChange],
  )

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
              onKeyDownCapture={(event) => {
                if (!(event.target instanceof HTMLMediaElement)) return
                if (event.code === 'Escape') {
                  onClose()
                  event.stopPropagation()
                }
              }}
              opts={carouselOpts}
              setApi={setCarouselApi}
            >
              <CarouselContent>
                {attachment.map((media, slideIndex) => {
                  return (
                    <CarouselItem key={media.id}>
                      <div className="h-[90vh] w-[90vw]">
                        {media.type === 'image' && (
                          <ZoomableImage
                            className="h-[90vh] w-[90vw]"
                            media={media}
                            onBackgroundClick={handleBackgroundClick}
                            onZoomChange={(isZoomed) =>
                              handleZoomChange(slideIndex, isZoomed)
                            }
                          />
                        )}
                        {(media.type === 'video' || media.type === 'gifv') && (
                          <div
                            className="relative flex h-full w-full items-center justify-center"
                            onClick={handleBackgroundClick}
                          >
                            <video
                              aria-label={
                                media.description || `${media.type} attachment`
                              }
                              className="max-h-full max-w-full"
                              controls
                              loop={media.type === 'gifv'}
                              onClick={(event) => event.stopPropagation()}
                              playsInline
                              ref={(element) => {
                                if (element == null) {
                                  mediaElementsRef.current.delete(slideIndex)
                                } else {
                                  mediaElementsRef.current.set(
                                    slideIndex,
                                    element,
                                  )
                                }
                              }}
                              src={toSecureResourceUrl(media.url) ?? undefined}
                            />
                            <button
                              className="absolute right-3 top-3 rounded-md bg-black/70 px-3 py-2 text-sm text-white"
                              onClick={(event) => {
                                event.stopPropagation()
                                openInPlayer(slideIndex)
                              }}
                              type="button"
                            >
                              Open in player
                            </button>
                          </div>
                        )}
                        {media.type === 'audio' && (
                          <div
                            className="relative flex h-full w-full items-center justify-center"
                            onClick={handleBackgroundClick}
                          >
                            <audio
                              aria-label={
                                media.description || 'Audio attachment'
                              }
                              className="w-full max-w-2xl"
                              controls
                              onClick={(event) => event.stopPropagation()}
                              ref={(element) => {
                                if (element == null) {
                                  mediaElementsRef.current.delete(slideIndex)
                                } else {
                                  mediaElementsRef.current.set(
                                    slideIndex,
                                    element,
                                  )
                                }
                              }}
                              src={toSecureResourceUrl(media.url) ?? undefined}
                            />
                            <button
                              className="absolute right-3 top-3 rounded-md bg-black/70 px-3 py-2 text-sm text-white"
                              onClick={(event) => {
                                event.stopPropagation()
                                openInPlayer(slideIndex)
                              }}
                              type="button"
                            >
                              Open in player
                            </button>
                          </div>
                        )}
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
              className="h-[90vh] w-[90vw]"
              media={attachment[index]}
              onBackgroundClick={handleBackgroundClick}
              onZoomChange={(isZoomed) => handleZoomChange(index, isZoomed)}
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

  const closeModal = useCallback(() => {
    setIsZoomed(false)
    setAttachment({
      attachment: [],
      index: null,
    })
  }, [setAttachment])

  if (attachment.length === 0 || index == null) return null

  if (['video', 'gifv', 'audio'].includes(attachment[index].type)) {
    return null
  }

  return (
    <Modal
      onClick={() => {
        if (isZoomed) return
        closeModal()
      }}
    >
      <ModalContent onClose={closeModal} onZoomChange={setIsZoomed} />
    </Modal>
  )
}
