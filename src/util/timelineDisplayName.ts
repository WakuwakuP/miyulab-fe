import type { TimelineConfigV2 } from 'types/types'

/** 公開範囲に対応する絵文字マッピング */
const VISIBILITY_EMOJI: Record<string, string> = {
  direct: '✉️',
  private: '🔒',
  public: '🌐',
  unlisted: '🔓',
}

/** NotificationType は 8 種類 */
const NOTIFICATION_EMOJI: Record<string, string> = {
  favourite: '⭐',
  follow: '👤',
  follow_request: '👤❓',
  mention: '💬',
  poll_expired: '📊',
  reaction: '😀',
  reblog: '🔁',
  status: '📝',
}

function getTimelineTypeBaseName(config: TimelineConfigV2): string {
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
}

function collectTimelineSuffixes(config: TimelineConfigV2): string[] {
  const suffixes: string[] = []

  if (config.minMediaCount != null && config.minMediaCount > 0) {
    suffixes.push(`📷${config.minMediaCount}+`)
  } else if (config.onlyMedia) {
    suffixes.push('📷')
  }

  if (
    config.visibilityFilter != null &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    const emojis = config.visibilityFilter
      .map((v) => VISIBILITY_EMOJI[v] ?? v)
      .join('')
    suffixes.push(emojis)
  }

  if (config.languageFilter != null && config.languageFilter.length > 0) {
    suffixes.push(`🌍${config.languageFilter.join(',')}`)
  }

  if (config.excludeReblogs) suffixes.push('🚫🔁')
  if (config.excludeReplies) suffixes.push('🚫💬')
  if (config.excludeSpoiler) suffixes.push('🚫CW')
  if (config.excludeSensitive) suffixes.push('🚫⚠️')

  if (
    config.notificationFilter != null &&
    config.notificationFilter.length > 0 &&
    config.notificationFilter.length < 8
  ) {
    const emojis = config.notificationFilter
      .map((t) => NOTIFICATION_EMOJI[t] ?? t)
      .join('')
    suffixes.push(emojis)
  }

  return suffixes
}

function formatTimelineSuffix(suffixes: string[]): string {
  const maxSuffixes = 4
  const truncatedSuffixes = suffixes.slice(0, maxSuffixes)
  if (truncatedSuffixes.length === 0) return ''
  const overflow = suffixes.length > maxSuffixes ? '…' : ''
  return ` ${truncatedSuffixes.join(' ')}${overflow}`
}

/**
 * TimelineConfigV2 からデフォルトの表示名を生成する
 *
 * v2 スキーマ対応: 新規フィルタオプションに応じたサフィックスを追加する。
 * カスタムラベルが設定されている場合はそのまま返す。
 */
export function getDefaultTimelineName(config: TimelineConfigV2): string {
  if (config.label) {
    return config.label
  }

  const baseName = getTimelineTypeBaseName(config)
  const suffix = formatTimelineSuffix(collectTimelineSuffixes(config))
  return `${baseName}${suffix}`
}
