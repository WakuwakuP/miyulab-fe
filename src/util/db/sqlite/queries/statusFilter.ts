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
 * - in_reply_to_uri（リプライ除外）
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
 * @param config — v2 フィルタ（メディア・公開範囲・ミュート等）の設定
 * @param targetBackendUrls — バインド用に参照する対象インスタンス URL 一覧（ミュート / インスタンスブロック条件で使用）
 * @param tableAlias — カラム参照のプレフィックス。省略時は `'p'`（posts）
 * @param options — `profileJoined: true` のとき `pr` JOIN 前提の account 条件を生成
 * @returns
 * - `conditions`: `WHERE` に `AND` 連結する SQL 断片
 * - `binds`: 上記 `?` に対応するバインド値（`conditions` と同じ順序）
 * @see {@link useFilteredTimeline}
 * @see {@link useFilteredTagTimeline}
 */
export function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias = 'p',
  options?: {
    /** profiles テーブルが pr として JOIN されている場合 true */
    profileJoined?: boolean
  },
): { conditions: string[]; binds: (string | number)[] } {
  const conditions: string[] = []
  const binds: (string | number)[] = []
  const prefix = tableAlias ? `${tableAlias}.` : ''

  // メディアフィルタ（新スキーマ: post_media サブクエリ）
  if (config.minMediaCount != null && config.minMediaCount > 0) {
    conditions.push(
      `(SELECT COUNT(*) FROM post_media WHERE post_id = ${prefix}id) >= ?`,
    )
    binds.push(config.minMediaCount)
  } else if (config.onlyMedia) {
    conditions.push(
      `EXISTS(SELECT 1 FROM post_media WHERE post_id = ${prefix}id)`,
    )
  }

  // 公開範囲フィルタ（v13: visibility → visibility_id + visibility_types）
  if (
    config.visibilityFilter != null &&
    config.visibilityFilter.length > 0 &&
    config.visibilityFilter.length < 4
  ) {
    const placeholders = config.visibilityFilter.map(() => '?').join(',')
    conditions.push(
      `(SELECT name FROM visibility_types WHERE id = ${prefix}visibility_id) IN (${placeholders})`,
    )
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
    conditions.push(`${prefix}in_reply_to_uri IS NULL`)
  }

  // CW 付き除外（新スキーマ: spoiler_text が空文字 = CW なし）
  if (config.excludeSpoiler) {
    conditions.push(`${prefix}spoiler_text = ''`)
  }

  // センシティブ除外
  if (config.excludeSensitive) {
    conditions.push(`${prefix}is_sensitive = 0`)
  }

  // アカウントフィルタ（v13: account_acct → author_profile_id + profiles）
  if (config.accountFilter != null && config.accountFilter.accts.length > 0) {
    const placeholders = config.accountFilter.accts.map(() => '?').join(',')
    if (config.accountFilter.mode === 'include') {
      conditions.push(
        `(SELECT acct FROM profiles WHERE id = ${prefix}author_profile_id) IN (${placeholders})`,
      )
    } else {
      conditions.push(
        `(SELECT acct FROM profiles WHERE id = ${prefix}author_profile_id) NOT IN (${placeholders})`,
      )
    }
    binds.push(...config.accountFilter.accts)
  }

  // ミュートアカウント除外
  // accountFilter が include モードの場合はミュートを適用しない
  // （明示的に指定ユーザーの投稿を見たい場合にミュートで消えるのは不適切）
  const applyMute = config.applyMuteFilter ?? true
  if (applyMute && config.accountFilter?.mode !== 'include') {
    const mute = buildMuteCondition(targetBackendUrls, tableAlias, {
      profileJoined: options?.profileJoined,
    })
    conditions.push(mute.sql)
    binds.push(...mute.binds)
  }

  // インスタンスブロック除外
  const applyBlock = config.applyInstanceBlock ?? true
  if (applyBlock) {
    conditions.push(
      buildInstanceBlockCondition(tableAlias, {
        profileJoined: options?.profileJoined,
      }),
    )
  }

  // フォロー中のアカウントのみ表示
  if (config.followsOnly) {
    const placeholders = targetBackendUrls.map(() => '?').join(',')
    conditions.push(
      `${prefix}author_profile_id IN (SELECT f.target_profile_id FROM follows f INNER JOIN local_accounts la ON f.local_account_id = la.id WHERE la.backend_url IN (${placeholders}))`,
    )
    binds.push(...targetBackendUrls)
  }

  return { binds, conditions }
}
