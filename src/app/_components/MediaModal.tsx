/* eslint-disable @next/next/no-img-element */
'use client'

import {
  type MouseEventHandler,
  useContext,
  useEffect,
  useState,
} from 'react'

import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from 'react-icons/ri'

import { Media } from 'app/_parts/Media'
import { Modal } from 'app/_parts/Modal'
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from 'components/ui/carousel'
import {
  MediaModalContext,
  SetMediaModalContext,
} from 'util/provider/ModalProvider'

const ModalContent = () => {
  const { attachment, index } = useContext(
    MediaModalContext
  )

  const [carouselApi, setCarouselApi] =
    useState<CarouselApi>()
  const [currentSlide, setCurrentSlide] = useState(index ?? 0)

  useEffect(() => {
    if (carouselApi == null) return

    const onSelect = () => {
      setCurrentSlide(carouselApi.selectedScrollSnap())
    }

    carouselApi.on('select', onSelect)
    return () => {
      carouselApi.off('select', onSelect)
    }
  }, [carouselApi])

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

  const onClickPrev: MouseEventHandler<
    HTMLButtonElement
  > = (e) => {
    e.stopPropagation()
    carouselApi?.scrollPrev()
  }

  const onClickNext: MouseEventHandler<
    HTMLButtonElement
  > = (e) => {
    e.stopPropagation()
    carouselApi?.scrollNext()
  }

  if (attachment.length === 0 || index == null) return null

  if (
    ['video', 'gifv', 'audio'].includes(
      attachment[index].type
    )
  ) {
    return null
  }
  return (
    <>
      {attachment.length > 1 ? (
        <>
          <div className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw]">
            <Carousel
              setApi={setCarouselApi}
              opts={{
                loop: true,
                startIndex: index,
              }}
            >
              <CarouselContent>
                {attachment.map((media) => {
                  return (
                    <CarouselItem key={media.id}>
                      <div key={media.id}>
                        <Media
                          media={media}
                          className="h-[90vh] max-h-none w-[90vw] max-w-none"
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
          >
            <RiArrowLeftSLine
              size={60}
              className="pr-1"
            />
          </button>
          <button
            className="fixed right-3 top-1/2 z-51 -translate-y-1/2 rounded-full bg-gray-50/50"
            onClick={onClickNext}
          >
            <RiArrowRightSLine
              size={60}
              className="pl-1"
            />
          </button>
        </>
      ) : (
        <>
          {attachment[index].type === 'image' && (
            <Media
              media={attachment[index]}
              className="fixed inset-0 z-50 m-auto h-[90vh] max-h-none w-[90vw] max-w-none"
            />
          )}
        </>
      )}
    </>
  )
}

export const MediaModal = () => {
  const { attachment, index } = useContext(
    MediaModalContext
  )

  const setAttachment = useContext(SetMediaModalContext)

  if (attachment.length === 0 || index == null) return null

  if (
    ['video', 'gifv', 'audio'].includes(
      attachment[index].type
    )
  ) {
    return null
  }

  return (
    <Modal
      onClick={() =>
        setAttachment({
          attachment: [],
          index: null,
        })
      }
    >
      <ModalContent />
    </Modal>
  )
}
