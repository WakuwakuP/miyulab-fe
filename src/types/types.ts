import type { Entity, OAuth } from 'megalodon'

export type App = {
  backend: Backend
  backendUrl: string
  appData: OAuth.AppData
  tokenData: OAuth.TokenData | null
}

export const backendList = [
  'mastodon',
  'pleroma',
  'friendica',
  'firefish',
  'gotosocial',
  'pixelfed',
] as const

export type Backend = (typeof backendList)[number]

export type StatusAddAppIndex = Entity.Status & {
  appIndex: number
}

export type NotificationAddAppIndex = Entity.Notification & {
  appIndex: number
}

export type AccountAddAppIndex = Entity.Account & {
  appIndex: number
}

export type PollAddAppIndex = Entity.Poll & {
  appIndex: number
}

// ========================================
// Timeline V2 Types
// ========================================

export type TimelineType = 'home' | 'local' | 'public' | 'notification' | 'tag'

/**
 * 全アカウントの投稿を統合表示
 */
export type BackendFilterAll = {
  mode: 'all'
}

/**
 * 単一アカウントの投稿のみ表示
 */
export type BackendFilterSingle = {
  backendUrl: string
  mode: 'single'
}

/**
 * 任意の複数アカウントの投稿を統合表示
 * backendUrls は2つ以上を想定（1つなら single を使う）
 */
export type BackendFilterComposite = {
  backendUrls: string[]
  mode: 'composite'
}

export type BackendFilter =
  | BackendFilterAll
  | BackendFilterComposite
  | BackendFilterSingle

/**
 * タグタイムラインのフィルタ条件
 *
 * - or: いずれかのタグを含む投稿を表示（和集合）
 * - and: すべてのタグを含む投稿のみ表示（積集合）
 */
export type TagMode = 'and' | 'or'

export type TagConfig = {
  /** タグの結合条件（デフォルト: 'or'） */
  mode: TagMode
  /** 対象タグ名の配列（1つ以上） */
  tags: string[]
}

export type TimelineConfigV2 = {
  /** バックエンドフィルタ（未指定時は 'all' として扱う） */
  backendFilter?: BackendFilter
  /** 一意識別子 */
  id: string
  /** 表示名（ユーザーがカスタマイズ可能、未設定時はデフォルト名を使用） */
  label?: string
  /** メディア付き投稿のみ表示するか（デフォルト: false） */
  onlyMedia?: boolean
  /** 表示順序（0始まり、昇順） */
  order: number
  /** タグ設定（type === 'tag' の場合のみ有効） */
  tagConfig?: TagConfig
  /** タイムラインの種類 */
  type: TimelineType
  /** 表示 / 非表示 */
  visible: boolean
}

export type TimelineSettingsV2 = {
  /** タイムライン設定の配列 */
  timelines: TimelineConfigV2[]
  /** 設定バージョン（マイグレーション判定用） */
  version: 2
}

// ========================================
// Backward-compatible aliases
// ========================================

/** @deprecated TimelineConfigV2 を使用してください */
export type TimelineConfig = TimelineConfigV2

/** @deprecated TimelineSettingsV2 を使用してください */
export type TimelineSettings = TimelineSettingsV2
