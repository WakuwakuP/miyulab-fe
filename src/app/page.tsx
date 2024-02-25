import Image from 'next/image'
import { HomeTimeline } from './_components/HomeTimeline'
import { PublicTimeline } from './_components/PublicTimeline'
import { TagTimeline } from './_components/TagTimeline'

export default function Home() {
  return (
    <main className="grid grid-cols-[repeat(auto-fill,_minmax(23.5rem,_1fr))]">
      <HomeTimeline />
      <TagTimeline tag="gochisou_photo" />
      <PublicTimeline />
    </main>
  )
}
