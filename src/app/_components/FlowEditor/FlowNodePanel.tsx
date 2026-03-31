'use client'

// ============================================================
// FlowNodePanel — ノード選択時のプロパティパネル
// ============================================================

import { X } from 'lucide-react'
import { useCallback } from 'react'
import type {
  AerialReplyFilter,
  BackendFilter,
  ExistsFilter,
  FilterNode,
  ModerationFilter,
  SourceNode,
  TableFilter,
  TimelineScope,
} from 'util/db/query-ir/nodes'
import type { FlowNode, MergeNodeData } from './types'
import { getFilterLabel } from './types'

type Props = {
  node: FlowNode
  onUpdate: (id: string, data: FlowNode['data']) => void
  onDelete: () => void
  onClose: () => void
}

export function FlowNodePanel({ node, onUpdate, onDelete, onClose }: Props) {
  const data = node.data as { nodeType: string }

  return (
    <div className="w-72 border-l border-gray-700 bg-gray-850 p-4 overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">ノード設定</h3>
        <button
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {data.nodeType === 'source' && (
        <SourcePanel node={node} onUpdate={onUpdate} />
      )}
      {data.nodeType === 'filter' && (
        <FilterPanel node={node} onUpdate={onUpdate} />
      )}
      {data.nodeType === 'merge' && (
        <MergePanel node={node} onUpdate={onUpdate} />
      )}
      {data.nodeType === 'output' && (
        <OutputPanel node={node} onUpdate={onUpdate} />
      )}

      {/* 削除ボタン */}
      <div className="mt-auto pt-4 border-t border-gray-700">
        <button
          className="w-full rounded bg-red-900/40 border border-red-700/50 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/70 hover:text-red-300 transition-colors"
          onClick={onDelete}
          type="button"
        >
          このノードを削除
        </button>
      </div>
    </div>
  )
}

// --------------- Source Panel ---------------

function SourcePanel({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as { nodeType: 'source'; config: SourceNode }

  const handleTableChange = useCallback(
    (table: string) => {
      onUpdate(node.id, {
        ...data,
        config: { ...data.config, table },
      })
    },
    [node.id, data, onUpdate],
  )

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
          <select
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => handleTableChange(e.target.value)}
            value={data.config.table}
          >
            <option value="posts">投稿 (posts)</option>
            <option value="notifications">通知 (notifications)</option>
          </select>
        </label>
      </div>
    </div>
  )
}

// --------------- Filter Panel ---------------

