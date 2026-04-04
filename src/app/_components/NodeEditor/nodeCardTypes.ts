import type { ResolvedAccount } from 'util/accountResolver'
import type { FilterNode } from 'util/db/query-ir/nodes'

export type NodeCardProps = {
  /** 登録済みアカウント一覧 (BackendFilter 用) */
  accounts?: ReadonlyMap<string, ResolvedAccount>
  node: FilterNode
  onRemove: () => void
  onUpdate: (updated: FilterNode) => void
}

export type NodeMeta = {
  color: string
  icon: React.ReactNode
  label: string
}
