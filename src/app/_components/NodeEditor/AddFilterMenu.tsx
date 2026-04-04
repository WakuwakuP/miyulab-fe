'use client'

// ============================================================
// AddFilterMenu — カテゴリ別フィルタ追加メニュー
// ============================================================

import { Popover, PopoverContent, PopoverTrigger } from 'components/ui/popover'
import {
  BarChart3,
  Code,
  Eye,
  Globe,
  Hash,
  MessageSquare,
  Plus,
  Shield,
  User,
  Zap,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type {
  AerialReplyFilter,
  ExistsFilter,
  FilterNode,
  BackendFilter as IRBackendFilter,
  ModerationFilter,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from 'util/db/query-ir/nodes'

// ---------------------------------------------------------------------------
// Menu categories
// ---------------------------------------------------------------------------

type MenuItem = {
  description: string
  icon: React.ReactNode
  label: string
  node: () => FilterNode
}

type MenuCategory = {
  icon: React.ReactNode
  items: MenuItem[]
  label: string
}

const MENU_CATEGORIES: MenuCategory[] = [
  {
    icon: <Globe className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'ホーム/ローカル/連合を選択',
        icon: <Globe className="h-3.5 w-3.5 text-blue-400" />,
        label: 'タイムライン種別',
        node: (): TimelineScope => ({
          kind: 'timeline-scope',
          timelineKeys: ['home'],
        }),
      },
      {
        description: '通知の種類でフィルタ',
        icon: <MessageSquare className="h-3.5 w-3.5 text-pink-400" />,
        label: '通知タイプ',
        node: (): TableFilter => ({
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'notification_types',
          value: ['mention', 'favourite', 'reblog'],
        }),
      },
      {
        description: 'ハッシュタグでフィルタ',
        icon: <Hash className="h-3.5 w-3.5 text-teal-400" />,
        label: 'ハッシュタグ',
        node: (): TableFilter => ({
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'hashtags',
          value: '',
        }),
      },
    ],
    label: 'ソース',
  },
  {
    icon: <Eye className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'メディア付き投稿のみ',
        icon: <Eye className="h-3.5 w-3.5 text-indigo-400" />,
        label: 'メディアあり',
        node: (): ExistsFilter => ({
          kind: 'exists-filter',
          mode: 'exists',
          table: 'post_media',
        }),
      },
      {
        description: '投稿言語でフィルタ',
        icon: <Globe className="h-3.5 w-3.5 text-cyan-400" />,
        label: '言語フィルタ',
        node: (): TableFilter => ({
          column: 'language',
          kind: 'table-filter',
          op: '=',
          table: 'posts',
          value: 'ja',
        }),
      },
      {
        description: 'public/unlisted/private',
        icon: <Eye className="h-3.5 w-3.5 text-yellow-400" />,
        label: '可視性フィルタ',
        node: (): TableFilter => ({
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'visibility_types',
          value: ['public'],
        }),
      },
      {
        description: 'CW (Content Warning) の有無',
        icon: <Eye className="h-3.5 w-3.5 text-green-400" />,
        label: 'CW フィルタ',
        node: (): TableFilter => ({
          column: 'spoiler_text',
          kind: 'table-filter',
          op: 'IS NULL',
          table: 'posts',
        }),
      },
    ],
    label: 'コンテンツ',
  },
  {
    icon: <User className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'アカウント名でフィルタ',
        icon: <User className="h-3.5 w-3.5 text-purple-400" />,
        label: '特定ユーザー',
        node: (): TableFilter => ({
          column: 'acct',
          kind: 'table-filter',
          op: '=',
          table: 'profiles',
          value: '',
        }),
      },
      {
        description: 'メンション先でフィルタ',
        icon: <User className="h-3.5 w-3.5 text-purple-400" />,
        label: 'メンション',
        node: (): ExistsFilter => ({
          kind: 'exists-filter',
          mode: 'exists',
          table: 'post_mentions',
        }),
      },
    ],
    label: 'アカウント',
  },
  {
    icon: <Zap className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'ふぁぼ/ブースト後の返信を検出',
        icon: <Zap className="h-3.5 w-3.5 text-yellow-400" />,
        label: '空中リプ検出',
        node: (): AerialReplyFilter => ({
          kind: 'aerial-reply-filter',
          notificationTypes: ['favourite', 'emoji_reaction', 'reblog'],
          timeWindowMs: 180000,
        }),
      },
      {
        description: 'ミュート/ブロック適用',
        icon: <Shield className="h-3.5 w-3.5 text-red-400" />,
        label: 'モデレーション',
        node: (): ModerationFilter => ({
          apply: ['mute', 'instance-block'],
          kind: 'moderation-filter',
        }),
      },
      {
        description: '表示アカウントを選択',
        icon: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
        label: 'バックエンド選択',
        node: (): IRBackendFilter => ({
          kind: 'backend-filter',
          localAccountIds: [],
        }),
      },
    ],
    label: 'インタラクション',
  },
  {
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'ふぁぼ数でフィルタ',
        icon: <BarChart3 className="h-3.5 w-3.5 text-amber-400" />,
        label: 'ふぁぼ数',
        node: (): TableFilter => ({
          column: 'favourites_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 10,
        }),
      },
      {
        description: 'ブースト数でフィルタ',
        icon: <BarChart3 className="h-3.5 w-3.5 text-amber-400" />,
        label: 'ブースト数',
        node: (): TableFilter => ({
          column: 'reblogs_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 5,
        }),
      },
      {
        description: 'リプライ数でフィルタ',
        icon: <BarChart3 className="h-3.5 w-3.5 text-amber-400" />,
        label: 'リプライ数',
        node: (): TableFilter => ({
          column: 'replies_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 3,
        }),
      },
    ],
    label: '統計',
  },
  {
    icon: <Code className="h-3.5 w-3.5" />,
    items: [
      {
        description: 'SQL を直接記述',
        icon: <Code className="h-3.5 w-3.5 text-orange-400" />,
        label: 'カスタム SQL',
        node: (): RawSQLFilter => ({
          kind: 'raw-sql-filter',
          referencedTables: [],
          where: '',
        }),
      },
    ],
    label: 'カスタム',
  },
]