function FilterPanel({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as {
    nodeType: 'filter'
    filter: FilterNode
    label: string
  }

  const updateFilter = useCallback(
    (filter: FilterNode) => {
      onUpdate(node.id, {
        ...data,
        filter,
        label: getFilterLabel(filter),
      })
    },
    [node.id, data, onUpdate],
  )

  const filter = data.filter

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1">
        種別: <span className="text-white">{filter.kind}</span>
      </div>

      {filter.kind === 'timeline-scope' && (
        <TimelineScopePanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'table-filter' && (
        <TableFilterPanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'exists-filter' && (
        <ExistsFilterPanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'backend-filter' && (
        <BackendFilterPanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'aerial-reply-filter' && (
        <AerialReplyPanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'moderation-filter' && (
        <ModerationPanel filter={filter} onUpdate={updateFilter} />
      )}
      {filter.kind === 'raw-sql-filter' && (
        <div>
          <label className="text-xs font-semibold text-gray-300 block mb-1">
            SQL WHERE
            <textarea
              className="w-full rounded bg-gray-700 px-2 py-1.5 text-xs text-white border border-gray-600 font-mono h-20 resize-y"
              onChange={(e) =>
                updateFilter({ ...filter, where: e.target.value })
              }
              value={filter.where}
            />
          </label>
        </div>
      )}
    </div>
  )
}

// --------------- Sub-panels ---------------

const TIMELINE_OPTIONS = [
  { key: 'home', label: 'ホーム' },
  { key: 'local', label: 'ローカル' },
  { key: 'public', label: '連合' },
  { key: 'tag', label: 'タグ' },
]

function TimelineScopePanel({
  filter,
  onUpdate,
}: {
  filter: TimelineScope
  onUpdate: (f: FilterNode) => void
}) {
  const toggleKey = useCallback(
    (key: string) => {
      const keys = filter.timelineKeys.includes(key)
        ? filter.timelineKeys.filter((k) => k !== key)
        : [...filter.timelineKeys, key]
      onUpdate({ ...filter, timelineKeys: keys.length > 0 ? keys : [key] })
    },
    [filter, onUpdate],
  )

  return (
    <>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          タイムライン種別
        </span>
        <div className="flex flex-wrap gap-1">
          {TIMELINE_OPTIONS.map((opt) => (
            <button
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filter.timelineKeys.includes(opt.key)
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              key={opt.key}
              onClick={() => toggleKey(opt.key)}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          アカウントスコープ (ID, カンマ区切り)
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => {
              const ids = e.target.value
                .split(',')
                .map((s) => Number.parseInt(s.trim(), 10))
                .filter((n) => !Number.isNaN(n))
              onUpdate({
                ...filter,
                accountScope: ids.length > 0 ? ids : undefined,
              })
            }}
            placeholder="例: 1, 2"
            type="text"
            value={filter.accountScope?.join(', ') ?? ''}
          />
        </label>
      </div>
    </>
  )
}

function TableFilterPanel({
  filter,
  onUpdate,
}: {
  filter: TableFilter
  onUpdate: (f: FilterNode) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => onUpdate({ ...filter, table: e.target.value })}
            type="text"
            value={filter.table}
          />
        </label>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          カラム
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => onUpdate({ ...filter, column: e.target.value })}
            type="text"
            value={filter.column}
          />
        </label>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          演算子
          <select
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate({ ...filter, op: e.target.value as TableFilter['op'] })
            }
            value={filter.op}
          >
            {[
              '=',
              '!=',
              '>',
              '>=',
              '<',
              '<=',
              'IN',
              'NOT IN',
              'IS NULL',
              'IS NOT NULL',
              'LIKE',
              'NOT LIKE',
              'GLOB',
            ].map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filter.op !== 'IS NULL' && filter.op !== 'IS NOT NULL' && (
        <div>
          <label className="text-xs font-semibold text-gray-300 block mb-1">
            値
            <input
              className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
              onChange={(e) => {
                const raw = e.target.value
                if (filter.op === 'IN' || filter.op === 'NOT IN') {
                  const values = raw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  onUpdate({ ...filter, value: values })
                } else {
                  const num = Number(raw)
                  onUpdate({ ...filter, value: Number.isNaN(num) ? raw : num })
                }
              }}
              placeholder={
                filter.op === 'IN' || filter.op === 'NOT IN'
                  ? 'カンマ区切り'
                  : '値'
              }
              type="text"
              value={
                Array.isArray(filter.value)
                  ? filter.value.join(', ')
                  : String(filter.value ?? '')
              }
            />
          </label>
        </div>
      )}
    </div>
  )
}

function ExistsFilterPanel({
  filter,
  onUpdate,
}: {
  filter: ExistsFilter
  onUpdate: (f: FilterNode) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => onUpdate({ ...filter, table: e.target.value })}
            type="text"
            value={filter.table}
          />
        </label>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          モード
          <select
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate({
                ...filter,
                mode: e.target.value as ExistsFilter['mode'],
              })
            }
            value={filter.mode}
          >
            <option value="exists">EXISTS</option>
            <option value="not-exists">NOT EXISTS</option>
            <option value="count-gte">COUNT &gt;=</option>
            <option value="count-lte">COUNT &lt;=</option>
            <option value="count-eq">COUNT =</option>
          </select>
        </label>
      </div>
      {filter.mode.startsWith('count-') && (
        <div>
          <label className="text-xs font-semibold text-gray-300 block mb-1">
            カウント値
            <input
              className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
              onChange={(e) =>
                onUpdate({ ...filter, countValue: Number(e.target.value) })
              }
              type="number"
              value={filter.countValue ?? 0}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function BackendFilterPanel({
  filter,
  onUpdate,
}: {
  filter: BackendFilter
  onUpdate: (f: FilterNode) => void
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-300 block mb-1">
        ローカルアカウント ID (カンマ区切り)
        <input
          className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
          onChange={(e) => {
            const ids = e.target.value
              .split(',')
              .map((s) => Number.parseInt(s.trim(), 10))
              .filter((n) => !Number.isNaN(n))
            onUpdate({ ...filter, localAccountIds: ids })
          }}
          placeholder="例: 1, 2"
          type="text"
          value={filter.localAccountIds.join(', ')}
        />
      </label>
    </div>
  )
}

function AerialReplyPanel({
  filter,
  onUpdate,
}: {
  filter: AerialReplyFilter
  onUpdate: (f: FilterNode) => void
}) {
  const TYPES = ['favourite', 'reaction', 'reblog', 'emoji_reaction']

  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          通知種別
        </span>
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => (
            <button
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                filter.notificationTypes.includes(t)
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
              key={t}
              onClick={() => {
                const types = filter.notificationTypes.includes(t)
                  ? filter.notificationTypes.filter((x) => x !== t)
                  : [...filter.notificationTypes, t]
                onUpdate({ ...filter, notificationTypes: types })
              }}
              type="button"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          時間窓 (秒)
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate({
                ...filter,
                timeWindowMs: Number(e.target.value) * 1000,
              })
            }
            type="number"
            value={filter.timeWindowMs / 1000}
          />
        </label>
      </div>
    </div>
  )
}

function ModerationPanel({
  filter,
  onUpdate,
}: {
  filter: ModerationFilter
  onUpdate: (f: FilterNode) => void
}) {
  const APPLY_OPTIONS: { key: 'mute' | 'instance-block'; label: string }[] = [
    { key: 'mute', label: 'ミュート' },
    { key: 'instance-block', label: 'インスタンスブロック' },
  ]

  return (
    <div>
      <span className="text-xs font-semibold text-gray-300 block mb-1">
        適用フィルタ
      </span>
      <div className="flex flex-wrap gap-1">
        {APPLY_OPTIONS.map((opt) => (
          <button
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              filter.apply.includes(opt.key)
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
            key={opt.key}
            onClick={() => {
              const apply = filter.apply.includes(opt.key)
                ? filter.apply.filter((a) => a !== opt.key)
                : [...filter.apply, opt.key]
              onUpdate({
                ...filter,
                apply:
                  apply.length > 0
                    ? (apply as ('mute' | 'instance-block')[])
                    : [opt.key],
              })
            }}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// --------------- Merge & Output panels ---------------

function MergePanel({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as MergeNodeData

  return (
    <div>
      <label className="text-xs font-semibold text-gray-300 block mb-1">
        リミット
        <input
          className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
          onChange={(e) =>
            onUpdate(node.id, { ...data, limit: Number(e.target.value) })
          }
          type="number"
          value={data.limit}
        />
      </label>
    </div>
  )
}

function OutputPanel({
  node,
  onUpdate,
}: {
  node: FlowNode
  onUpdate: Props['onUpdate']
}) {
  const data = node.data as {
    nodeType: 'output'
    sort: { kind: 'sort'; field: string; direction: 'ASC' | 'DESC' }
    pagination: { kind: 'pagination'; limit: number }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          ソート方向
          <select
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                sort: {
                  ...data.sort,
                  direction: e.target.value as 'ASC' | 'DESC',
                },
              })
            }
            value={data.sort.direction}
          >
            <option value="DESC">新しい順 (DESC)</option>
            <option value="ASC">古い順 (ASC)</option>
          </select>
        </label>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          取得件数
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                pagination: {
                  ...data.pagination,
                  limit: Number(e.target.value),
                },
              })
            }
            type="number"
            value={data.pagination.limit}
          />
        </label>
      </div>
    </div>
  )
}
