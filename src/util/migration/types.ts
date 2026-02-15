/**
 * V1 の TimelineConfig 型
 * マイグレーション処理でのみ使用する。新規コードでは使用しない。
 */
export type V1TimelineConfig = {
  id: string
  order: number
  tag?: string
  type: 'home' | 'local' | 'notification' | 'public' | 'tag'
  visible: boolean
}

export type V1TimelineSettings = {
  // version フィールドなし
  timelines: V1TimelineConfig[]
}
