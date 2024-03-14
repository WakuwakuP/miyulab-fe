import { DetailPanel } from 'app/_components/DetailPanel'
import { HomeTimeline } from 'app/_components/HomeTimeline'
import { MainPanel } from 'app/_components/MainPanel'
import { MediaModal } from 'app/_components/MediaModal'
import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { PublicTimeline } from 'app/_components/PublicTimeline'
import { TagTimeline } from 'app/_components/TagTimeline'

export default function Home() {
  return (
    <main className="flex overflow-y-visible overflow-x-scroll [&>*]:w-[calc(100vw/6)] [&>*]:min-w-60 [&>*]:shrink-0">
      <MainPanel />
      <HomeTimeline />
      <NotificationTimeline />
      <TagTimeline tag="gochisou_photo" />
      <PublicTimeline />
      <DetailPanel />
      <MediaModal />
    </main>
  )
}
