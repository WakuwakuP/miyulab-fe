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
  BookTemplate,
  Filter,
  Loader2,
  Play,
  Shield,
  VolumeX,
  Zap,
} from 'lucide-react'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { TimelineConfigV2 } from 'types/types'
import { topoSort } from 'util/db/query-ir/executor/topoSort'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import type { QueryPlanV2 } from 'util/db/query-ir/nodes'
import { validateQueryPlanV2 } from 'util/db/query-ir/v2/validateV2'
import { getSqliteDb } from 'util/db/sqlite'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { ADD_MENU_ITEMS, type AddMenuItem } from './addMenuItems'
import { DebugResultPanel } from './DebugResultPanel'
import { buildDebugResultsByNode } from './debugResultHelpers'
import { FlowCanvas, type ViewportCenterFn } from './FlowCanvas'
import { FLOW_PRESETS } from './flowPresets'
import { flowToQueryPlanV2 } from './flowToQueryPlanV2'
import {
  createDefaultQueryPlanV2,
  extractBackendFilter,
  extractModeration,
  planFromConfig,
  summarizeV2Plan,
} from './planHelpers'
import { queryPlanToFlow } from './queryPlanToFlow'
import type {
  FlowEdge,
  FlowExecStatus,
  FlowGraphState,
  FlowNode,
} from './types'

// --------------- Props ---------------

type FlowQueryEditorModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集対象のタイムライン設定 */
  config: TimelineConfigV2
  onSave: (updates: Partial<TimelineConfigV2>) => void
}

// --------------- Component ---------------

