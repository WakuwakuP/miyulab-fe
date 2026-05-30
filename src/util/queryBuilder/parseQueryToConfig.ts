import type { StatusTimelineType, TimelineConfigV2 } from 'types/types'
import { sortBackendUrls } from 'util/timelineConfigValidator'
import {
  ALL_NOTIFICATION_TYPES,
  buildQueryFromConfig,
} from './buildQueryFromConfig'

// ================================================================
// クエリ逆算（パーサー）
// ================================================================

function parseQuotedList(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
}

function matchFirst(
  query: string,
  patterns: RegExp[],
): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (match) return match
  }
  return null
}

function applyTimelineTypes(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const timelineTypeInMatch =
    /ptt\.timelineType\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i.exec(
      query,
    )
  const timelineTypeSingleMatch = /ptt\.timelineType\s*=\s*'([^']+)'/i.exec(
    query,
  )

  if (timelineTypeInMatch) {
    const types = parseQuotedList(
      timelineTypeInMatch[1],
    ) as StatusTimelineType[]
    if (types.length > 0) {
      result.timelineTypes = types
    }
    return
  }

  if (timelineTypeSingleMatch) {
    result.timelineTypes = [timelineTypeSingleMatch[1] as StatusTimelineType]
  }
}

function applyMediaFilters(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  if (
    query.includes("json_extract(p.json, '$.media_attachments') != '[]'") ||
    query.includes('p.has_media = 1') ||
    /EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+post_media\b/i.test(query)
  ) {
    result.onlyMedia = true
  }

  const mediaCountMatchV2 = query.match(
    /\(\s*SELECT\s+COUNT\s*\(\s*\*\s*\)\s+FROM\s+post_media\b[^)]*\)\s*>=\s*(\d+)/i,
  )
  const mediaCountMatch = query.match(/p\.media_count\s*>=\s*(\d+)/i)
  const mediaCountResult = mediaCountMatchV2 ?? mediaCountMatch
  if (!mediaCountResult) return

  const count = Number.parseInt(mediaCountResult[1], 10)
  if (count > 1) {
    result.minMediaCount = count
    delete result.onlyMedia
  } else if (count === 1) {
    result.onlyMedia = true
  }
}

function applyVisibilityFilter(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const visibilityResult =
    query.match(
      /vt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    ) ??
    query.match(
      /p\.visibility\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    )
  if (!visibilityResult) return

  const visibilities = parseQuotedList(visibilityResult[1])
  if (visibilities.length > 0) {
    result.visibilityFilter =
      visibilities as TimelineConfigV2['visibilityFilter']
  }
}

function applyLanguageFilter(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const languageMatch = query.match(
    /p\.language\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  )
  if (!languageMatch) return

  const languages = parseQuotedList(languageMatch[1])
  if (languages.length > 0) {
    result.languageFilter = languages
  }
}

function applyExcludeFlags(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  if (
    query.includes('p.is_reblog = 0') ||
    query.includes("json_extract(p.json, '$.reblog') IS NULL")
  ) {
    result.excludeReblogs = true
  }

  if (
    query.includes('p.in_reply_to_uri IS NULL') ||
    query.includes('p.in_reply_to_id IS NULL')
  ) {
    result.excludeReplies = true
  }

  if (
    query.includes('p.has_spoiler = 0') ||
    query.includes("p.spoiler_text = ''") ||
    query.includes("json_extract(p.json, '$.spoiler_text') = ''")
  ) {
    result.excludeSpoiler = true
  }

  if (query.includes('p.is_sensitive = 0')) {
    result.excludeSensitive = true
  }
}

function applyAccountFilter(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const accountExcludeMatch = matchFirst(query, [
    /pr\.acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /p\.account_acct\s+NOT\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  ])
  const accountIncludeMatch = matchFirst(query, [
    /pr\.acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /p\.account_acct\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  ])

  if (accountExcludeMatch) {
    const accts = parseQuotedList(accountExcludeMatch[1])
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'exclude' }
    }
    return
  }

  if (accountIncludeMatch) {
    const accts = parseQuotedList(accountIncludeMatch[1])
    if (accts.length > 0) {
      result.accountFilter = { accts, mode: 'include' }
    }
  }
}

