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
// Visibility Filter Types
// ========================================

/**
 * Mastodon の公開範囲
 *
 * - public: 公開（連合TL・ローカルTLに表示）
 * - unlisted: 未収載（プロフィールには表示、TLには非表示）
 * - private: フォロワー限定
 * - direct: ダイレクトメッセージ
 */
export type VisibilityType = 'public' | 'unlisted' | 'private' | 'direct'

// ========================================
// Account Filter Types
// ========================================

/**
 * 特定アカウントの包含/除外フィルタ
 *
 * - include: 指定したアカウントの投稿のみ表示
 * - exclude: 指定したアカウントの投稿を除外
 */
export type AccountFilterMode = 'include' | 'exclude'

export type AccountFilter = {
  /** フィルタモード */
  mode: AccountFilterMode
  /** 対象アカウントの acct 配列 (例: ['user@mastodon.social', 'admin@example.com']) */
  accts: string[]
}

// ========================================
// Timeline V2 Types
// ========================================

export type TimelineType = 'home' | 'local' | 'public' | 'notification' | 'tag'

/**
 * 取得するタイムラインの種類（timelines + channel_kinds テーブルの値）
 *
 * TimelineType から 'notification' と 'tag' を除いたサブセット。
 * 通常UIでどのタイムラインを取得するか選択するために使用する。
 */
export type StatusTimelineType = 'home' | 'local' | 'public'

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

/**
 * 通知の種類
 *
 * Mastodon / Pleroma 互換の通知タイプ。
 */
export type NotificationType =
  | 'follow'
  | 'follow_request'
  | 'mention'
  | 'reblog'
  | 'favourite'
  | 'reaction'
  | 'poll_expired'
  | 'status'

export type TimelineConfigV2 = {
  /** Advanced Query モードが有効か（トグル状態の永続化） */
  advancedQuery?: boolean
  /** バックエンドフィルタ（未指定時は 'all' として扱う） */
  backendFilter?: BackendFilter
  /**
   * タブグループ名
   *
   * 同じ tabGroup を持つタイムラインは1つのカラムにまとめられ、
   * タブUIで切り替えて表示される。
   * 未設定の場合は従来どおり独立したカラムとして表示される。
   */
  tabGroup?: string
  /**
   * カスタム SQL WHERE 句（advanced option）
   *
   * posts (p), timeline_items/timelines/channel_kinds (ptt),
   * posts_belonging_tags (pbt), posts_mentions (pme),
   * posts_backends (pb), notifications (n) テーブルを参照可能。
   * LIMIT / OFFSET は自動設定されるため指定不要。
   *
   * posts 関連テーブル (p, ptt, pbt, pme, pb) と notifications テーブル (n) を
   * OR 条件で結合する混合クエリにも対応。例:
   * `ptt.timelineType = 'home' OR n.notification_type IN ('favourite','reblog')`
   */
  customQuery?: string
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

  // ========================================
  // 新規プロパティ（v2 スキーマ対応フィルタ）
  // ========================================

  /**
   * 表示する公開範囲のフィルタ
   *
   * 未指定時はすべての公開範囲を表示する。
   * 配列で指定した公開範囲の投稿のみを表示する。
   *
   * @example ['public', 'unlisted'] // 公開 + 未収載のみ表示
   */
  visibilityFilter?: VisibilityType[]

  /**
   * 表示する言語のフィルタ
   *
   * 未指定時はすべての言語を表示する。
   * 配列で指定した言語コードの投稿のみを表示する。
   * 言語が未設定 (null) の投稿は常に表示する（除外しない）。
   *
   * @example ['ja', 'en'] // 日本語 + 英語のみ表示
   */
  languageFilter?: string[]

  /**
   * ブースト投稿を除外するか
   *
   * true にすると、他ユーザーの投稿をブースト（リツイート）した投稿を非表示にする。
   * オリジナル投稿のみを表示したい場合に使用する。
   *
   * @default false
   */
  excludeReblogs?: boolean

  /**
   * リプライを除外するか
   *
   * true にすると、他の投稿への返信を非表示にする。
   * トップレベルの投稿のみを表示したい場合に使用する。
   *
   * @default false
   */
  excludeReplies?: boolean

  /**
   * CW（Content Warning）付き投稿を除外するか
   *
   * true にすると、spoiler_text が設定された投稿を非表示にする。
   *
   * @default false
   */
  excludeSpoiler?: boolean

  /**
   * センシティブ投稿を除外するか
   *
   * true にすると、sensitive フラグが設定された投稿を非表示にする。
   *
   * @default false
   */
  excludeSensitive?: boolean

  /**
   * ミュートしたアカウントの投稿を除外するか
   *
   * true にすると、muted_accounts テーブルに登録されたアカウントの投稿を非表示にする。
   * デフォルトは true（ミュートを適用）。
   * カスタムクエリモードでは無視される。
   *
   * @default true
   */
  applyMuteFilter?: boolean

  /**
   * ブロックしたインスタンスからの投稿を除外するか
   *
   * true にすると、blocked_instances テーブルに登録されたインスタンスの投稿を非表示にする。
   * デフォルトは true（ブロックを適用）。
   * カスタムクエリモードでは無視される。
   *
   * @default true
   */
  applyInstanceBlock?: boolean

  /**
   * メディア添付の最小枚数
   *
   * 未指定時は枚数による制限なし。
   * onlyMedia と併用する場合、minMediaCount が優先される。
   *
   * @example 2 // メディアが2枚以上ある投稿のみ表示
   */
  minMediaCount?: number

  /**
   * 特定アカウントの包含/除外フィルタ
   *
   * - include モード: 指定アカウントの投稿のみ表示
   * - exclude モード: 指定アカウントの投稿を除外
   *
   * 未指定時はアカウントフィルタなし。
   * applyMuteFilter とは独立して動作する。
   *
   * @example { mode: 'include', accts: ['user@mastodon.social'] }
   * @example { mode: 'exclude', accts: ['spam@example.com'] }
   */
  accountFilter?: AccountFilter

  /**
   * 通知タイプのフィルタ
   *
   * 未指定時は通知を取得しない（デフォルトオフ）。
   * 配列で指定した通知タイプのみを表示する。
   *
   * @example ['follow', 'favourite', 'reblog'] // フォロー・お気に入り・ブーストのみ
   */
  notificationFilter?: NotificationType[]

  /**
   * 取得するタイムラインの種類
   *
   * 通常UIから複数のタイムライン種類を選択できるようにする。
   * 未指定時は config.type に基づいてデフォルトを決定する。
   *
   * @example ['home', 'local'] // ホームとローカルの投稿を表示
   */
  timelineTypes?: StatusTimelineType[]

  /**
   * フォロー中のアカウントの投稿のみ表示するか
   *
   * true にすると、follows テーブルに登録されたアカウントの投稿のみを表示する。
   * バックエンドURLに紐づくローカルアカウントのフォロー情報を使用する。
   *
   * @default false
   */
  followsOnly?: boolean
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
