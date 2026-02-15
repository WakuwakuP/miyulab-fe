import type { TimelineConfigV2 } from 'types/types'

/**
 * TimelineConfigV2 からデフォルトの表示名を生成する
 */
export function getDefaultTimelineName(config: TimelineConfigV2): string {
  const baseName = (() => {
    switch (config.type) {
      case 'home':
        return 'Home'
      case 'local':
        return 'Local'
      case 'public':
        return 'Public'
      case 'notification':
        return 'Notification'
      case 'tag': {
        const tags = config.tagConfig?.tags ?? []
        if (tags.length === 0) return 'Tag'
        const mode = config.tagConfig?.mode ?? 'or'
        const separator = mode === 'and' ? ' & ' : ' | '
        return tags.map((tag) => `#${tag}`).join(separator)
      }
      default:
        return 'Unknown'
    }
  })()

  const suffix = config.onlyMedia ? ' 📷' : ''

  return `${baseName}${suffix}`
}
