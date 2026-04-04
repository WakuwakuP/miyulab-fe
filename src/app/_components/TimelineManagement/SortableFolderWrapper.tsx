'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/** フォルダをドラッグ可能にするラッパー */
export const SortableFolderWrapper = ({
  children,
  id,
}: {
  children: (props: {
    attributes: React.HTMLAttributes<HTMLElement>
    isDragging: boolean
    // biome-ignore lint/complexity/noBannedTypes: matches @dnd-kit SyntheticListenerMap type
    listeners: Record<string, Function> | undefined
  }) => React.ReactNode
  id: string
}) => {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, isDragging, listeners })}
    </div>
  )
}