// ---------------------------------------------------------------------------
// Preset templates
// ---------------------------------------------------------------------------

type Preset = {
  description: string
  label: string
  nodes: FilterNode[]
}

export const PRESETS: Preset[] = [
  {
    description: 'ホームTLのメディア付き投稿',
    label: '🖼 メディアのみ',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
    ],
  },
  {
    description: 'ふぁぼ50以上の公開投稿',
    label: '🔥 バズった投稿',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home', 'local'] },
      {
        column: 'name',
        kind: 'table-filter',
        op: 'IN',
        table: 'visibility_types',
        value: ['public'],
      },
      {
        column: 'favourites_count',
        kind: 'table-filter',
        op: '>=',
        table: 'post_stats',
        value: 50,
      },
    ],
  },
  {
    description: '日本語の投稿のみ表示',
    label: '🇯🇵 日本語のみ',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      {
        column: 'language',
        kind: 'table-filter',
        op: '=',
        table: 'posts',
        value: 'ja',
      },
    ],
  },
  {
    description: 'メンション・ふぁぼ・ブースト通知',
    label: '🔔 主要通知',
    nodes: [
      {
        column: 'name',
        kind: 'table-filter',
        op: 'IN',
        table: 'notification_types',
        value: ['mention', 'favourite', 'reblog'],
      },
    ],
  },
  {
    description: 'ふぁぼ/ブースト直後の返信を検出',
    label: '⚡ 空中リプ検出',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      {
        kind: 'aerial-reply-filter',
        notificationTypes: ['favourite', 'emoji_reaction', 'reblog'],
        timeWindowMs: 180000,
      },
    ],
  },
  {
    description: 'リプライのみ表示',
    label: '💬 リプライのみ',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      {
        column: 'in_reply_to_uri',
        kind: 'table-filter',
        op: 'IS NOT NULL',
        table: 'posts',
      },
    ],
  },
  {
    description: 'リプライを除外',
    label: '🚫 リプライ除外',
    nodes: [
      { kind: 'timeline-scope', timelineKeys: ['home'] },
      {
        column: 'in_reply_to_uri',
        kind: 'table-filter',
        op: 'IS NULL',
        table: 'posts',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AddFilterMenuProps = {
  onAddNode: (node: FilterNode) => void
  onApplyPreset: (nodes: FilterNode[]) => void
}

export function AddFilterMenu({
  onAddNode,
  onApplyPreset,
}: AddFilterMenuProps) {
  const [open, setOpen] = useState(false)

  const handleAdd = useCallback(
    (item: MenuItem) => {
      onAddNode(item.node())
      setOpen(false)
    },
    [onAddNode],
  )

  const handlePreset = useCallback(
    (preset: Preset) => {
      onApplyPreset(preset.nodes)
      setOpen(false)
    },
    [onApplyPreset],
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border border-dashed border-gray-500 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-400 hover:text-gray-200 transition-colors w-full justify-center"
          type="button"
        >
          <Plus className="h-3.5 w-3.5" />
          フィルタを追加
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0 bg-gray-800 border-gray-600"
        side="bottom"
      >
        {/* Presets section */}
        <div className="border-b border-gray-700 p-2">
          <div className="text-xs font-semibold text-gray-400 mb-1.5 px-1">
            プリセット
          </div>
          {PRESETS.map((preset) => (
            <button
              className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-gray-700 transition-colors"
              key={preset.label}
              onClick={() => handlePreset(preset)}
              type="button"
            >
              <div className="text-gray-200">{preset.label}</div>
              <div className="text-gray-500 text-[10px]">
                {preset.description}
              </div>
            </button>
          ))}
        </div>

        {/* Categories */}
        <div className="p-2 max-h-64 overflow-y-auto">
          {MENU_CATEGORIES.map((category) => (
            <div className="mb-2 last:mb-0" key={category.label}>
              <div className="flex items-center gap-1 text-xs font-semibold text-gray-400 px-1 mb-1">
                {category.icon}
                {category.label}
              </div>
              {category.items.map((item) => (
                <button
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-gray-700 transition-colors"
                  key={item.label}
                  onClick={() => handleAdd(item)}
                  type="button"
                >
                  {item.icon}
                  <div>
                    <div className="text-gray-200">{item.label}</div>
                    <div className="text-gray-500 text-[10px]">
                      {item.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
