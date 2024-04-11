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
import { CgSpinner } from 'react-icons/cg'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import { InstanceContext } from 'util/provider/ResourceProvider'

import { Media } from './Media'

export const Dropzone = ({
  children,
  attachments,
  setAttachments,
  uploading,
  setUploading,
}: {
  children?: ReactNode
  attachments: Entity.Attachment[]
  setAttachments: Dispatch<
    SetStateAction<Entity.Attachment[]>
  >
  uploading: number
  setUploading: Dispatch<SetStateAction<number>>
}) => {
  const token = useContext(TokenContext)
  const instance = useContext(InstanceContext)

  const update_limit =
    (instance?.upload_limit ?? 16000000) / 1024 / 1024

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const uploadMedia = (file: File) => {
        if (token == null) return
        const client = GetClient(token?.access_token)
        client
          .uploadMedia(file)
          .then((res) => {
            const Attachment = res.data as Entity.Attachment
            setAttachments((prev) => [...prev, Attachment])
          })
          .finally(() => {
            setUploading((prev) => prev - 1)
          })
      }

      acceptedFiles.forEach((file) => {
        setUploading((prev) => prev + 1)
        if (file.type.startsWith('image/')) {
          imageCompression(file, {
            maxSizeMB: update_limit,
            maxWidthOrHeight: 2048,
            useWebWorker: true,
          }).then((compressedFile) => {
            uploadMedia(compressedFile)
          })
        } else {
          uploadMedia(file)
        }
      })
    },
    [setAttachments, setUploading, token, update_limit]
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
      {uploading > 0 && <div></div>}
      {(attachments.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap">
          {attachments.map((file, index) => {
            switch (attachments.length) {
              case 1:
                return (
                  <Media
                    key={index}
                    media={file}
                    className="w-full"
                  />
                )
              default:
                return (
                  <Media
                    key={index}
                    media={file}
                    className="h-32 w-1/2"
                  />
                )
            }
          })}
          {(() => {
            const list = []
            for (let i = 0; i < uploading; i++) {
              list.push(
                <div className="flex h-32 w-1/2 items-center justify-center border bg-gray-600">
                  <CgSpinner
                    size={32}
                    className="animate-spin"
                  />
                </div>
              )
            }
            return list
          })()}
        </div>
      )}
    </div>
  )
}
