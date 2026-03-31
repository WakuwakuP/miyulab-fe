'use client'

// ============================================================
// FlowQueryEditorModal — フルスクリーンフローエディタモーダル
// ============================================================
//
// ノード/エッジの状態を一元管理し、FlowCanvas に controlled props で渡す。
// ツールバーからのノード追加・削除もここで処理する。

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlowProvider,
} from '@xyflow/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from 'components/ui/dialog'
import {
  ArrowDownToLine,
  BarChart3,
  Code,
  Database,
  Eye,
  Filter,
  GitMerge,
  Globe,
  Hash,
  MessageSquare,
  Play,
  Shield,
  User,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { compileQueryPlan } from 'util/db/query-ir/compile'
import type { FilterNode, QueryPlan } from 'util/db/query-ir/nodes'
import type { ExecutionStep, IdCollectStep } from 'util/db/query-ir/plan'
import { validateQueryPlan } from 'util/db/query-ir/validate'
import { FlowCanvas, type ViewportCenterFn } from './FlowCanvas'
import { flowToQueryPlan } from './flowToQueryPlan'
import { queryPlanToFlow } from './queryPlanToFlow'
import type {
  FilterNodeData,
  FlowEdge,
  FlowGraphState,
  FlowNode,
} from './types'

// --------------- Props ---------------

type FlowQueryEditorModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPlan?: QueryPlan
  onSave: (plan: QueryPlan) => void
}

// --------------- Default plan ---------------

const DEFAULT_PLAN: QueryPlan = {
  composites: [],
  filters: [],
  pagination: { kind: 'pagination', limit: 50 },
  sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
  source: { kind: 'source', table: 'posts' },
}

// --------------- Add-node menu items ---------------

type AddMenuItem = {
  icon: React.ReactNode
  label: string
  description: string
  createNode: (id: string, viewport: { x: number; y: number }) => FlowNode
}

let addNodeCounter = 1000

function nextAddId(): string {
  return `add-${++addNodeCounter}`
}

/** 連続追加時にノードが重ならないよう小さくずらす */
let addJitterIndex = 0
function jitter(): { x: number; y: number } {
  const i = addJitterIndex++
  return { x: (i % 5) * 40, y: (i % 5) * 40 }
}

