'use client'

// ============================================================
// FlowQueryEditorModal — QueryPlanV2 ベースのフルスクリーンフローエディタ
// ============================================================

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlowProvider,
} from '@xyflow/react'
import { InstanceBlockManager } from 'app/_parts/InstanceBlockManager'
import { MuteManager } from 'app/_parts/MuteManager'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from 'components/ui/dialog'
import {
  ArrowDownToLine,
  BarChart3,
  Filter,
  GitMerge,
  Link2,
  Play,
  Shield,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BackendFilter, TimelineConfigV2 } from 'types/types'
import { resolveBackendUrlFromAccountId } from 'util/accountResolver'
import { compilePhase1ForTimeline } from 'util/db/query-ir/compat/compilePhase1'
import type { ConfigToNodesContext } from 'util/db/query-ir/compat/configToNodes'
import { configToQueryPlan } from 'util/db/query-ir/compat/configToNodes'
import { nodesToWhere } from 'util/db/query-ir/compat/nodesToWhere'
import { normalizeQueryPlanForExecution } from 'util/db/query-ir/compat/normalizeQueryPlan'
import type { QueryPlan } from 'util/db/query-ir/nodes'
import { isQueryPlanV2, type QueryPlanV2 } from 'util/db/query-ir/nodes'
import { migrateQueryPlanV1ToV2 } from 'util/db/query-ir/v2/migrateV1ToV2'
import { validateQueryPlanV2 } from 'util/db/query-ir/v2/validateV2'
import { FlowCanvas, type ViewportCenterFn } from './FlowCanvas'
import { flowToQueryPlanV2 } from './flowToQueryPlanV2'
import { queryPlanToFlow } from './queryPlanToFlow'
import type { FlowEdge, FlowGraphState, FlowNode } from './types'

// --------------- Props ---------------

type FlowQueryEditorModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集対象のタイムライン設定 */
  config: TimelineConfigV2
  onSave: (updates: Partial<TimelineConfigV2>) => void
}

// --------------- Default QueryPlanV2 ---------------

