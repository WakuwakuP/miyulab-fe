import type { Entity } from 'megalodon'
import type { ReactNode } from 'react'
import { FaLock, FaLockOpen } from 'react-icons/fa'
import { ImSphere } from 'react-icons/im'
import { RiMailFill } from 'react-icons/ri'

export const Visibility = ({
  visibility,
}: {
  visibility: Entity.StatusVisibility | undefined
}) => {
  if (visibility === undefined) {
    return null
  }

  let icon: ReactNode
  if (visibility === 'public') {
    icon = <ImSphere />
  } else if (visibility === 'unlisted') {
    icon = <FaLockOpen />
  } else if (visibility === 'private') {
    icon = <FaLock />
  } else {
    icon = <RiMailFill />
  }

  return <span>{icon}</span>
}
