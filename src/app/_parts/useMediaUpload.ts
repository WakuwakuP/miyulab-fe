'use client'

import imageCompression from 'browser-image-compression'
import type { Entity } from 'megalodon'
import {
  type ClipboardEventHandler,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useContext,
} from 'react'

import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { InstanceContext } from 'util/provider/ResourceProvider'

export const useMediaUpload = ({
  setAttachments,
  setUploading,
  appIndex = 0,
}: {
  setAttachments: Dispatch<SetStateAction<Entity.Attachment[]>>
  setUploading: Dispatch<SetStateAction<number>>
  appIndex?: number
}) => {
  const apps = useContext(AppsContext)
  const instance = useContext(InstanceContext)

  const updateLimit = (instance?.upload_limit ?? 16000000) / 1024 / 1024

  const uploadMedia = useCallback(
    (file: File) => {
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
    },
    [apps, appIndex, setAttachments, setUploading],
  )

  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (e) => {
      if (e.clipboardData.types.includes('Files')) {
        e.preventDefault()
        const files = e.clipboardData.files
        if (files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            setUploading((prev) => prev + 1)
            if (file.type.startsWith('image/')) {
              imageCompression(file, {
                maxSizeMB: updateLimit,
                maxWidthOrHeight: 2048,
                useWebWorker: true,
              })
                .then((compressedFile) => {
                  uploadMedia(compressedFile)
                })
                .catch((error) => {
                  console.error('Failed to compress image:', error)
                  setUploading((prev) => prev - 1)
                })
            } else {
              uploadMedia(file)
            }
          }
        }
      }
    },
    [setUploading, updateLimit, uploadMedia],
  )

  return { onPaste }
}
