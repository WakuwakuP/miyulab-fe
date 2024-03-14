/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext } from 'react'

import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
} from 'react-icons/ri'

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

  const onClickPrev = (e) => {
    e.stopPropagation()
    if (index == null) return
    if (index - 1 < 0) return
    setAttachment({
      attachment,
      index: index - 1,
    })
  }
  const onClickNext = (e) => {
    e.stopPropagation()
    if (index == null) return
    if (index + 1 >= attachment.length) return
    setAttachment({
      attachment,
      index: index + 1,
    })
  }

  if (attachment.length === 0 || index == null) return null

  return (
    <Modal
      onClick={() =>
        setAttachment({
          attachment: [],
          index: null,
        })
      }
    >
      <img
        src={attachment[index].url}
        alt=""
        className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw] object-contain"
        loading="lazy"
      />

      {index - 1 >= 0 && (
        <div
          className="fixed left-2 top-1/2 z-[51] -translate-y-1/2 rounded-full bg-gray-50/50"
          onClick={onClickPrev}
        >
          <RiArrowLeftSLine
            size={40}
            className="pr-1"
          />
        </div>
      )}

      {index + 1 < attachment.length && (
        <div
          className="fixed right-2 top-1/2 z-[51] -translate-y-1/2 rounded-full bg-gray-50/50"
          onClick={onClickNext}
        >
          <RiArrowRightSLine
            size={40}
            className="pl-1"
          />
        </div>
      )}
    </Modal>
  )
}
