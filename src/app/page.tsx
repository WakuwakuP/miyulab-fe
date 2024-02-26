import { DetailPanel } from 'app/_components/DetailPanel'
import { HomeTimeline } from 'app/_components/HomeTimeline'
import { MainPanel } from 'app/_components/MainPanel'
import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { PublicTimeline } from 'app/_components/PublicTimeline'
import { TagTimeline } from 'app/_components/TagTimeline'

export default function Home() {
  return (
    <main className="grid grid-cols-[repeat(auto-fill,_minmax(18rem,_1fr))]">
      <MainPanel />
      <HomeTimeline />
      <NotificationTimeline />
      <TagTimeline tag="gochisou_photo" />
      <PublicTimeline />
      <DetailPanel />
    </main>
  )
}
