/* eslint-disable @next/next/no-img-element */
'use client'

import imageCompression from 'browser-image-compression'
import type { Entity } from 'megalodon'
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import { useDropzone } from 'react-dropzone'
import { CgSpinner } from 'react-icons/cg'

import type { App } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { InstanceContext } from 'util/provider/ResourceProvider'

import { Media } from './Media'

const uploadDroppedMedia = (
  file: File,
  apps: App[],
  appIndex: number,
  setAttachments: Dispatch<SetStateAction<Entity.Attachment[]>>,
  setUploading: Dispatch<SetStateAction<number>>,
) => {
  if (apps.length <= 0) return
  const client = GetClient(apps[appIndex])
  client
    .uploadMedia(file)
    .then((res) => {
      const Attachment = res.data as Entity.Attachment
      setAttachments((prev) => [...prev, Attachment])
    })
    .catch((error) => {
      console.error('Failed to upload media:', error)
    })
    .finally(() => {
      setUploading((prev) => prev - 1)
    })
}

const processDroppedFile = (
  file: File,
  updateLimit: number,
  apps: App[],
  appIndex: number,
  setAttachments: Dispatch<SetStateAction<Entity.Attachment[]>>,
  setUploading: Dispatch<SetStateAction<number>>,
) => {
  setUploading((prev) => prev + 1)
  if (file.type.startsWith('image/')) {
    imageCompression(file, {
      maxSizeMB: updateLimit,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
    })
      .then((compressedFile) => {
        uploadDroppedMedia(
          compressedFile,
          apps,
          appIndex,
          setAttachments,
          setUploading,
        )
      })
      .catch((error) => {
        console.error('Failed to compress image:', error)
        setUploading((prev) => prev - 1)
      })
  } else {
    uploadDroppedMedia(file, apps, appIndex, setAttachments, setUploading)
  }
}

export const Dropzone = ({
  children,
  attachments,
  setAttachments,
  uploading,
  setUploading,
  appIndex = 0,
}: {
  children?: ReactNode
  attachments: Entity.Attachment[]
  setAttachments: Dispatch<SetStateAction<Entity.Attachment[]>>
  uploading: number
  setUploading: Dispatch<SetStateAction<number>>
  appIndex?: number
}) => {
  const apps = useContext(AppsContext)
  const instance = useContext(InstanceContext)

  const update_limit = (instance?.upload_limit ?? 16000000) / 1024 / 1024

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach((file) => {
        processDroppedFile(
          file,
          update_limit,
          apps,
          appIndex,
          setAttachments,
          setUploading,
        )
      })
    },
    [apps, appIndex, setAttachments, setUploading, update_limit],
  )

  const { getRootProps, getInputProps, isFocused, isDragAccept, isDragReject } =
    useDropzone({
      accept: {
        'image/*': [],
        'video/*': [],
      },
      onDrop,
    })

  const styleClasses = useMemo(
    () =>
      [
        'flex-1 flex flex-col items-center',
        isFocused ? 'border-blue-400' : '',
        isDragAccept ? 'border-green-400' : '',
        isDragReject ? 'border-red-400' : '',
      ].join(' '),
    [isFocused, isDragAccept, isDragReject],
  )

  return (
    <div className="container">
      <div className={styleClasses} {...getRootProps()}>
        <input {...getInputProps()} />
        {children}
      </div>
      {uploading > 0 && <div></div>}
      {(attachments.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap">
          {attachments.map((file) => {
            switch (attachments.length) {
              case 1:
                return <Media className="w-full" key={file.id} media={file} />
              default:
                return (
                  <Media className="h-32 w-1/2" key={file.id} media={file} />
                )
            }
          })}
          {(() => {
            const list = []
            for (let i = 0; i < uploading; i++) {
              list.push(
                <div
                  className="flex h-32 w-1/2 items-center justify-center border bg-gray-600"
                  key={i}
                >
                  <CgSpinner className="animate-spin" size={32} />
                </div>,
              )
            }
            return list
          })()}
        </div>
      )}
    </div>
  )
}
