export const EditedAt = ({ editedAt }: { editedAt: string | null }) => {
  if (editedAt == null) return null

  const editedAtToDate = new Date(editedAt)
  const fullYear = editedAtToDate.getFullYear()
  const month = (editedAtToDate.getMonth() + 1).toString().padStart(2, '0')
  const date = editedAtToDate.getDate().toString().padStart(2, '0')
  const hours = editedAtToDate.getHours().toString().padStart(2, '0')

  const minutes = editedAtToDate.getMinutes().toString().padStart(2, '0')

  const dateString = `${fullYear}/${month}/${date}`
  const timeString = `${hours}:${minutes}`

  return (
    <div className="text-xs text-gray-400">
      Edited at {dateString} {timeString}
    </div>
  )
}
