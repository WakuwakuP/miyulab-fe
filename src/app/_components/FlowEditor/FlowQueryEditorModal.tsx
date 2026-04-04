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
  BookTemplate,
  Filter,
  GitMerge,
  Link2,
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
import type { BackendFilter, TimelineConfigV2 } from 'types/types'
import { resolveBackendUrlFromAccountId } from 'util/accountResolver'
import type { ConfigToNodesContext } from 'util/db/query-ir/compat/configToNodes'
import { configToQueryPlan } from 'util/db/query-ir/compat/configToNodes'
import { topoSort } from 'util/db/query-ir/executor/topoSort'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import type { QueryPlanV2 } from 'util/db/query-ir/nodes'
import { isQueryPlanV2 } from 'util/db/query-ir/nodes'
import { migrateQueryPlanV1ToV2 } from 'util/db/query-ir/v2/migrateV1ToV2'
import { validateQueryPlanV2 } from 'util/db/query-ir/v2/validateV2'
import { getSqliteDb } from 'util/db/sqlite'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { DebugResultPanel } from './DebugResultPanel'
import { FlowCanvas, type ViewportCenterFn } from './FlowCanvas'
import { FLOW_PRESETS } from './flowPresets'
import { flowToQueryPlanV2 } from './flowToQueryPlanV2'
import { queryPlanToFlow } from './queryPlanToFlow'
import type {
  DebugResultItem,
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

// --------------- V2 plan analysis helpers ---------------

/** V2 plan の GetIds ノードから backendFilter を抽出する */
function extractBackendFilter(plan: QueryPlanV2): BackendFilter {
  for (const n of plan.nodes) {
    if (n.node.kind !== 'get-ids') continue
    const f = n.node.filters.find(
      (f) => 'column' in f && f.column === 'local_account_id' && f.op === 'IN',
    )
    if (!f || !('value' in f) || !f.value) continue
    const urls = (f.value as number[])
      .map((id) => resolveBackendUrlFromAccountId(id))
      .filter((u): u is string => u != null)
    if (urls.length === 0) return { mode: 'all' }
    if (urls.length === 1) return { backendUrl: urls[0], mode: 'single' }
    return { backendUrls: urls, mode: 'composite' }
  }
  return { mode: 'all' }
}

/** V2 plan から moderation (mute/block) 設定を検出する */
function extractModeration(plan: QueryPlanV2): {
  applyBlock: boolean
  applyMute: boolean
} {
  let hasMute = false
  let hasBlock = false
  for (const n of plan.nodes) {
    if (n.node.kind !== 'get-ids') continue
    for (const f of n.node.filters) {
      if ('mode' in f && f.mode === 'not-exists') {
        if (f.table === 'muted_accounts') hasMute = true
        if (f.table === 'blocked_instances') hasBlock = true
      }
    }
  }
  return { applyBlock: hasBlock, applyMute: hasMute }
}

/** V2 plan のノード構成をテキスト要約する */
function summarizeV2Plan(plan: QueryPlanV2): string {
  const lines: string[] = []
  for (const n of plan.nodes) {
    const { kind } = n.node
    switch (kind) {
      case 'get-ids': {
        const node = n.node
        const filterCount = node.filters.length
        lines.push(
          `[${n.id.slice(0, 8)}] GetIds(${node.table}) — ${filterCount} filters`,
        )
        break
      }
      case 'lookup-related': {
        const node = n.node
        lines.push(`[${n.id.slice(0, 8)}] LookupRelated(${node.lookupTable})`)
        break
      }
      case 'merge-v2': {
        const node = n.node
        lines.push(
          `[${n.id.slice(0, 8)}] Merge(${node.strategy}, limit=${node.limit})`,
        )
        break
      }
      case 'output-v2': {
        const node = n.node
        lines.push(
          `[${n.id.slice(0, 8)}] Output(${node.sort.direction}, limit=${node.pagination.limit})`,
        )
        break
      }
    }
  }
  const edgeLines = plan.edges.map(
    (e) => `  ${e.source.slice(0, 8)} → ${e.target.slice(0, 8)}`,
  )
  return `Nodes:\n${lines.join('\n')}\n\nEdges:\n${edgeLines.join('\n')}`
}

// --------------- デバッグ結果の抽出 ---------------

/** HTML タグを除去してプレーンテキスト化し、指定文字数で切り詰める */
function stripHtml(html: string, maxLen = 80): string {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

/** ms タイムスタンプを HH:mm 形式に変換 */
function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * GraphExecuteResult の生データから DebugResultItem[] を構築する。
 *
 * Post row layout (STATUS_BASE_SELECT):
 *   [0] post_id, [3] created_at_ms, [5] content_html,
 *   [11] is_reblog, [14] author_acct
 *
 * Notification row layout:
 *   [0] id, [2] created_at_ms, [3] notification_type,
 *   [6] actor_acct, [15] rp_content
 */
function buildDebugResults(
  displayOrder: { table: 'posts' | 'notifications'; id: number }[],
  postRows: (string | number | null)[][],
  notifRows: (string | number | null)[][],
): DebugResultItem[] {
  const postMap = new Map<number, (string | number | null)[]>()
  for (const row of postRows) postMap.set(row[0] as number, row)

  const notifMap = new Map<number, (string | number | null)[]>()
  for (const row of notifRows) notifMap.set(row[0] as number, row)

  const items: DebugResultItem[] = []
  for (const entry of displayOrder) {
    if (entry.table === 'posts') {
      const row = postMap.get(entry.id)
      if (!row) continue
      items.push({
        acct: (row[14] as string) ?? '',
        contentPreview: stripHtml((row[5] as string) ?? ''),
        createdAt: formatTime(row[3] as number),
        id: entry.id,
        isReblog: (row[11] as number) === 1,
        table: 'posts',
      })
    } else {
      const row = notifMap.get(entry.id)
      if (!row) continue
      items.push({
        actorAcct: (row[6] as string) ?? '',
        createdAt: formatTime(row[2] as number),
        id: entry.id,
        notificationType: (row[3] as string) ?? '',
        relatedContentPreview: stripHtml((row[15] as string) ?? ''),
        table: 'notifications',
      })
    }
  }
  return items
}

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
    }
  }, [open, config.label])

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
        label: label.trim() || undefined,
        queryPlan: plan,
      }

      onSave(updates)
      onOpenChange(false)
    },
    [label, onSave, onOpenChange],
  )

  const handleSave = useCallback(() => {
    onSave({ label: label.trim() || undefined })
  }, [label, onSave])

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

      // デバッグ結果を構築
      const debugResults = buildDebugResults(
        result.displayOrder,
        result.posts.detailRows,
        result.notifications.detailRows,
      )

      setExecStatus({
        debugResults,
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
  }, [validation.valid, currentPlanV2, apps])

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
            {execStatus?.debugResults && execStatus.debugResults.length > 0 && (
              <details className="mt-2 border-t border-gray-800 pt-1">
                <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-400 transition-colors">
                  テスト実行結果 ({execStatus.debugResults.length} 件)
                </summary>
                <div className="mt-1">
                  <DebugResultPanel results={execStatus.debugResults} />
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
