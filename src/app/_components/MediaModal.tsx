/* eslint-disable @next/next/no-img-element */
'use client'

import {
  MouseEventHandler,
  useContext,
  useRef,
} from 'react'

import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from 'react-icons/ri'
import Slider from 'react-slick'

import { Media } from 'app/_parts/Media'
import { Modal } from 'app/_parts/Modal'
import {
  MediaModalContext,
  SetMediaModalContext,
} from 'util/provider/ModalProvider'

export const MediaModal = () => {
  const { attachment, index } = useContext(
    MediaModalContext
  )

  const setAttachment = useContext(SetMediaModalContext)

  const sliderRef = useRef<Slider>(null)

  const onClickPrev: MouseEventHandler<
    HTMLButtonElement
  > = (e) => {
    e.stopPropagation()
    sliderRef.current?.slickPrev()
  }

  const onClickNext: MouseEventHandler<
    HTMLButtonElement
  > = (e) => {
    e.stopPropagation()
    sliderRef.current?.slickNext()
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
    <Modal
      onClick={() =>
        setAttachment({
          attachment: [],
          index: null,
        })
      }
    >
      {attachment.length > 1 ? (
        <>
          <div className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw]">
            <Slider
              ref={sliderRef}
              arrows={false}
              infinite
              speed={150}
              initialSlide={index}
              lazyLoad="ondemand"
            >
              {attachment.map((media) => {
                return (
                  <div key={media.id}>
                    <Media
                      media={media}
                      className="h-[90vh] w-[90vw]"
                    />
                  </div>
                )
              })}
            </Slider>
          </div>
          <button
            className="fixed left-3 top-1/2 z-[51] -translate-y-1/2 rounded-full bg-gray-50/50"
            onClick={onClickPrev}
          >
            <RiArrowLeftSLine
              size={60}
              className="pr-1"
            />
          </button>
          <button
            className="fixed right-3 top-1/2 z-[51] -translate-y-1/2 rounded-full bg-gray-50/50"
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
              className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw]"
            />
          )}
        </>
      )}
    </Modal>
  )
}
