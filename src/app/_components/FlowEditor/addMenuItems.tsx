import { ArrowDownToLine, BarChart3, GitMerge, Link2 } from 'lucide-react'
import type { FlowNode } from './types'

// --------------- Add-node menu (V2) ---------------

export type AddMenuItem = {
  icon: React.ReactNode
  label: string
  description: string
  createNode: (id: string, viewport: { x: number; y: number }) => FlowNode
}

export const ADD_MENU_ITEMS: AddMenuItem[] = [
  {
    createNode: (id, vp) => ({
      data: {
        config: { filters: [], kind: 'get-ids', table: 'posts' },
        nodeType: 'get-ids',
      },
      id,
      position: vp,
      type: 'get-ids',
    }),
    description: 'テーブルから ID を取得',
    icon: <BarChart3 className="h-3.5 w-3.5 text-sky-400" />,
    label: 'getIds',
  },
  {
    createNode: (id, vp) => ({
      data: {
        config: {
          joinConditions: [
            {
              inputColumn: 'actor_profile_id',
              lookupColumn: 'author_profile_id',
            },
          ],
          kind: 'lookup-related',
          lookupTable: 'posts',
        },
        nodeType: 'lookup-related',
      },
      id,
      position: vp,
      type: 'lookup-related',
    }),
    description: '関連テーブルへ相関検索',
    icon: <Link2 className="h-3.5 w-3.5 text-violet-400" />,
    label: 'lookupRelated',
  },
  {
    createNode: (id, vp) => ({
      data: {
        config: {
          kind: 'merge-v2',
          limit: 50,
          strategy: 'interleave-by-time',
        },
        nodeType: 'merge-v2',
      },
      id,
      position: vp,
      type: 'merge-v2',
    }),
    description: '複数ソースを結合',
    icon: <GitMerge className="h-3.5 w-3.5 text-cyan-400" />,
    label: 'merge',
  },
  {
    createNode: (id, vp) => ({
      data: {
        config: {
          displayMode: 'auto',
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
        nodeType: 'output-v2',
      },
      id,
      position: vp,
      type: 'output-v2',
    }),
    description: 'ソート & ページネーション',
    icon: <ArrowDownToLine className="h-3.5 w-3.5 text-green-400" />,
    label: 'output',
  },
]