function applyBackendFilter(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const backendSingleMatch = matchFirst(query, [
    /la\.backend_url\s*=\s*'([^']+)'/i,
    /pb\.(?:backend_url|backendUrl)\s*=\s*'([^']+)'/i,
    /p\.origin_backend_url\s*=\s*'([^']+)'/i,
    /n\.backend_url\s*=\s*'([^']+)'/i,
  ])
  const backendInMatch = matchFirst(query, [
    /la\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /pb\.(?:backend_url|backendUrl)\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /p\.origin_backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /n\.backend_url\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  ])

  if (backendSingleMatch) {
    result.backendFilter = {
      backendUrl: backendSingleMatch[1].replaceAll("''", "'"),
      mode: 'single',
    }
    return
  }

  if (!backendInMatch) return

  const urls = backendInMatch[1]
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'"))
    .filter(Boolean)

  if (urls.length === 1) {
    result.backendFilter = { backendUrl: urls[0], mode: 'single' }
  } else if (urls.length > 1) {
    result.backendFilter = {
      backendUrls: sortBackendUrls(urls),
      mode: 'composite',
    }
  }
}

function applyNotificationFilter(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  if (
    /nt\.name\s+IS\s+NOT\s+NULL/i.test(query) ||
    /n\.notification_type\s+IS\s+NOT\s+NULL/i.test(query)
  ) {
    result.notificationFilter = [...ALL_NOTIFICATION_TYPES]
    return
  }

  const notifTypeInMatch = matchFirst(query, [
    /nt\.name\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
    /n\.notification_type\s+IN\s*\(\s*('(?:[^']|'')+'\s*(?:,\s*'(?:[^']|'')+'\s*)*)\)/i,
  ])
  const notifTypeSingleMatch = matchFirst(query, [
    /nt\.name\s*=\s*'([^']+)'/i,
    /n\.notification_type\s*=\s*'([^']+)'/i,
  ])

  if (notifTypeInMatch) {
    const types = parseQuotedList(notifTypeInMatch[1])
    if (types.length > 0) {
      result.notificationFilter =
        types as TimelineConfigV2['notificationFilter']
    }
    return
  }

  if (notifTypeSingleMatch) {
    result.notificationFilter = [
      notifTypeSingleMatch[1],
    ] as TimelineConfigV2['notificationFilter']
  }
}

function applyTagConfig(
  query: string,
  result: Partial<TimelineConfigV2>,
): void {
  const singleTagMatch =
    /(?:pbt\.tag|ht\.name|ht\.normalized_name)\s*=\s*'([^']+)'/i.exec(query)
  const multiTagMatch =
    /(?:pbt\.tag|ht\.name|ht\.normalized_name)\s+IN\s*\(([^)]+)\)/i.exec(query)
  const andTagMatch =
    /HAVING\s+COUNT\s*\(\s*DISTINCT\s+[a-z_]\w*\.(?:tag|normalized_name|name)\s*\)\s*=\s*(\d+)/i.exec(
      query,
    )

  if (singleTagMatch) {
    result.tagConfig = {
      mode: 'or',
      tags: [singleTagMatch[1].replaceAll("''", "'")],
    }
    return
  }

  if (!multiTagMatch) return

  const tags = multiTagMatch[1]
    .split(',')
    .map((t) => t.trim().replaceAll(/^'|'$/g, '').replaceAll("''", "'"))
    .filter(Boolean)
  const mode = andTagMatch ? 'and' : 'or'
  result.tagConfig = { mode, tags }
}

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

  applyTimelineTypes(query, result)
  applyMediaFilters(query, result)
  applyVisibilityFilter(query, result)
  applyLanguageFilter(query, result)
  applyExcludeFlags(query, result)
  applyAccountFilter(query, result)
  applyBackendFilter(query, result)
  applyNotificationFilter(query, result)
  applyTagConfig(query, result)

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
  const normalize = (q: string) =>
    q.replaceAll(/\s+/g, ' ').trim().toLowerCase()

  return normalize(rebuiltQuery) === normalize(query)
}
