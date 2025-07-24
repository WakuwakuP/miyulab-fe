'use client'

import { HomeTimeline } from 'app/_components/HomeTimeline'
import { LocalTimeline } from 'app/_components/LocalTimeline'
import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { PublicTimeline } from 'app/_components/PublicTimeline'
import { TagTimeline } from 'app/_components/TagTimeline'
import { type TimelineConfig } from 'types/types'

export const DynamicTimeline = ({
  config,
}: {
  config: TimelineConfig
}) => {
  if (!config.visible) {
    return null
  }

  switch (config.type) {
    case 'home':
      return <HomeTimeline />
    case 'local':
      return <LocalTimeline />
    case 'public':
      return <PublicTimeline />
    case 'notification':
      return <NotificationTimeline />
    case 'tag':
      return <TagTimeline tag={config.tag ?? ''} />
    default:
      return null
  }
}
