import {
  BarChart3,
  Code,
  Eye,
  Filter,
  Globe,
  Hash,
  MessageSquare,
  Shield,
  User,
  Zap,
} from 'lucide-react'
import type {
  ExistsFilter,
  FilterNode,
  TableFilter,
} from 'util/db/query-ir/nodes'
import type { NodeMeta } from './nodeCardTypes'

export function getNodeMeta(node: FilterNode): NodeMeta {
  switch (node.kind) {
    case 'timeline-scope':
      return {
        color: 'border-blue-500/50 bg-blue-950/30',
        icon: <Globe className="h-3.5 w-3.5 text-blue-400" />,
        label: 'タイムライン',
      }
    case 'table-filter':
      return getTableFilterMeta(node)
    case 'exists-filter':
      return getExistsFilterMeta(node)
    case 'raw-sql-filter':
      return {
        color: 'border-orange-500/50 bg-orange-950/30',
        icon: <Code className="h-3.5 w-3.5 text-orange-400" />,
        label: 'カスタム SQL',
      }
    case 'backend-filter':
      return {
        color: 'border-gray-500/50 bg-gray-950/30',
        icon: <Shield className="h-3.5 w-3.5 text-gray-400" />,
        label: 'バックエンド',
      }
    case 'moderation-filter':
      return {
        color: 'border-red-500/50 bg-red-950/30',
        icon: <Shield className="h-3.5 w-3.5 text-red-400" />,
        label: 'モデレーション',
      }
    case 'aerial-reply-filter':
      return {
        color: 'border-yellow-500/50 bg-yellow-950/30',
        icon: <Zap className="h-3.5 w-3.5 text-yellow-400" />,
        label: '空中リプ',
      }
    case 'or-group':
      return {
        color: 'border-indigo-500/50 bg-indigo-950/30',
        icon: <Filter className="h-3.5 w-3.5 text-indigo-400" />,
        label: 'OR グループ',
      }
  }
}

function getTableFilterMeta(node: TableFilter): NodeMeta {
  switch (node.table) {
    case 'posts':
      if (node.column === 'language')
        return {
          color: 'border-cyan-500/50 bg-cyan-950/30',
          icon: <Globe className="h-3.5 w-3.5 text-cyan-400" />,
          label: '言語',
        }
      return {
        color: 'border-green-500/50 bg-green-950/30',
        icon: <Filter className="h-3.5 w-3.5 text-green-400" />,
        label: '投稿プロパティ',
      }
    case 'visibility_types':
      return {
        color: 'border-yellow-500/50 bg-yellow-950/30',
        icon: <Eye className="h-3.5 w-3.5 text-yellow-400" />,
        label: '可視性',
      }
    case 'notification_types':
      return {
        color: 'border-pink-500/50 bg-pink-950/30',
        icon: <MessageSquare className="h-3.5 w-3.5 text-pink-400" />,
        label: '通知タイプ',
      }
    case 'profiles':
      return {
        color: 'border-purple-500/50 bg-purple-950/30',
        icon: <User className="h-3.5 w-3.5 text-purple-400" />,
        label: 'アカウント',
      }
    case 'post_stats':
      return {
        color: 'border-amber-500/50 bg-amber-950/30',
        icon: <BarChart3 className="h-3.5 w-3.5 text-amber-400" />,
        label: '統計',
      }
    case 'hashtags':
      return {
        color: 'border-teal-500/50 bg-teal-950/30',
        icon: <Hash className="h-3.5 w-3.5 text-teal-400" />,
        label: 'ハッシュタグ',
      }
    default:
      return {
        color: 'border-gray-500/50 bg-gray-950/30',
        icon: <Filter className="h-3.5 w-3.5 text-gray-400" />,
        label: node.table,
      }
  }
}

function getExistsFilterMeta(node: ExistsFilter): NodeMeta {
  switch (node.table) {
    case 'post_media':
      return {
        color: 'border-indigo-500/50 bg-indigo-950/30',
        icon: <Eye className="h-3.5 w-3.5 text-indigo-400" />,
        label: 'メディア',
      }
    case 'post_mentions':
      return {
        color: 'border-purple-500/50 bg-purple-950/30',
        icon: <User className="h-3.5 w-3.5 text-purple-400" />,
        label: 'メンション',
      }
    default:
      return {
        color: 'border-gray-500/50 bg-gray-950/30',
        icon: <Filter className="h-3.5 w-3.5 text-gray-400" />,
        label: node.table,
      }
  }
}