const ADD_MENU_ITEMS: AddMenuItem[] = [
  {
    createNode: (id, vp) => ({
      data: {
        config: { kind: 'source', table: 'posts' },
        nodeType: 'source',
      },
      id,
      position: vp,
      type: 'source',
    }),
    description: '投稿または通知テーブル',
    icon: <Database className="h-3.5 w-3.5 text-blue-400" />,
    label: 'ソース',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: { kind: 'timeline-scope', timelineKeys: ['home'] },
        label: 'TL: home',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'ホーム/ローカル/連合',
    icon: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
    label: 'タイムライン',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          branches: [
            [
              {
                accountScope: [1],
                kind: 'timeline-scope',
                timelineKeys: ['home'],
              },
            ],
            [
              {
                accountScope: [2],
                kind: 'timeline-scope',
                timelineKeys: ['local'],
              },
            ],
          ],
          kind: 'or-group',
        } satisfies FilterNode,
        label: 'OR分岐 (2条件)',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: '条件のOR結合',
    icon: <Filter className="h-3.5 w-3.5 text-cyan-400" />,
    label: 'OR分岐',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: { kind: 'exists-filter', mode: 'exists', table: 'post_media' },
        label: '存在: post_media',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'メディア付き投稿のみ',
    icon: <Eye className="h-3.5 w-3.5 text-indigo-400" />,
    label: 'メディアあり',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          column: 'name',
          kind: 'table-filter',
          op: 'IN',
          table: 'notification_types',
          value: ['mention', 'favourite', 'reblog'],
        },
        label: 'notification_types.name IN mention, favourite, reblog',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: '通知の種類でフィルタ',
    icon: <MessageSquare className="h-3.5 w-3.5 text-pink-400" />,
    label: '通知タイプ',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          column: 'name',
          kind: 'table-filter',
          op: '=',
          table: 'hashtags',
          value: '',
        },
        label: 'hashtags.name = ',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'タグでフィルタ',
    icon: <Hash className="h-3.5 w-3.5 text-teal-400" />,
    label: 'ハッシュタグ',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          column: 'acct',
          kind: 'table-filter',
          op: '=',
          table: 'profiles',
          value: '',
        },
        label: 'profiles.acct = ',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'アカウントでフィルタ',
    icon: <User className="h-3.5 w-3.5 text-purple-400" />,
    label: 'アカウント',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          kind: 'aerial-reply-filter',
          notificationTypes: ['favourite', 'reaction', 'reblog'],
          timeWindowMs: 180000,
        },
        label: '空中リプ (180秒)',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'ふぁぼ/ブースト後の返信',
    icon: <Zap className="h-3.5 w-3.5 text-yellow-400" />,
    label: '空中リプ検出',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          column: 'favourites_count',
          kind: 'table-filter',
          op: '>=',
          table: 'post_stats',
          value: 10,
        },
        label: 'post_stats.favourites_count >= 10',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'ふぁぼ数でフィルタ',
    icon: <BarChart3 className="h-3.5 w-3.5 text-amber-400" />,
    label: 'ふぁぼ数',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: {
          apply: ['mute', 'instance-block'],
          kind: 'moderation-filter',
        },
        label: 'モデレーション: mute, instance-block',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'ミュート/ブロック適用',
    icon: <Shield className="h-3.5 w-3.5 text-red-400" />,
    label: 'モデレーション',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: { kind: 'backend-filter', localAccountIds: [] },
        label: 'アカウント: 未選択',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: '表示アカウント選択',
    icon: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
    label: 'バックエンド',
  },
  {
    createNode: (id, vp) => ({
      data: {
        filter: { kind: 'raw-sql-filter', referencedTables: [], where: '' },
        label: 'SQL: ',
        nodeType: 'filter',
      } satisfies FilterNodeData,
      id,
      position: vp,
      type: 'filter',
    }),
    description: 'SQL WHERE を直接記述',
    icon: <Code className="h-3.5 w-3.5 text-orange-400" />,
    label: 'カスタムSQL',
  },
  {
    createNode: (id, vp) => ({
      data: {
        limit: 50,
        nodeType: 'merge',
        strategy: 'interleave-by-time' as const,
      },
      id,
      position: vp,
      type: 'merge',
    }),
    description: '複数ソースを時間順に結合',
    icon: <GitMerge className="h-3.5 w-3.5 text-cyan-400" />,
    label: 'マージ',
  },
  {
    createNode: (id, vp) => ({
      data: {
        nodeType: 'output',
        pagination: { kind: 'pagination', limit: 50 },
        sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
      },
      id,
      position: vp,
      type: 'output',
    }),
    description: 'ソート & ページネーション',
    icon: <ArrowDownToLine className="h-3.5 w-3.5 text-green-400" />,
    label: '出力',
  },
]

// --------------- Component ---------------

