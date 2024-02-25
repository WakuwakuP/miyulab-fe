import { HomeTimeline } from 'app/_components/HomeTimeline'
import { PublicTimeline } from 'app/_components/PublicTimeline'
import { TagTimeline } from 'app/_components/TagTimeline'
import { NotificationTimeline } from 'app/_components/NotificationTimeline'

export default function Home() {
  return (
    <main className="grid grid-cols-[repeat(auto-fill,_minmax(20rem,_1fr))]">
      <HomeTimeline />
      <NotificationTimeline />
      <TagTimeline tag="gochisou_photo" />
      <PublicTimeline />
    </main>
  )
}
