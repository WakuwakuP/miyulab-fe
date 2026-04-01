'use client'

// ============================================================
// FlowNodePanel — ノード選択時のプロパティパネル
// ============================================================

import { ValueInput } from 'app/_components/NodeEditor/ValueInput'
import { Checkbox } from 'components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import { X } from 'lucide-react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ResolvedAccount } from 'util/accountResolver'
import { getSnapshot, subscribeAccountResolver } from 'util/accountResolver'
import {
  getAllFilterableTables,
  getExistsFilterTables,
  getFilterableColumns,
  getKnownValues,
} from 'util/db/query-ir/completion'
import type {
  AerialReplyFilter,
  BackendFilter,
  ExistsFilter,
  FilterNode,
  FilterOp,
  ModerationFilter,
  SourceNode,
  TableFilter,
  TimelineScope,
} from 'util/db/query-ir/nodes'
import { searchColumnValuesDirect } from 'util/db/sqlite/stores/statusReadStore'
import type { FlowNode, MergeNodeData } from './types'
import { getFilterLabel } from './types'

type Props = {
  node: FlowNode
  onUpdate: (id: string, data: FlowNode['data']) => void
  onDelete: () => void
  onClose: () => void
}

// --------------- Account hook ---------------

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function useAccounts(): ReadonlyMap<string, ResolvedAccount> {
  return useSyncExternalStore(
    subscribeAccountResolver,
    getSnapshot,
    getSnapshot,
  )
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
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select onValueChange={handleTableChange} value={data.config.table}>
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="posts">投稿 (posts)</SelectItem>
            <SelectItem value="notifications">通知 (notifications)</SelectItem>
          </SelectContent>
        </Select>
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
  const accounts = useAccounts()
  const accountEntries = useMemo(() => [...accounts.entries()], [accounts])

  const toggleKey = useCallback(
    (key: string) => {
      const keys = filter.timelineKeys.includes(key)
        ? filter.timelineKeys.filter((k) => k !== key)
        : [...filter.timelineKeys, key]
      onUpdate({ ...filter, timelineKeys: keys.length > 0 ? keys : [key] })
    },
    [filter, onUpdate],
  )

  const toggleAccountScope = useCallback(
    (localAccountId: number) => {
      const current = new Set(filter.accountScope ?? [])
      if (current.has(localAccountId)) {
        current.delete(localAccountId)
      } else {
        current.add(localAccountId)
      }
      onUpdate({
        ...filter,
        accountScope: current.size > 0 ? [...current] : undefined,
      })
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
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          アカウントスコープ
        </span>
        {accountEntries.length > 0 ? (
          <div className="space-y-1">
            {accountEntries.map(([url, resolved]) => (
              <span
                className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
                key={url}
                onClick={() => toggleAccountScope(resolved.localAccountId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ')
                    toggleAccountScope(resolved.localAccountId)
                }}
              >
                <Checkbox
                  checked={(filter.accountScope ?? []).includes(
                    resolved.localAccountId,
                  )}
                  onCheckedChange={() =>
                    toggleAccountScope(resolved.localAccountId)
                  }
                />
                <span className="truncate" title={url}>
                  {safeHostname(url)}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            {filter.accountScope?.join(', ') ?? '全アカウント'}
          </div>
        )}
      </div>
    </>
  )
}

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
  { label: 'NOT LIKE', value: 'NOT LIKE' },
  { label: 'GLOB', value: 'GLOB' },
]

function TableFilterPanel({
  filter,
  onUpdate,
}: {
  filter: TableFilter
  onUpdate: (f: FilterNode) => void
}) {
  const tableOptions = useMemo(() => getAllFilterableTables(), [])
  const columnOptions = useMemo(
    () => getFilterableColumns(filter.table),
    [filter.table],
  )
  const knownValues = useMemo(
    () => getKnownValues(filter.table, filter.column),
    [filter.table, filter.column],
  )
  const columnMeta = useMemo(
    () => columnOptions.find((c) => c.name === filter.column),
    [columnOptions, filter.column],
  )

  const isNullOp = filter.op === 'IS NULL' || filter.op === 'IS NOT NULL'

  const handleTableChange = useCallback(
    (table: string) => {
      const cols = getFilterableColumns(table)
      const firstCol = cols[0]?.name ?? ''
      onUpdate({ ...filter, column: firstCol, table, value: '' })
    },
    [filter, onUpdate],
  )

  const handleColumnChange = useCallback(
    (column: string) => {
      onUpdate({ ...filter, column, value: '' })
    },
    [filter, onUpdate],
  )

  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select onValueChange={handleTableChange} value={filter.table}>
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue placeholder="テーブル" />
          </SelectTrigger>
          <SelectContent>
            {tableOptions.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          カラム
        </span>
        {columnOptions.length > 0 ? (
          <Select onValueChange={handleColumnChange} value={filter.column}>
            <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
              <SelectValue placeholder="カラム" />
            </SelectTrigger>
            <SelectContent>
              {columnOptions.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) => onUpdate({ ...filter, column: e.target.value })}
            type="text"
            value={filter.column}
          />
        )}
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          演算子
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate({ ...filter, op: v as TableFilter['op'] })
          }
          value={filter.op}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
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
      </div>
      {!isNullOp && (
        <div>
          <span className="text-xs font-semibold text-gray-300 block mb-1">
            値
          </span>
          <ValueInput
            column={filter.column}
            columnType={columnMeta?.type ?? 'text'}
            knownValues={knownValues}
            onChange={(value) => onUpdate({ ...filter, value })}
            op={filter.op}
            searchValues={searchColumnValuesDirect}
            table={filter.table}
            value={filter.value ?? ''}
          />
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
  const existsTableOptions = useMemo(() => getExistsFilterTables(), [])

  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          テーブル
        </span>
        <Select
          onValueChange={(v) => onUpdate({ ...filter, table: v })}
          value={filter.table}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue placeholder="テーブル" />
          </SelectTrigger>
          <SelectContent>
            {existsTableOptions.map((t) => (
              <SelectItem key={t.table} value={t.table}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          モード
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate({
              ...filter,
              mode: v as ExistsFilter['mode'],
            })
          }
          value={filter.mode}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exists">EXISTS</SelectItem>
            <SelectItem value="not-exists">NOT EXISTS</SelectItem>
            <SelectItem value="count-gte">COUNT ≥</SelectItem>
            <SelectItem value="count-lte">COUNT ≤</SelectItem>
            <SelectItem value="count-eq">COUNT =</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {filter.mode.startsWith('count-') && (
        <div>
          <span className="text-xs font-semibold text-gray-300 block mb-1">
            カウント値
          </span>
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate({ ...filter, countValue: Number(e.target.value) })
            }
            type="number"
            value={filter.countValue ?? 0}
          />
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
  const accounts = useAccounts()
  const accountEntries = useMemo(() => [...accounts.entries()], [accounts])

  const toggleAccount = useCallback(
    (localAccountId: number) => {
      const ids = new Set(filter.localAccountIds)
      if (ids.has(localAccountId)) {
        ids.delete(localAccountId)
      } else {
        ids.add(localAccountId)
      }
      onUpdate({ ...filter, localAccountIds: [...ids] })
    },
    [filter, onUpdate],
  )

  if (accountEntries.length === 0) {
    return (
      <div className="text-xs text-gray-400">
        アカウント ID: {filter.localAccountIds.join(', ') || '(なし)'}
      </div>
    )
  }

  return (
    <div>
      <span className="text-xs font-semibold text-gray-300 block mb-1">
        ローカルアカウント
      </span>
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
              checked={filter.localAccountIds.includes(resolved.localAccountId)}
              onCheckedChange={() => toggleAccount(resolved.localAccountId)}
            />
            <span className="truncate" title={url}>
              {safeHostname(url)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

const AERIAL_NOTIFICATION_TYPES = [
  { key: 'favourite', label: 'ふぁぼ' },
  { key: 'reaction', label: 'リアクション' },
  { key: 'reblog', label: 'ブースト' },
  { key: 'emoji_reaction', label: '絵文字リアクション' },
]

const AERIAL_TIME_WINDOWS = [
  { label: '1分', value: '60000' },
  { label: '3分', value: '180000' },
  { label: '5分', value: '300000' },
  { label: '10分', value: '600000' },
]

function AerialReplyPanel({
  filter,
  onUpdate,
}: {
  filter: AerialReplyFilter
  onUpdate: (f: FilterNode) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          通知種別
        </span>
        <div className="space-y-1">
          {AERIAL_NOTIFICATION_TYPES.map(({ key, label }) => (
            <span
              className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
              key={key}
              onClick={() => {
                const types = filter.notificationTypes.includes(key)
                  ? filter.notificationTypes.filter((x) => x !== key)
                  : [...filter.notificationTypes, key]
                if (types.length > 0)
                  onUpdate({ ...filter, notificationTypes: types })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  const types = filter.notificationTypes.includes(key)
                    ? filter.notificationTypes.filter((x) => x !== key)
                    : [...filter.notificationTypes, key]
                  if (types.length > 0)
                    onUpdate({ ...filter, notificationTypes: types })
                }
              }}
            >
              <Checkbox
                checked={filter.notificationTypes.includes(key)}
                onCheckedChange={() => {
                  const types = filter.notificationTypes.includes(key)
                    ? filter.notificationTypes.filter((x) => x !== key)
                    : [...filter.notificationTypes, key]
                  if (types.length > 0)
                    onUpdate({ ...filter, notificationTypes: types })
                }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          時間窓
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate({ ...filter, timeWindowMs: Number(v) })
          }
          value={String(filter.timeWindowMs)}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AERIAL_TIME_WINDOWS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      <div className="space-y-1">
        {APPLY_OPTIONS.map((opt) => (
          <span
            className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
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
              }
            }}
          >
            <Checkbox
              checked={filter.apply.includes(opt.key)}
              onCheckedChange={() => {
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
            />
            {opt.label}
          </span>
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
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          ソート方向
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              sort: {
                ...data.sort,
                direction: v as 'ASC' | 'DESC',
              },
            })
          }
          value={data.sort.direction}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DESC">新しい順 (DESC)</SelectItem>
            <SelectItem value="ASC">古い順 (ASC)</SelectItem>
          </SelectContent>
        </Select>
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