export function FlowQueryEditorModal({
  open,
  onOpenChange,
  initialPlan,
  onSave,
}: FlowQueryEditorModalProps) {
  const plan = initialPlan ?? DEFAULT_PLAN

  // --- viewport center ref (FlowCanvas が更新する) ---
  const viewportCenterRef = useRef<ViewportCenterFn | null>(null)

  // --- controlled state for nodes / edges ---
  const [nodes, setNodes] = useState<FlowNode[]>(
    () => queryPlanToFlow(plan).nodes,
  )
  const [edges, setEdges] = useState<FlowEdge[]>(
    () => queryPlanToFlow(plan).edges,
  )

  // --- React Flow change handlers ---
  const onNodesChange: OnNodesChange = useCallback(
    (changes) =>
      setNodes((nds) => applyNodeChanges(changes, nds) as FlowNode[]),
    [],
  )
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) =>
      setEdges((eds) => applyEdgeChanges(changes, eds) as FlowEdge[]),
    [],
  )
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds) as FlowEdge[]),
    [],
  )

  // --- add / delete ---
  const handleAddNode = useCallback((item: AddMenuItem) => {
    const id = nextAddId()
    const center = viewportCenterRef.current
      ? viewportCenterRef.current()
      : { x: 300, y: 200 }
    const j = jitter()
    const pos = { x: center.x + j.x, y: center.y + j.y }
    const newNode = item.createNode(id, pos)
    setNodes((nds) => [...nds, newNode])
  }, [])

  const handleDeleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id))
  }, [])

  const handleUpdateNodeData = useCallback(
    (id: string, data: FlowNode['data']) => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data } : n)))
    },
    [],
  )

  // --- derive QueryPlan from current graph ---
  const flowState: FlowGraphState = useMemo(
    () => ({ edges, nodes }),
    [nodes, edges],
  )
  const currentPlan = useMemo(() => flowToQueryPlan(flowState), [flowState])

  // --- validate ---
  const validation = useMemo(
    () => validateQueryPlan(currentPlan),
    [currentPlan],
  )

  // --- SQL preview ---
  const sqlPreview = useMemo(() => {
    try {
      const compiled = compileQueryPlan(currentPlan)
      const idStep = compiled.steps.find(
        (s: ExecutionStep) => s.type === 'id-collect',
      ) as IdCollectStep | undefined
      return idStep?.sql ?? '(プレビュー不可)'
    } catch {
      return '(コンパイルエラー)'
    }
  }, [currentPlan])

  // --- save ---
  const handleSave = useCallback(() => {
    onSave(currentPlan)
    onOpenChange(false)
  }, [currentPlan, onSave, onOpenChange])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 bg-gray-900 border-gray-700 flex flex-col overflow-hidden [&>button]:hidden">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
              <Filter className="h-5 w-5 text-cyan-400" />
              フローエディタ
            </DialogTitle>
            <div className="flex items-center gap-2">
              {/* Validation status */}
              {!validation.valid && (
                <span className="text-xs text-red-400 bg-red-900/30 px-2 py-1 rounded">
                  ⚠️ {validation.errors[0]}
                </span>
              )}
              {validation.warnings.length > 0 && validation.valid && (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-1 rounded">
                  ⚠ {validation.warnings[0]}
                </span>
              )}
              <button
                className="px-3 py-1.5 rounded bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
                onClick={() => onOpenChange(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-sm text-white hover:bg-blue-500 transition-colors flex items-center gap-1"
                onClick={handleSave}
                type="button"
              >
                <Play className="h-3.5 w-3.5" />
                保存して適用
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-gray-700 shrink-0 flex items-center gap-2 overflow-x-auto">
          <span className="text-xs text-gray-500 mr-1 shrink-0">
            ノード追加:
          </span>
          {ADD_MENU_ITEMS.map((item) => (
            <button
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 hover:border-gray-600 transition-colors whitespace-nowrap shrink-0"
              key={item.label}
              onClick={() => handleAddNode(item)}
              title={item.description}
              type="button"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-h-0">
          <ReactFlowProvider>
            <FlowCanvas
              edges={edges}
              nodes={nodes}
              onConnect={onConnect}
              onDeleteNode={handleDeleteNode}
              onEdgesChange={onEdgesChange}
              onNodesChange={onNodesChange}
              onUpdateNodeData={handleUpdateNodeData}
              viewportCenterRef={viewportCenterRef}
            />
          </ReactFlowProvider>
        </div>

        {/* SQL Preview Footer */}
        <div className="border-t border-gray-700 px-4 py-2 shrink-0 bg-gray-950">
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
              SQL プレビュー
            </summary>
            <pre className="mt-1 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
              {sqlPreview}
            </pre>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  )
}
