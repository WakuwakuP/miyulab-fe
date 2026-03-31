'use client'

// ============================================================
// NodeCard — フィルタノードの種別に応じたカードコンポーネント
// ============================================================

import { Badge } from 'components/ui/badge'
import { Checkbox } from 'components/ui/checkbox'
import { Input } from 'components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
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
  X,
  Zap,
} from 'lucide-react'
import { useCallback } from 'react'
import type { ResolvedAccount } from 'util/accountResolver'
import type {
  AerialReplyFilter,
  ExistsFilter,
  FilterNode,
  FilterOp,
  BackendFilter as IRBackendFilter,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from 'util/db/query-ir/nodes'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeCardProps = {
  /** 登録済みアカウント一覧 (BackendFilter 用) */
  accounts?: ReadonlyMap<string, ResolvedAccount>
  node: FilterNode
  onRemove: () => void
  onUpdate: (updated: FilterNode) => void
}

// ---------------------------------------------------------------------------
// Node metadata for display
// ---------------------------------------------------------------------------

type NodeMeta = {
  color: string
  icon: React.ReactNode
  label: string
}

function getNodeMeta(node: FilterNode): NodeMeta {
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

// ---------------------------------------------------------------------------
// Timeline Scope card body
// ---------------------------------------------------------------------------

const TIMELINE_KEYS = [
  { key: 'home', label: 'ホーム' },
  { key: 'local', label: 'ローカル' },
  { key: 'public', label: '連合' },
  { key: 'bubble', label: 'バブル' },
]

function TimelineScopeBody({
  node,
  onUpdate,
}: {
  node: TimelineScope
  onUpdate: (n: TimelineScope) => void
}) {
  const toggle = useCallback(
    (key: string) => {
      const keys = new Set(node.timelineKeys)
      if (keys.has(key)) {
        keys.delete(key)
      } else {
        keys.add(key)
      }
      if (keys.size > 0) {
        onUpdate({ ...node, timelineKeys: [...keys] })
      }
    },
    [node, onUpdate],
  )

  return (
    <div className="flex flex-wrap gap-2">
      {TIMELINE_KEYS.map(({ key, label }) => (
        <span
          className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
          key={key}
          onClick={() => toggle(key)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggle(key)
          }}
        >
          <Checkbox
            checked={node.timelineKeys.includes(key)}
            onCheckedChange={() => toggle(key)}
          />
          {label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Table filter card body
// ---------------------------------------------------------------------------

const FILTER_OPS: { label: string; value: FilterOp }[] = [
  { label: '=', value: '=' },
  { label: '≠', value: '!=' },
  { label: '>', value: '>' },
  { label: '≥', value: '>=' },
  { label: '<', value: '<' },
  { label: '≤', value: '<=' },
  { label: 'IN', value: 'IN' },
  { label: 'NOT IN', value: 'NOT IN' },
  { label: 'IS NULL', value: 'IS NULL' },
  { label: 'IS NOT NULL', value: 'IS NOT NULL' },
  { label: 'LIKE', value: 'LIKE' },
  { label: 'GLOB', value: 'GLOB' },
]

function TableFilterBody({
  node,
  onUpdate,
}: {
  node: TableFilter
  onUpdate: (n: TableFilter) => void
}) {
  const isNullOp = node.op === 'IS NULL' || node.op === 'IS NOT NULL'
  const displayValue = Array.isArray(node.value)
    ? node.value.join(', ')
    : String(node.value ?? '')

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge className="text-xs shrink-0" variant="outline">
          {node.column}
        </Badge>
        <Select
          onValueChange={(v) => onUpdate({ ...node, op: v as FilterOp })}
          value={node.op}
        >
          <SelectTrigger className="h-7 w-24 text-xs bg-gray-800 border-gray-600">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_OPS.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isNullOp && (
          <Input
            className="h-7 text-xs bg-gray-800 border-gray-600 flex-1"
            onChange={(e) => {
              const raw = e.target.value
              if (node.op === 'IN' || node.op === 'NOT IN') {
                const values = raw
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                onUpdate({ ...node, value: values })
              } else {
                const num = Number(raw)
                onUpdate({
                  ...node,
                  value: raw !== '' && !Number.isNaN(num) ? num : raw,
                })
              }
            }}
            placeholder="値"
            value={displayValue}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exists filter card body
// ---------------------------------------------------------------------------

const EXISTS_MODES = [
  { label: '存在する', value: 'exists' },
  { label: '存在しない', value: 'not-exists' },
  { label: '件数 ≥', value: 'count-gte' },
  { label: '件数 ≤', value: 'count-lte' },
  { label: '件数 =', value: 'count-eq' },
] as const

function ExistsFilterBody({
  node,
  onUpdate,
}: {
  node: ExistsFilter
  onUpdate: (n: ExistsFilter) => void
}) {
  const isCountMode = node.mode.startsWith('count-')

  return (
    <div className="flex items-center gap-2">
      <Select
        onValueChange={(v) =>
          onUpdate({
            ...node,
            mode: v as ExistsFilter['mode'],
          })
        }
        value={node.mode}
      >
        <SelectTrigger className="h-7 w-32 text-xs bg-gray-800 border-gray-600">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EXISTS_MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCountMode && (
        <Input
          className="h-7 w-16 text-xs bg-gray-800 border-gray-600"
          min={0}
          onChange={(e) =>
            onUpdate({
              ...node,
              countValue: Number.parseInt(e.target.value, 10) || 0,
            })
          }
          type="number"
          value={node.countValue ?? 0}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Raw SQL card body
// ---------------------------------------------------------------------------

function RawSQLBody({
  node,
  onUpdate,
}: {
  node: RawSQLFilter
  onUpdate: (n: RawSQLFilter) => void
}) {
  return (
    <textarea
      className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-xs text-gray-200 font-mono resize-y min-h-[2.5rem]"
      onChange={(e) => onUpdate({ ...node, where: e.target.value })}
      placeholder="SQL 条件式"
      value={node.where}
    />
  )
}

// ---------------------------------------------------------------------------
// Aerial reply filter card body
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES_FOR_AERIAL = [
  { key: 'favourite', label: 'ふぁぼ' },
  { key: 'reaction', label: 'リアクション' },
  { key: 'reblog', label: 'ブースト' },
  { key: 'mention', label: 'メンション' },
]

const TIME_WINDOW_OPTIONS = [
  { label: '1分', value: 60000 },
  { label: '3分', value: 180000 },
  { label: '5分', value: 300000 },
  { label: '10分', value: 600000 },
]

function AerialReplyBody({
  node,
  onUpdate,
}: {
  node: AerialReplyFilter
  onUpdate: (n: AerialReplyFilter) => void
}) {
  const toggleType = useCallback(
    (key: string) => {
      const types = new Set(node.notificationTypes)
      if (types.has(key)) {
        types.delete(key)
      } else {
        types.add(key)
      }
      if (types.size > 0) {
        onUpdate({ ...node, notificationTypes: [...types] })
      }
    },
    [node, onUpdate],
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_TYPES_FOR_AERIAL.map(({ key, label }) => (
          <span
            className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
            key={key}
            onClick={() => toggleType(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') toggleType(key)
            }}
          >
            <Checkbox
              checked={node.notificationTypes.includes(key)}
              onCheckedChange={() => toggleType(key)}
            />
            {label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">時間窓:</span>
        <Select
          onValueChange={(v) => onUpdate({ ...node, timeWindowMs: Number(v) })}
          value={String(node.timeWindowMs)}
        >
          <SelectTrigger className="h-7 w-20 text-xs bg-gray-800 border-gray-600">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIME_WINDOW_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Backend filter card body (interactive multi-account)
// ---------------------------------------------------------------------------

function BackendFilterBody({
  accounts,
  node,
  onUpdate,
}: {
  accounts?: ReadonlyMap<string, ResolvedAccount>
  node: IRBackendFilter
  onUpdate: (n: IRBackendFilter) => void
}) {
  const accountEntries = accounts ? [...accounts.entries()] : []

  const toggleAccount = useCallback(
    (localAccountId: number) => {
      const ids = new Set(node.localAccountIds)
      if (ids.has(localAccountId)) {
        ids.delete(localAccountId)
      } else {
        ids.add(localAccountId)
      }
      onUpdate({ ...node, localAccountIds: [...ids] })
    },
    [node, onUpdate],
  )

  if (accountEntries.length === 0) {
    return (
      <div className="text-xs text-gray-400">
        アカウント ID: {node.localAccountIds.join(', ') || '(なし)'}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {accountEntries.map(([url, resolved]) => (
        <span
          className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
          key={url}
          onClick={() => toggleAccount(resolved.localAccountId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ')
              toggleAccount(resolved.localAccountId)
          }}
        >
          <Checkbox
            checked={node.localAccountIds.includes(resolved.localAccountId)}
            onCheckedChange={() => toggleAccount(resolved.localAccountId)}
          />
          <span className="truncate" title={url}>
            {new URL(url).hostname}
          </span>
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main NodeCard
// ---------------------------------------------------------------------------

export function NodeCard({
  accounts,
  node,
  onRemove,
  onUpdate,
}: NodeCardProps) {
  const meta = getNodeMeta(node)

  const handleUpdate = useCallback(
    (updated: FilterNode) => onUpdate(updated),
    [onUpdate],
  )

  return (
    <div className={`rounded-lg border p-3 ${meta.color} transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {meta.icon}
          <span className="text-xs font-semibold text-gray-200">
            {meta.label}
          </span>
        </div>
        <button
          className="p-0.5 rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200 transition-colors"
          onClick={onRemove}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body — kind-specific */}
      {node.kind === 'timeline-scope' && (
        <TimelineScopeBody
          node={node}
          onUpdate={handleUpdate as (n: TimelineScope) => void}
        />
      )}
      {node.kind === 'table-filter' && (
        <TableFilterBody
          node={node}
          onUpdate={handleUpdate as (n: TableFilter) => void}
        />
      )}
      {node.kind === 'exists-filter' && (
        <ExistsFilterBody
          node={node}
          onUpdate={handleUpdate as (n: ExistsFilter) => void}
        />
      )}
      {node.kind === 'raw-sql-filter' && (
        <RawSQLBody
          node={node}
          onUpdate={handleUpdate as (n: RawSQLFilter) => void}
        />
      )}
      {node.kind === 'backend-filter' && (
        <BackendFilterBody
          accounts={accounts}
          node={node}
          onUpdate={handleUpdate as (n: IRBackendFilter) => void}
        />
      )}
      {node.kind === 'moderation-filter' && (
        <div className="text-xs text-gray-400">
          適用: {node.apply.join(', ') || '(なし)'}
        </div>
      )}
      {node.kind === 'aerial-reply-filter' && (
        <AerialReplyBody
          node={node}
          onUpdate={handleUpdate as (n: AerialReplyFilter) => void}
        />
      )}
    </div>
  )
}
