'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getSnapshots,
  type QueueSnapshot,
  subscribeQueueStats,
} from 'util/db/dbQueue'

// ================================================================
// 定数
// ================================================================

const GRAPH_WIDTH = 400
const GRAPH_HEIGHT = 120
const PADDING = { bottom: 20, left: 36, right: 12, top: 12 }
const PLOT_W = GRAPH_WIDTH - PADDING.left - PADDING.right
const PLOT_H = GRAPH_HEIGHT - PADDING.top - PADDING.bottom

const WRITE_COLOR = '#f97316' // orange-500
const READ_COLOR = '#3b82f6' // blue-500
const GRID_COLOR = '#374151' // gray-700
const LABEL_COLOR = '#9ca3af' // gray-400

// ================================================================
// ユーティリティ
// ================================================================

/**
 * スナップショット配列を SVG polyline の points 文字列に変換する。
 */
function toPolylinePoints(
  data: readonly QueueSnapshot[],
  getValue: (s: QueueSnapshot) => number,
  maxY: number,
  timeMin: number,
  timeRange: number,
): string {
  if (data.length === 0) return ''
  return data
    .map((s) => {
      const x =
        PADDING.left +
        (timeRange > 0 ? ((s.time - timeMin) / timeRange) * PLOT_W : PLOT_W)
      const y =
        PADDING.top + (maxY > 0 ? (1 - getValue(s) / maxY) * PLOT_H : PLOT_H)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ================================================================
// コンポーネント
// ================================================================

export const QueueStatsGraph = () => {
  const [snapshots, setSnapshots] = useState<readonly QueueSnapshot[]>([])
  const mountedRef = useRef(false)

  const refresh = useCallback(() => {
    if (!mountedRef.current) return
    setSnapshots(getSnapshots())
  }, [])

  useEffect(() => {
    mountedRef.current = true
    // 初回読み込み
    refresh()
    const unsub = subscribeQueueStats(refresh)
    return () => {
      mountedRef.current = false
      unsub()
    }
  }, [refresh])

  // Y 軸の最大値を算出
  const maxY = Math.max(1, ...snapshots.map((s) => Math.max(s.write, s.read)))

  // 時間範囲
  const timeMin = snapshots.length > 0 ? snapshots[0].time : 0
  const timeLast =
    snapshots.length > 0 ? snapshots[snapshots.length - 1].time : 0
  const timeRange = timeLast - timeMin

  // Y 軸のグリッド線 (0, maxY/2, maxY)
  const yTicks = [0, Math.ceil(maxY / 2), maxY]

  // 処理済み数（直近 vs 最初のスナップショット）
  const firstSnap = snapshots[0]
  const lastSnap = snapshots[snapshots.length - 1]
  const writeDelta =
    firstSnap && lastSnap
      ? lastSnap.writeProcessed - firstSnap.writeProcessed
      : 0
  const readDelta =
    firstSnap && lastSnap ? lastSnap.readProcessed - firstSnap.readProcessed : 0

  const writePoints = toPolylinePoints(
    snapshots,
    (s) => s.write,
    maxY,
    timeMin,
    timeRange,
  )
  const readPoints = toPolylinePoints(
    snapshots,
    (s) => s.read,
    maxY,
    timeMin,
    timeRange,
  )

  // 時間ラベル (秒表記)
  const timeLabels: { label: string; x: number }[] = []
  if (timeRange > 0) {
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const t = timeMin + (timeRange * i) / steps
      const x = PADDING.left + (PLOT_W * i) / steps
      const sec = ((t - timeLast) / 1000).toFixed(0)
      timeLabels.push({ label: `${sec}s`, x })
    }
  }

  return (
    <div className="p-2 pt-4">
      <h3 className="pb-2 text-lg font-bold">Queue Stats</h3>

      {/* 凡例 */}
      <div className="flex gap-4 pb-2 text-xs">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: WRITE_COLOR }}
          />
          Write ({lastSnap?.write ?? 0} queued / {writeDelta} processed)
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={{ backgroundColor: READ_COLOR }}
          />
          Read ({lastSnap?.read ?? 0} queued / {readDelta} processed)
        </span>
      </div>

      {/* SVG グラフ */}
      <svg
        aria-label="Queue stats graph showing write and read queue sizes over time"
        className="w-full"
        role="img"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* グリッド線 + Y 軸ラベル */}
        {yTicks.map((tick) => {
          const y =
            PADDING.top + (maxY > 0 ? (1 - tick / maxY) * PLOT_H : PLOT_H)
          return (
            <g key={tick}>
              <line
                stroke={GRID_COLOR}
                strokeDasharray="2,2"
                x1={PADDING.left}
                x2={GRAPH_WIDTH - PADDING.right}
                y1={y}
                y2={y}
              />
              <text
                fill={LABEL_COLOR}
                fontSize="9"
                textAnchor="end"
                x={PADDING.left - 4}
                y={y + 3}
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* 時間軸ラベル */}
        {timeLabels.map(({ label, x }) => (
          <text
            fill={LABEL_COLOR}
            fontSize="8"
            key={label}
            textAnchor="middle"
            x={x}
            y={GRAPH_HEIGHT - 4}
          >
            {label}
          </text>
        ))}

        {/* Write ライン */}
        {writePoints && (
          <polyline
            fill="none"
            points={writePoints}
            stroke={WRITE_COLOR}
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        )}

        {/* Read ライン */}
        {readPoints && (
          <polyline
            fill="none"
            points={readPoints}
            stroke={READ_COLOR}
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  )
}
