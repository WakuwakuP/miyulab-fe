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
 * - has_media / media_count（メディアフィルタ）
 * - visibility（公開範囲フィルタ）
 * - language（言語フィルタ、NULL は常に表示）
 * - is_reblog（ブースト除外）
 * - in_reply_to_id（リプライ除外）
 * - has_spoiler（CW 除外）
 * - is_sensitive（センシティブ除外）
 * - account_acct（アカウントフィルタ）
 * - muted_accounts サブクエリ（ミュート除外）
 * - blocked_instances サブクエリ（インスタンスブロック除外）
 *
 * ## 注意
 *
 * backendUrl フィルタは呼び出し元が個別に追加するため、
 * この関数では生成しない。
 *
 * @param tableAlias カラム参照に付けるテーブルエイリアス。
 *   デフォルトは 's'（statuses テーブル直接参照時）。
 *   マテリアライズド・ビューのサブクエリ内で使用する場合は '' を指定する。
 */
export function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias = 's',
): { conditions: string[]; binds: (string | number)[] } {
  const conditions: string[] = []
  const binds: (string | number)[] = []
  const prefix = tableAlias ? `${tableAlias}.` : ''

  // メディアフィルタ
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    conditions.push(`${prefix}media_count >= ?`)
    binds.push(config.minMediaCount)
  } else if (config.onlyMedia) {
    conditions.push(`${prefix}has_media = 1`)
  }

  // 公開範囲フィルタ
  if (
    config.visibilityFilter != null &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    const placeholders = config.visibilityFilter.map(() => '?').join(',')
    conditions.push(`${prefix}visibility IN (${placeholders})`)
    binds.push(...config.visibilityFilter)
  }

  // 言語フィルタ（NULL は常に表示）
  if (config.languageFilter != null && config.languageFilter.length > 0) {
    const placeholders = config.languageFilter.map(() => '?').join(',')
    conditions.push(
      `(${prefix}language IN (${placeholders}) OR ${prefix}language IS NULL)`,
    )
    binds.push(...config.languageFilter)
  }

  // ブースト除外
  if (config.excludeReblogs) {
    conditions.push(`${prefix}is_reblog = 0`)
  }

  // リプライ除外
  if (config.excludeReplies) {
    conditions.push(`${prefix}in_reply_to_id IS NULL`)
  }

  // CW 付き除外
  if (config.excludeSpoiler) {
    conditions.push(`${prefix}has_spoiler = 0`)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    conditions.push(`${prefix}is_sensitive = 0`)
  }

  // アカウントフィルタ
  if (config.accountFilter != null && config.accountFilter.accts.length > 0) {
    const placeholders = config.accountFilter.accts.map(() => '?').join(',')
    if (config.accountFilter.mode === 'include') {
      conditions.push(`${prefix}account_acct IN (${placeholders})`)
    } else {
      conditions.push(`${prefix}account_acct NOT IN (${placeholders})`)
    }
    binds.push(...config.accountFilter.accts)
  }

  // ミュートアカウント除外
  // accountFilter が include モードの場合はミュートを適用しない
  // （明示的に指定ユーザーの投稿を見たい場合にミュートで消えるのは不適切）
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    const mute = buildMuteCondition(targetBackendUrls, tableAlias)
    conditions.push(mute.sql)
    binds.push(...mute.binds)
  }

  // インスタンスブロック除外
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    conditions.push(buildInstanceBlockCondition(tableAlias))
  }

  return { binds, conditions }
}
