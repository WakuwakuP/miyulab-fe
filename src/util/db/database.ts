import Dexie, { type Table } from 'dexie'
import type { Entity } from 'megalodon'

// データベースバージョン
const DB_VERSION = 1

// タイムラインの種類
// ※ 'notification' は notifications テーブルで管理するため含めない
export type TimelineType = 'home' | 'local' | 'public' | 'tag'

/**
 * IndexedDB用Status型
 * Entity.Statusを拡張し、インデックス用フィールドを追加
 */
export interface StoredStatus extends Entity.Status {
  /** 複合キー: `${backendUrl}:${id}` */
  compositeKey: string
  /** バックエンドURL */
  backendUrl: string
  /** 所属するタイムラインの種類（複数可） */
  timelineTypes: TimelineType[]
  /** タグタイムライン用のハッシュタグ（複数可） */
  belongingTags: string[]
  /** 投稿日時のUnixTimeミリ秒（ソート・インデックス用） */
  created_at_ms: number
  /** 保存日時（TTL管理用） */
  storedAt: number
}

/**
 * IndexedDB用Notification型
 */
export interface StoredNotification extends Entity.Notification {
  /** 複合キー: `${backendUrl}:${id}` */
  compositeKey: string
  /** バックエンドURL */
  backendUrl: string
  /** 通知日時のUnixTimeミリ秒（ソート・インデックス用） */
  created_at_ms: number
  /** 保存日時 */
  storedAt: number
}

/**
 * Dexieデータベース定義
 */
export class MiyulabDatabase extends Dexie {
  statuses!: Table<StoredStatus>
  notifications!: Table<StoredNotification>

  constructor() {
    super('miyulab-fe')

    this.version(DB_VERSION).stores({
      notifications:
        'compositeKey, backendUrl, [backendUrl+created_at_ms], storedAt',
      // インデックス定義
      // compositeKey: プライマリキー
      // backendUrl: バックエンド別フィルタ用
      // *timelineTypes: タイムライン種類別フィルタ用（マルチエントリインデックス）
      // *belongingTags: タグ別フィルタ用（マルチエントリインデックス）
      // [backendUrl+created_at_ms]: 複合インデックス（バックエンド別ソート最適化、数値型で安全なソート）
      // storedAt: TTL管理用
      statuses:
        'compositeKey, backendUrl, *timelineTypes, *belongingTags, [backendUrl+created_at_ms], storedAt',
    })
  }
}

// シングルトンインスタンス
export const db = new MiyulabDatabase()
