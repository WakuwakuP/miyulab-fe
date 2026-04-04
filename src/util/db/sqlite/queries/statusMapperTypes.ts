import type { Entity } from 'megalodon'

/** タイムラインの種類（DB層用。notification は notifications テーブルで管理するため含めない） */
export type TimelineType = 'home' | 'local' | 'public' | 'tag'

export interface SqliteStoredStatus extends Entity.Status {
  post_id: number
  backendUrl: string
  timelineTypes: TimelineType[]
  belongingTags: string[]
  created_at_ms: number
  edited_at_ms: number | null
}

/** post_interactions の JSON オブジェクト型 */
export interface InteractionsJson {
  is_favourited: number
  is_reblogged: number
  is_bookmarked: number
  is_muted: number
  is_pinned: number
  my_reaction_name: string | null
  my_reaction_url: string | null
}
