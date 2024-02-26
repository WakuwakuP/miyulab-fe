import { Entity } from 'megalodon'
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

  return (
    <span>
      {visibility === 'public' ? (
        <ImSphere />
      ) : visibility === 'unlisted' ? (
        <FaLockOpen />
      ) : visibility === 'private' ? (
        <FaLock />
      ) : (
        <RiMailFill />
      )}
    </span>
  )
}
