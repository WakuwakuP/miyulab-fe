import type { TimelineConfigV2 } from 'types/types'

/** 公開範囲に対応する絵文字マッピング */
const VISIBILITY_EMOJI: Record<string, string> = {
  direct: '✉️',
  private: '🔒',
  public: '🌐',
  unlisted: '🔓',
}

/**
 * TimelineConfigV2 からデフォルトの表示名を生成する
 *
 * v2 スキーマ対応: 新規フィルタオプションに応じたサフィックスを追加する。
 * カスタムラベルが設定されている場合はそのまま返す。
 */
export function getDefaultTimelineName(config: TimelineConfigV2): string {
  // カスタムラベルが設定されている場合はそのまま返す
  if (config.label) {
    return config.label
  }

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

  // サフィックスを収集
  const suffixes: string[] = []

  // メディアフィルタ
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    suffixes.push(`📷${config.minMediaCount}+`)
  } else if (config.onlyMedia) {
    suffixes.push('📷')
  }

  // 公開範囲フィルタ
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

  // 言語フィルタ
  if (config.languageFilter != null && config.languageFilter.length > 0) {
    suffixes.push(`🌍${config.languageFilter.join(',')}`)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    suffixes.push('🚫🔁')
  }

  // リプライ除外
  if (config.excludeReplies) {
    suffixes.push('🚫💬')
  }

  // CW 除外
  if (config.excludeSpoiler) {
    suffixes.push('🚫CW')
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    suffixes.push('🚫⚠️')
  }

  // 通知タイプフィルタ
  // NotificationType は 8 種類: follow, follow_request, mention, reblog, favourite, emoji_reaction, poll_expired, status
  if (
    config.notificationFilter != null &&
    config.notificationFilter.length > 0 &&
    config.notificationFilter.length < 8
  ) {
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
    const emojis = config.notificationFilter
      .map((t) => NOTIFICATION_EMOJI[t] ?? t)
      .join('')
    suffixes.push(emojis)
  }

  // サフィックスの数を最大4つに制限（表示が長くなりすぎるのを防ぐ）
  const maxSuffixes = 4
  const truncatedSuffixes = suffixes.slice(0, maxSuffixes)
  const suffix =
    truncatedSuffixes.length > 0
      ? ` ${truncatedSuffixes.join(' ')}${suffixes.length > maxSuffixes ? '…' : ''}`
      : ''

  return `${baseName}${suffix}`
}