function createDefaultQueryPlanV2(): QueryPlanV2 {
  const a =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `a-${Date.now()}`
  const b =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `b-${Date.now() + 1}`
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: { filters: [], kind: 'get-ids', table: 'posts' },
      },
      {
        id: b,
        node: {
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

function planFromConfig(config: TimelineConfigV2): QueryPlanV2 {
  if (config.queryPlan) {
    if (isQueryPlanV2(config.queryPlan)) {
      return config.queryPlan
    }
    return migrateQueryPlanV1ToV2(config.queryPlan)
  }
  const ctx: ConfigToNodesContext = {
    localAccountIds: [],
    queryLimit: 50,
    serverIds: [],
  }
  return migrateQueryPlanV1ToV2(configToQueryPlan(config, ctx))
}

// --------------- Add-node menu (V2) ---------------

type AddMenuItem = {
  icon: React.ReactNode
  label: string
  description: string
  createNode: (id: string, viewport: { x: number; y: number }) => FlowNode
}

const ADD_MENU_ITEMS: AddMenuItem[] = [
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

// --------------- Component ---------------

export function FlowQueryEditorModal({
  open,
  onOpenChange,
  config,
  onSave,
}: FlowQueryEditorModalProps) {
  const [label, setLabel] = useState(config.label ?? '')
  const [showMuteManager, setShowMuteManager] = useState(false)
  const [showBlockManager, setShowBlockManager] = useState(false)

  const viewportCenterRef = useRef<ViewportCenterFn | null>(null)
  const addNodeCounterRef = useRef(1000)
  const addJitterIndexRef = useRef(0)

  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [edges, setEdges] = useState<FlowEdge[]>([])

  const resolvedPlanV2 = useMemo(() => {
    try {
      return planFromConfig(config)
    } catch {
      return createDefaultQueryPlanV2()
    }
  }, [config])

  useEffect(() => {
    if (open) {
      setLabel(config.label ?? '')
    }
  }, [open, config.label])

  useEffect(() => {
    if (open) {
      const flow = queryPlanToFlow(resolvedPlanV2)
      setNodes(flow.nodes)
      setEdges(flow.edges)
      addNodeCounterRef.current = 1000
      addJitterIndexRef.current = 0
    }
  }, [open, resolvedPlanV2])

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

  const handleAddNode = useCallback((item: AddMenuItem) => {
    const id = `add-${++addNodeCounterRef.current}`
    const center = viewportCenterRef.current
      ? viewportCenterRef.current()
      : { x: 300, y: 200 }
    const i = addJitterIndexRef.current++
    const j = { x: (i % 5) * 40, y: (i % 5) * 40 }
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

  const flowState: FlowGraphState = useMemo(
    () => ({ edges, nodes }),
    [nodes, edges],
  )

  const currentPlanV2 = useMemo(() => {
    try {
      return flowToQueryPlanV2(flowState)
    } catch {
      return createDefaultQueryPlanV2()
    }
  }, [flowState])

  const validation = useMemo(
    () => validateQueryPlanV2(currentPlanV2),
    [currentPlanV2],
  )

  const previewCtx = useMemo((): ConfigToNodesContext => {
    const outN = currentPlanV2.nodes.find((n) => n.node.kind === 'output-v2')
    const limit =
      outN?.node.kind === 'output-v2' ? outN.node.pagination.limit : 50
    return {
      localAccountIds: [],
      queryLimit: limit,
      serverIds: [],
    }
  }, [currentPlanV2])

  const sqlPreview = useMemo(() => {
    try {
      const v1 = normalizeQueryPlanForExecution(currentPlanV2, previewCtx)
      return compilePhase1ForTimeline(v1).sql
    } catch {
      return '(プレビュー生成エラー)'
    }
  }, [currentPlanV2, previewCtx])

  const handleFlowSave = useCallback(
    (plan: QueryPlanV2) => {
      const v1ForExtract = normalizeQueryPlanForExecution(
        plan,
        previewCtx,
      ) as QueryPlan

      const moderationNode = v1ForExtract.filters.find(
        (f) => f.kind === 'moderation-filter',
      )
      const applyMute =
        moderationNode?.kind === 'moderation-filter' &&
        moderationNode.apply.includes('mute')
      const applyBlock =
        moderationNode?.kind === 'moderation-filter' &&
        moderationNode.apply.includes('instance-block')

      const backendNode = v1ForExtract.filters.find(
        (f) => f.kind === 'backend-filter',
      )
      let backendFilter: BackendFilter | undefined
      if (
        backendNode?.kind === 'backend-filter' &&
        backendNode.localAccountIds.length > 0
      ) {
        const urls = backendNode.localAccountIds
          .map((id) => resolveBackendUrlFromAccountId(id))
          .filter((u): u is string => u != null)
        if (urls.length === 0) {
          backendFilter = { mode: 'all' }
        } else if (urls.length === 1) {
          backendFilter = { backendUrl: urls[0], mode: 'single' }
        } else {
          backendFilter = { backendUrls: urls, mode: 'composite' }
        }
      } else {
        backendFilter = { mode: 'all' }
      }

      const customQuery = nodesToWhere(v1ForExtract.filters)

      const updates: Partial<TimelineConfigV2> = {
        accountFilter: undefined,
        advancedQuery: true,
        applyInstanceBlock: applyBlock || undefined,
        applyMuteFilter: applyMute || undefined,
        backendFilter,
        customQuery: customQuery.trim() || undefined,
        excludeReblogs: undefined,
        excludeReplies: undefined,
        excludeSensitive: undefined,
        excludeSpoiler: undefined,
        followsOnly: undefined,
        label: label.trim() || undefined,
        languageFilter: undefined,
        minMediaCount: undefined,
        notificationFilter: undefined,
        onlyMedia: undefined,
        queryPlan: plan,
        tagConfig: undefined,
        timelineTypes: undefined,
        visibilityFilter: undefined,
      }

      onSave(updates)
      onOpenChange(false)
    },
    [label, onSave, onOpenChange, previewCtx],
  )

  const handleSave = useCallback(() => {
    onSave({ label: label.trim() || undefined })
  }, [label, onSave])

  const handleSaveFlow = useCallback(() => {
    handleFlowSave(currentPlanV2)
  }, [currentPlanV2, handleFlowSave])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 bg-gray-900 border-gray-700 flex flex-col overflow-hidden [&>button]:hidden">
        <DialogHeader className="px-4 py-3 border-b border-gray-700 shrink-0">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
              <DialogTitle className="text-white text-base font-bold flex items-center gap-2 shrink-0">
                <Filter className="h-5 w-5 text-cyan-400" />
                フローエディタ
              </DialogTitle>
              <label className="flex items-center gap-2 text-sm text-gray-300 min-w-0 flex-1 max-w-md">
                <span className="text-xs text-gray-500 shrink-0">
                  Display Name
                </span>
                <input
                  className="flex-1 min-w-0 rounded bg-gray-800 border border-gray-600 px-2 py-1 text-sm text-white"
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="空のときは自動名"
                  type="text"
                  value={label}
                />
              </label>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
                className="px-2 py-1.5 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 flex items-center gap-1"
                onClick={() => setShowMuteManager(true)}
                type="button"
              >
                <VolumeX className="h-3.5 w-3.5" />
                ミュート
              </button>
              <button
                className="px-2 py-1.5 rounded bg-gray-700 text-xs text-gray-300 hover:bg-gray-600 flex items-center gap-1"
                onClick={() => setShowBlockManager(true)}
                type="button"
              >
                <Shield className="h-3.5 w-3.5" />
                ブロック
              </button>
              <button
                className="px-3 py-1.5 rounded bg-gray-700 text-sm text-gray-300 hover:bg-gray-600 transition-colors"
                onClick={() => onOpenChange(false)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="px-3 py-1.5 rounded bg-slate-600 text-sm text-gray-200 hover:bg-slate-500"
                onClick={handleSave}
                type="button"
              >
                名前のみ保存
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-sm text-white hover:bg-blue-500 transition-colors flex items-center gap-1"
                disabled={!validation.valid}
                onClick={handleSaveFlow}
                type="button"
              >
                <Play className="h-3.5 w-3.5" />
                クエリを保存
              </button>
            </div>
          </div>
        </DialogHeader>

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

      {showMuteManager && (
        <MuteManager onClose={() => setShowMuteManager(false)} />
      )}
      {showBlockManager && (
        <InstanceBlockManager onClose={() => setShowBlockManager(false)} />
      )}
    </Dialog>
  )
}
