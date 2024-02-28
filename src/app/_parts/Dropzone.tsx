/* eslint-disable @next/next/no-img-element */
'use client'

import React, {
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useMemo,
} from 'react'

import imageCompression from 'browser-image-compression'
import { Entity } from 'megalodon'
import { useDropzone } from 'react-dropzone'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

import { Media } from './Media'

export const Dropzone = ({
  children,
  attachments,
  setAttachments,
}: {
  children?: ReactNode
  attachments: Entity.Attachment[]
  setAttachments: Dispatch<
    SetStateAction<Entity.Attachment[]>
  >
}) => {
  const token = useContext(TokenContext)

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const uploadMedia = (file: File) => {
        if (token == null) return
        const client = GetClient(token?.access_token)
        client.uploadMedia(file).then((res) => {
          const Attachment = res.data as Entity.Attachment
          setAttachments((prev) => [...prev, Attachment])
        })
      }

      acceptedFiles.forEach((file) => {
        if (file.type.startsWith('image/')) {
          imageCompression(file, {
            maxSizeMB: 10,
            maxWidthOrHeight: 2560,
            useWebWorker: true,
          }).then((compressedFile) => {
            uploadMedia(compressedFile)
          })
        } else {
          uploadMedia(file)
        }
      })
    },
    [setAttachments, token]
  )

  const {
    getRootProps,
    getInputProps,
    isFocused,
    isDragAccept,
    isDragReject,
  } = useDropzone({
    onDrop,
    accept: {
      'image/*': [],
      'video/*': [],
    },
  })

  const styleClasses = useMemo(
    () =>
      [
        'flex-1 flex flex-col items-center',
        isFocused ? 'border-blue-400' : '',
        isDragAccept ? 'border-green-400' : '',
        isDragReject ? 'border-red-400' : '',
      ].join(' '),
    [isFocused, isDragAccept, isDragReject]
  )

  return (
    <div className="container">
      <div
        className={styleClasses}
        {...getRootProps()}
      >
        <input {...getInputProps()} />
        {children}
      </div>
      {attachments.length > 0 && (
        <div>
          {attachments.map((file, index) => (
            <Media
              key={index}
              media={file}
              className="w-1/3"
            />
          ))}
        </div>
      )}
    </div>
  )
}
