import type { StatusTimelineType, TimelineConfigV2 } from 'types/types'
import { buildQueryFromConfig } from './buildQueryFromConfig'

// ================================================================
// クエリ逆算（パーサー）
// ================================================================

/**
 * クエリ文字列から TimelineConfigV2 の UI 設定を逆算する（ベストエフォート）
 *
 * Advanced Query → 通常 UI に切り替えた際に、
 * 手編集されたクエリから可能な範囲で UI 状態を復元する。
 * 完全なパースは不要 — 認識できない場合は null を返す。
 *
 * type は変更しない（タイムラインの種類は固定値のため）。
 *
 * ## v2 スキーマ対応
 *
 * v1 形式（json_extract ベース）と v2 形式（正規化カラムベース）の
 * 両方を認識する。
 */
export function parseQueryToConfig(
  query: string,
): Partial<TimelineConfigV2> | null {
  if (!query.trim()) return null

  const result: Partial<TimelineConfigV2> = {}

  // ========================================
  // timelineTypes の検出
  // ========================================
  const timelineTypeInMatch = query.match(
    /ptt\.timelineType\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const timelineTypeSingleMatch = query.match(
    /ptt\.timelineType\s*=\s*'([^']+)'/i,
  )

  if (timelineTypeInMatch) {
    const types = timelineTypeInMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean) as StatusTimelineType[]
    if (types.length > 0) {
      result.timelineTypes = types
    }
  } else if (timelineTypeSingleMatch) {
    result.timelineTypes = [timelineTypeSingleMatch[1] as StatusTimelineType]
  }

  // ========================================
  // onlyMedia の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes("json_extract(p.json, '$.media_attachments') != '[]'") ||
    query.includes('p.has_media = 1') ||
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+post_media\b/i.test(query)
  ) {
    result.onlyMedia = true
  }

  // ========================================
  // minMediaCount の検出（v2 + 旧形式）
  // ========================================
  const mediaCountMatchV2 = query.match(
    /\(\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+post_media\b[^)]*\)\s*>=\s*(\d+)/i,
  )
  const mediaCountMatch = query.match(/p\.media_count\s*>=\s*(\d+)/i)
  const mediaCountResult = mediaCountMatchV2 ?? mediaCountMatch
  if (mediaCountResult) {
    const count = parseInt(mediaCountResult[1], 10)
    if (count > 1) {
      result.minMediaCount = count
      // minMediaCount が設定されている場合は onlyMedia は不要
      delete result.onlyMedia
    } else if (count === 1) {
      result.onlyMedia = true
    }
  }

  // ========================================
  // visibilityFilter の検出（v2 + 旧形式）
  // ========================================
  const visibilityMatchV2 = query.match(
    /vt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const visibilityMatch = query.match(
    /p\.visibility\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const visibilityResult = visibilityMatchV2 ?? visibilityMatch
  if (visibilityResult) {
    const visibilities = visibilityResult[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (visibilities.length > 0) {
      result.visibilityFilter =
        visibilities as TimelineConfigV2['visibilityFilter']
    }
  }

  // ========================================
  // languageFilter の検出
  // ========================================
  const languageMatch = query.match(
    /p\.language\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  if (languageMatch) {
    const languages = languageMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (languages.length > 0) {
      result.languageFilter = languages
    }
  }

  // ========================================
  // excludeReblogs の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes('p.is_reblog = 0') ||
    query.includes("json_extract(p.json, '$.reblog') IS NULL")
  ) {
    result.excludeReblogs = true
  }

  // ========================================
  // excludeReplies の検出（v2 + 旧形式）
  // ========================================
  if (
    query.includes('p.in_reply_to_uri IS NULL') ||
    query.includes('p.in_reply_to_id IS NULL')
  ) {
    result.excludeReplies = true
  }

  // ========================================
  // excludeSpoiler の検出（v1 + v2 両対応）
  // ========================================
  if (
    query.includes('p.has_spoiler = 0') ||
    query.includes("p.spoiler_text = ''") ||
    query.includes("json_extract(p.json, '$.spoiler_text') = ''")
  ) {
    result.excludeSpoiler = true
  }

  // ========================================
  // excludeSensitive の検出
  // ========================================
  if (query.includes('p.is_sensitive = 0')) {
    result.excludeSensitive = true
  }

  // ========================================
  // accountFilter の検出（v2 + 旧形式）
  // ========================================
  const accountExcludeMatch =
    query.match(
      /pr\.acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.account_acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )
  const accountIncludeMatch =
    query.match(
      /pr\.acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.account_acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )

  if (accountExcludeMatch) {
    // NOT IN を先にチェック（IN のパターンにもマッチするため）
    const accts = accountExcludeMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'exclude' }
    }
  } else if (accountIncludeMatch) {
    const accts = accountIncludeMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'include' }
    }
  }

  // ========================================
  // backendFilter の検出
  // ========================================
  const backendSingleMatch =
    query.match(/la\.backend_url\s*=\s*'([^']+)'/i) ??
    query.match(/pb\.(?:backend_url|backendUrl)\s*=\s*'([^']+)'/i) ??
    query.match(/p\.origin_backend_url\s*=\s*'([^']+)'/i) ??
    query.match(/n\.backend_url\s*=\s*'([^']+)'/i)
  const backendInMatch =
    query.match(
      /la\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /pb\.(?:backend_url|backendUrl)\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.origin_backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /n\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )

  if (backendSingleMatch) {
    result.backendFilter = {
      backendUrl: backendSingleMatch[1].replace(/''/g, "'"),
      mode: 'single',
    }
  } else if (backendInMatch) {
    const urls = backendInMatch[1]
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
      .filter(Boolean)
    if (urls.length === 1) {
      result.backendFilter = { backendUrl: urls[0], mode: 'single' }
    } else if (urls.length > 1) {
      result.backendFilter = { backendUrls: urls.sort(), mode: 'composite' }
    }
  }

  // ========================================
  // notificationFilter の検出（v2 + 旧形式）
  // ========================================
  // IS NOT NULL = 全通知タイプ
  if (
    /nt\.name\s+IS\s+NOT\s+NULL/i.test(query) ||
    /n\.notification_type\s+IS\s+NOT\s+NULL/i.test(query)
  ) {
    result.notificationFilter = [
      'follow',
      'follow_request',
      'mention',
      'reblog',
      'favourite',
      'emoji_reaction',
      'poll_expired',
      'status',
    ]
  } else {
    const notifTypeInMatch =
      query.match(
        /nt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
      ) ??
      query.match(
        /n\.notification_type\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
      )
    const notifTypeSingleMatch =
      query.match(/nt\.name\s*=\s*'([^']+)'/i) ??
      query.match(/n\.notification_type\s*=\s*'([^']+)'/i)

    if (notifTypeInMatch) {
      const types = notifTypeInMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
      if (types.length > 0) {
        result.notificationFilter =
          types as TimelineConfigV2['notificationFilter']
      }
    } else if (notifTypeSingleMatch) {
      result.notificationFilter = [
        notifTypeSingleMatch[1],
      ] as TimelineConfigV2['notificationFilter']
    }
  }

  // ========================================
  // タグ条件の検出（既存ロジック、変更なし）
  // ========================================
  const singleTagMatch = query.match(
    /(?:pbt\.tag|ht\.(?:name|normalized_name))\s*=\s*'([^']+)'/i,
  )
  const multiTagMatch = query.match(
    /(?:pbt\.tag|ht\.(?:name|normalized_name))\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  const andTagMatch = query.match(
    /HAVING\s+COUNT\s*\(\s*DISTINCT\s+\w+\.(?:tag|normalized_name)\s*\)\s*=\s*(\d+)/i,
  )

  if (singleTagMatch) {
    result.tagConfig = {
      mode: 'or',
      tags: [singleTagMatch[1].replace(/''/g, "'")],
    }
  } else if (multiTagMatch) {
    const tags = multiTagMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
      .filter(Boolean)
    const mode = andTagMatch ? 'and' : 'or'
    result.tagConfig = { mode, tags }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * クエリ文字列を通常UIに復元可能かどうか判定する
 *
 * パースした結果から再構築したクエリが元のクエリと一致するかを検証する。
 * Advanced Query をオフにする際の警告表示に使用する。
 *
 * @returns true = 復元可能、false = 復元不可（手編集されたクエリ等）
 */
export function canParseQuery(
  query: string,
  config: TimelineConfigV2,
): boolean {
  if (!query.trim()) return true

  const parsed = parseQueryToConfig(query)
  if (!parsed) return false

  // パース結果 + 既存 config から再構築して比較
  const rebuiltQuery = buildQueryFromConfig({
    ...config,
    ...parsed,
  })

  // 正規化して比較（スペースを統一）
  const normalize = (q: string) => q.replace(/\s+/g, ' ').trim().toLowerCase()

  return normalize(rebuiltQuery) === normalize(query)
}