export function FlowQueryEditorModal({
  open,
  onOpenChange,
  config,
  onSave,
}: FlowQueryEditorModalProps) {
  const [label, setLabel] = useState(config.label ?? '')
  const [displayType, setDisplayType] = useState<'list' | 'media-grid'>(
    config.displayType ?? 'list',
  )
  const [showMuteManager, setShowMuteManager] = useState(false)
  const [showBlockManager, setShowBlockManager] = useState(false)

  const viewportCenterRef = useRef<ViewportCenterFn | null>(null)
  const addNodeCounterRef = useRef(0)
  const addJitterIndexRef = useRef(0)
  const prevOpenRef = useRef(false)

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
      setDisplayType(config.displayType ?? 'list')
    }
  }, [open, config.label, config.displayType])

  // モーダルが開いた瞬間のみフローを初期化する
  // resolvedPlanV2 の参照変更で再初期化しないようにする
  useEffect(() => {
    const justOpened = open && !prevOpenRef.current
    prevOpenRef.current = open
    if (!justOpened) return
    const flow = queryPlanToFlow(resolvedPlanV2)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    addNodeCounterRef.current = 0
    addJitterIndexRef.current = 0
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
    const id = `add-${++addNodeCounterRef.current}-${Date.now().toString(36)}`
    const center = viewportCenterRef.current
      ? viewportCenterRef.current()
      : { x: 300, y: 200 }
    const i = addJitterIndexRef.current++
    const j = { x: (i % 5) * 40, y: (i % 5) * 40 }
    const pos = { x: center.x + j.x, y: center.y + j.y }
    const newNode = item.createNode(id, pos)
    setNodes((nds) => [...nds, newNode])
  }, [])

  const handleLoadPreset = useCallback((presetId: string) => {
    const preset = FLOW_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const plan = preset.plan()
    const flow = queryPlanToFlow(plan)
    setNodes(flow.nodes)
    setEdges(flow.edges)
    addNodeCounterRef.current = 0
    addJitterIndexRef.current = 0
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

  const planSummary = useMemo(
    () => summarizeV2Plan(currentPlanV2),
    [currentPlanV2],
  )

  const handleFlowSave = useCallback(
    (plan: QueryPlanV2) => {
      const { applyBlock, applyMute } = extractModeration(plan)
      const backendFilter = extractBackendFilter(plan)

      const updates: Partial<TimelineConfigV2> = {
        advancedQuery: true,
        applyInstanceBlock: applyBlock || undefined,
        applyMuteFilter: applyMute || undefined,
        backendFilter,
        customQuery: undefined,
        displayType: displayType === 'list' ? undefined : displayType,
        label: label.trim() || undefined,
        queryPlan: plan,
      }

      onSave(updates)
      onOpenChange(false)
    },
    [displayType, label, onSave, onOpenChange],
  )

  const handleSave = useCallback(() => {
    onSave({
      displayType: displayType === 'list' ? undefined : displayType,
      label: label.trim() || undefined,
    })
  }, [displayType, label, onSave])

  const handleSaveFlow = useCallback(() => {
    handleFlowSave(currentPlanV2)
  }, [currentPlanV2, handleFlowSave])

  // --------------- テスト実行 ---------------

  const apps = useContext(AppsContext)
  const [execStatus, setExecStatus] = useState<FlowExecStatus | null>(null)

  const handleTestExec = useCallback(async () => {
    if (!validation.valid) return

    const plan = currentPlanV2

    // ノード実行順序を取得
    let order: string[]
    try {
      order = topoSort(plan)
    } catch {
      setExecStatus({
        error: 'トポロジカルソートに失敗しました',
        nodeStates: {},
        nodeStats: {},
        running: false,
        totalDurationMs: null,
      })
      return
    }

    // 初期状態: 全ノード idle
    const initStates: Record<string, 'idle' | 'running' | 'done' | 'error'> = {}
    for (const nId of order) initStates[nId] = 'idle'

    setExecStatus({
      error: null,
      nodeStates: initStates,
      nodeStats: {},
      running: true,
      totalDurationMs: null,
    })

    // 全ノードを running 表示にする (実際の実行は Worker 内で一括)
    const runningStates = { ...initStates }
    for (const nId of order) runningStates[nId] = 'running'
    setExecStatus((prev) =>
      prev ? { ...prev, nodeStates: runningStates } : prev,
    )

    try {
      // backendUrls を解決
      const backendFilter = extractBackendFilter(plan)
      const normalized = normalizeBackendFilter(backendFilter, apps)
      const backendUrls = resolveBackendUrls(normalized, apps)

      const handle = await getSqliteDb()
      const result = await handle.executeGraphPlan(
        plan as unknown as SerializedGraphPlan,
        { backendUrls },
      )

      // 結果から各ノードの状態を構築
      const doneStates: Record<string, 'idle' | 'running' | 'done' | 'error'> =
        {}
      for (const nId of order) {
        doneStates[nId] = result.meta.nodeStats[nId] ? 'done' : 'idle'
      }

      // デバッグ結果をノード別に構築
      const debugResultsByNode = buildDebugResultsByNode(
        result.nodeOutputIds,
        result.posts.detailRows,
        result.notifications.detailRows,
        nodes,
      )

      setExecStatus({
        debugResultsByNode,
        error: null,
        nodeStates: doneStates,
        nodeStats: result.meta.nodeStats,
        running: false,
        totalDurationMs: result.meta.totalDurationMs,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '実行エラー'
      // エラー時は全ノードを error にする
      const errorStates: Record<string, 'idle' | 'running' | 'done' | 'error'> =
        {}
      for (const nId of order) errorStates[nId] = 'error'
      setExecStatus({
        error: msg,
        nodeStates: errorStates,
        nodeStats: {},
        running: false,
        totalDurationMs: null,
      })
    }
  }, [validation.valid, currentPlanV2, apps, nodes])

  // モーダル閉じたら実行状態リセット
  useEffect(() => {
    if (!open) setExecStatus(null)
  }, [open])

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
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-gray-500">表示:</span>
                <button
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    displayType === 'list'
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  onClick={() => setDisplayType('list')}
                  title="リスト表示"
                  type="button"
                >
                  📋 リスト
                </button>
                <button
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    displayType === 'media-grid'
                      ? 'bg-blue-700 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                  onClick={() => setDisplayType('media-grid')}
                  title="メディアグリッド表示"
                  type="button"
                >
                  🖼 グリッド
                </button>
              </div>
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
                className="px-2 py-1.5 rounded bg-amber-700 text-xs text-amber-100 hover:bg-amber-600 flex items-center gap-1 disabled:opacity-50"
                disabled={!validation.valid || (execStatus?.running ?? false)}
                onClick={handleTestExec}
                title="現在のフローをテスト実行"
                type="button"
              >
                {execStatus?.running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                テスト実行
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

          <span className="mx-1 text-gray-700 shrink-0">|</span>

          <span className="text-xs text-gray-500 mr-1 shrink-0">
            <BookTemplate className="h-3 w-3 inline mr-0.5" />
            サンプル:
          </span>
          {FLOW_PRESETS.map((preset) => (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-950/40 border border-indigo-800/40 text-xs text-indigo-300 hover:bg-indigo-900/50 hover:border-indigo-700/50 transition-colors whitespace-nowrap shrink-0"
              key={preset.id}
              onClick={() => handleLoadPreset(preset.id)}
              title={preset.description}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0">
          <ReactFlowProvider>
            <FlowCanvas
              edges={edges}
              execStatus={execStatus}
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
              プラン概要
              {execStatus?.totalDurationMs != null && (
                <span className="ml-2 text-emerald-400">
                  (実行済: {execStatus.totalDurationMs.toFixed(0)}ms)
                </span>
              )}
              {execStatus?.error && (
                <span className="ml-2 text-red-400">
                  (エラー: {execStatus.error})
                </span>
              )}
            </summary>
            <pre className="mt-1 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto">
              {planSummary}
            </pre>
            {execStatus &&
              !execStatus.running &&
              Object.keys(execStatus.nodeStats).length > 0 && (
                <div className="mt-2 border-t border-gray-800 pt-1">
                  <div className="text-[10px] text-gray-500 mb-1">
                    ノード実行統計:
                  </div>
                  {Object.entries(execStatus.nodeStats).map(([nId, s]) => (
                    <div
                      className="text-[10px] text-gray-400 font-mono"
                      key={nId}
                    >
                      [{nId.slice(0, 8)}] {s.rowCount} 件 /{' '}
                      {s.durationMs.toFixed(1)}ms
                      {s.cacheHit ? ' 💾cache' : ''}
                    </div>
                  ))}
                </div>
              )}
            {execStatus?.debugResultsByNode &&
              execStatus.debugResultsByNode.length > 0 && (
                <details className="mt-2 border-t border-gray-800 pt-1">
                  <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-400 transition-colors">
                    テスト実行結果 (
                    {execStatus.debugResultsByNode.reduce(
                      (sum, n) => sum + n.items.length,
                      0,
                    )}{' '}
                    件 / {execStatus.debugResultsByNode.length} ノード)
                  </summary>
                  <div className="mt-1">
                    <DebugResultPanel
                      nodeResults={execStatus.debugResultsByNode}
                    />
                  </div>
                </details>
              )}
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
