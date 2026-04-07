import type { NotificationAddAppIndex, StatusAddAppIndex } from 'types/types'

export type TimelineItem = NotificationAddAppIndex | StatusAddAppIndex

/**
 * タイムライン描画層が受け取る ViewModel。
 *
 * Container（データ取得側）が組み立て、Presenter（描画側）が消費する。
 * 描画コンポーネントは原則この型のみを props として受け取る。
 */
export type TimelineViewModel = {
  /** タイムライン設定の一意識別子（スクロール位置リセット等に使用） */
  configId: string
  /** ソート済みタイムラインアイテム */
  data: TimelineItem[]
  /** 末尾にまだ古いページが存在するか */
  hasMoreOlder: boolean
  /** 古いページを読み込み中か */
  isLoadingOlder: boolean
  /** 古いページを取得する関数 */
  loadOlder: () => Promise<void>
  /** 直近のクエリ実行時間 (ms) */
  queryDuration: number | null
  /** 初期データロード中か（Other キュー処理中） */
  initializing: boolean
  /** パネルに表示する名前 */
  displayName: string
}
