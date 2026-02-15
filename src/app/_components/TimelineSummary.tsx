'use client'

import { useContext, useMemo } from 'react'
import type { TimelineConfigV2 } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'

type TimelineSummaryProps = {
  config: TimelineConfigV2
}

export const TimelineSummary = ({ config }: TimelineSummaryProps) => {
  const apps = useContext(AppsContext)

  const backendLabel = useMemo(() => {
    const filter = config.backendFilter

    if (filter == null || filter.mode === 'all') {
      return apps.length > 1 ? 'All accounts' : null
    }

    switch (filter.mode) {
      case 'single': {
        try {
          const hostname = new URL(filter.backendUrl).hostname
          return hostname
        } catch {
          return filter.backendUrl
        }
      }
      case 'composite': {
        const hostnames = filter.backendUrls.map((url) => {
          try {
            return new URL(url).hostname
          } catch {
            return url
          }
        })
        return hostnames.join(', ')
      }
      default:
        return null
    }
  }, [config.backendFilter, apps.length])

  const mediaLabel = config.onlyMedia ? '📷 Media only' : null

  const tagLabel = useMemo(() => {
    if (config.type !== 'tag' || !config.tagConfig) return null

    const { mode, tags } = config.tagConfig
    if (tags.length === 0) return null

    const modeLabel = mode === 'and' ? 'AND' : 'OR'
    const tagList = tags
      .map((t) => `#${t}`)
      .join(mode === 'and' ? ' & ' : ' | ')

    return tags.length > 1 ? `${tagList} (${modeLabel})` : tagList
  }, [config.type, config.tagConfig])

  const parts = [backendLabel, mediaLabel, tagLabel].filter(Boolean)

  if (parts.length === 0) return null

  return (
    <div className="text-xs text-gray-400 mt-0.5 truncate max-w-48">
      {parts.join(' · ')}
    </div>
  )
}
