'use client'

// ============================================================
// FlowCanvas — React Flow キャンバス (controlled)
// ============================================================
//
// 状態は親 (FlowQueryEditorModal) が管理する。
// FlowActionsContext 経由でカスタムノードから削除等の操作を行う。
// viewportCenterRef 経由で親がビューポート中央座標を取得できる。

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
  getBezierPath,
  MiniMap,
  type NodeTypes,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
  ReactFlow,
  type ReactFlowInstance,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { FlowNodePanel } from './FlowNodePanel'
import {
  FilterFlowNode,
  MergeFlowNode,
  OutputFlowNode,
  SourceFlowNode,
} from './nodes'
import type { FlowEdge, FlowNode } from './types'

// --------------- FlowActions Context ---------------

export type FlowActions = {
  deleteNode: (id: string) => void
}

const FlowActionsContext = createContext<FlowActions>({
  deleteNode: () => {},
})

export function useFlowActions(): FlowActions {
  return useContext(FlowActionsContext)
}

// --------------- Custom edge with delete button ---------------

function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [edgePath, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  })

  return (
    <>
      <BaseEdge
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#60a5fa' : (style?.stroke ?? '#4b5563'),
          strokeWidth: selected ? 3 : (style?.strokeWidth ?? 2),
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <button
              className="flex items-center justify-center w-5 h-5 rounded-full bg-red-600 text-white text-xs hover:bg-red-500 shadow-md transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                deleteElements({ edges: [{ id }] })
              }}
              type="button"
            >
              ×
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// --------------- Node / Edge type registries ---------------

const nodeTypes: NodeTypes = {
  filter: FilterFlowNode,
  merge: MergeFlowNode,
  output: OutputFlowNode,
  source: SourceFlowNode,
}

const edgeTypes: EdgeTypes = {
  deletable: DeletableEdge,
}

// --------------- Props ---------------

export type ViewportCenterFn = () => { x: number; y: number }

type FlowCanvasProps = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  onNodesChange: OnNodesChange
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect
  onDeleteNode: (id: string) => void
  onUpdateNodeData: (id: string, data: FlowNode['data']) => void
  /** 親がビューポート中央のフロー座標を取得するための ref */
  viewportCenterRef?: React.MutableRefObject<ViewportCenterFn | null>
}

// --------------- Inner component (inside ReactFlow) ---------------

/**
 * ReactFlow の子として描画され、useReactFlow() で
 * screenToFlowPosition を取得し viewportCenterRef を更新する。
 */
function ViewportCenterBridge({
  viewportCenterRef,
}: {
  viewportCenterRef?: React.MutableRefObject<ViewportCenterFn | null>
}) {
  const { screenToFlowPosition } = useReactFlow()

  useEffect(() => {
    if (!viewportCenterRef) return
    viewportCenterRef.current = () => {
      try {
        const el = document.querySelector('.flow-canvas-root')
        if (el) {
          const rect = el.getBoundingClientRect()
          return screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          })
        }
      } catch {
        // screenToFlowPosition may throw if instance not ready
      }
      return { x: 300, y: 200 }
    }
  }, [screenToFlowPosition, viewportCenterRef])

  return null
}

// --------------- Component ---------------

export function FlowCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDeleteNode,
  onUpdateNodeData,
  viewportCenterRef,
}: FlowCanvasProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [didInitialFit, setDidInitialFit] = useState(false)

  const handleNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    setSelectedNodeId(node.id)
  }, [])

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const flowActions = useMemo<FlowActions>(
    () => ({ deleteNode: onDeleteNode }),
    [onDeleteNode],
  )

  // fitView は初回のみ実行し、以降はノード追加で勝手にビューが動かないようにする
  const handleInit = useCallback(
    (instance: ReactFlowInstance<FlowNode, FlowEdge>) => {
      if (!didInitialFit) {
        instance.fitView({ padding: 0.2 })
        setDidInitialFit(true)
      }
    },
    [didInitialFit],
  )

  return (
    <FlowActionsContext value={flowActions}>
      <div className="flex h-full">
        <div className="flex-1 relative flow-canvas-root">
          <ReactFlow
            defaultEdgeOptions={{
              style: { stroke: '#4b5563', strokeWidth: 2 },
              type: 'deletable',
            }}
            deleteKeyCode="Backspace"
            edges={edges}
            edgesFocusable
            edgeTypes={edgeTypes}
            nodes={nodes}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onInit={handleInit}
            onNodeClick={handleNodeClick}
            onNodesChange={onNodesChange}
            onPaneClick={handlePaneClick}
            proOptions={{ hideAttribution: true }}
            snapGrid={[20, 20]}
            snapToGrid
          >
            <ViewportCenterBridge viewportCenterRef={viewportCenterRef} />
            <Background
              color="#374151"
              gap={20}
              size={1}
              variant={BackgroundVariant.Dots}
            />
            <Controls
              className="!bg-gray-800 !border-gray-700 !shadow-lg"
              showInteractive={false}
            />
            <MiniMap
              className="!bg-gray-900 !border-gray-700"
              maskColor="rgba(0,0,0,0.6)"
              nodeColor="#4b5563"
            />
          </ReactFlow>
          {/* React Flow デフォルトノードスタイルの上書き */}
          <style>{`
            .flow-canvas-root .react-flow__node {
              background: transparent !important;
              border: none !important;
              border-radius: 0 !important;
              padding: 0 !important;
              box-shadow: none !important;
              outline: none !important;
            }
            .flow-canvas-root .react-flow__node.selected,
            .flow-canvas-root .react-flow__node:focus,
            .flow-canvas-root .react-flow__node:focus-visible {
              outline: none !important;
              box-shadow: none !important;
            }
            .flow-canvas-root .react-flow__edge {
              cursor: pointer;
            }
          `}</style>
        </div>
        {selectedNode && (
          <FlowNodePanel
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onDelete={() => {
              if (selectedNodeId) onDeleteNode(selectedNodeId)
              setSelectedNodeId(null)
            }}
            onUpdate={onUpdateNodeData}
          />
        )}
      </div>
    </FlowActionsContext>
  )
}
