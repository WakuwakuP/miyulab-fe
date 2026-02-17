import type { TimelineConfigV2 } from 'types/types'
import {
  buildInstanceBlockCondition,
  buildMuteCondition,
} from 'util/queryBuilder'

/**
 * TimelineConfigV2 の v2 フィルタオプションから
 * SQL WHERE 句の条件配列とバインド変数を生成する。
 *
 * useFilteredTimeline / useFilteredTagTimeline / useCustomQueryTimeline
 * で共有して使用する。
 *
 * ## 生成される条件
 *
 * - s.has_media / s.media_count（メディアフィルタ）
 * - s.visibility（公開範囲フィルタ）
 * - s.language（言語フィルタ、NULL は常に表示）
 * - s.is_reblog（ブースト除外）
 * - s.in_reply_to_id（リプライ除外）
 * - s.has_spoiler（CW 除外）
 * - s.is_sensitive（センシティブ除外）
 * - s.account_acct（アカウントフィルタ）
 * - muted_accounts サブクエリ（ミュート除外）
 * - blocked_instances サブクエリ（インスタンスブロック除外）
 *
 * ## 注意
 *
 * backendUrl フィルタは呼び出し元が個別に追加するため、
 * この関数では生成しない。
 */
export function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
): { conditions: string[]; binds: (string | number)[] } {
  const conditions: string[] = []
  const binds: (string | number)[] = []

  // メディアフィルタ
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    conditions.push('s.media_count >= ?')
    binds.push(config.minMediaCount)
  } else if (config.onlyMedia) {
    conditions.push('s.has_media = 1')
  }

  // 公開範囲フィルタ
  if (
    config.visibilityFilter != null &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    const placeholders = config.visibilityFilter.map(() => '?').join(',')
    conditions.push(`s.visibility IN (${placeholders})`)
    binds.push(...config.visibilityFilter)
  }

  // 言語フィルタ（NULL は常に表示）
  if (config.languageFilter != null && config.languageFilter.length > 0) {
    const placeholders = config.languageFilter.map(() => '?').join(',')
    conditions.push(`(s.language IN (${placeholders}) OR s.language IS NULL)`)
    binds.push(...config.languageFilter)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    conditions.push('s.is_reblog = 0')
  }

  // リプライ除外
  if (config.excludeReplies) {
    conditions.push('s.in_reply_to_id IS NULL')
  }

  // CW 付き除外
  if (config.excludeSpoiler) {
    conditions.push('s.has_spoiler = 0')
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    conditions.push('s.is_sensitive = 0')
  }

  // アカウントフィルタ
  if (config.accountFilter != null && config.accountFilter.accts.length > 0) {
    const placeholders = config.accountFilter.accts.map(() => '?').join(',')
    if (config.accountFilter.mode === 'include') {
      conditions.push(`s.account_acct IN (${placeholders})`)
    } else {
      conditions.push(`s.account_acct NOT IN (${placeholders})`)
    }
    binds.push(...config.accountFilter.accts)
  }

  // ミュートアカウント除外
  // accountFilter が include モードの場合はミュートを適用しない
  // （明示的に指定ユーザーの投稿を見たい場合にミュートで消えるのは不適切）
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    const mute = buildMuteCondition(targetBackendUrls)
    conditions.push(mute.sql)
    binds.push(...mute.binds)
  }

  // インスタンスブロック除外
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    conditions.push(buildInstanceBlockCondition())
  }

  return { binds, conditions }
}
