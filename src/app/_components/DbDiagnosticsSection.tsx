'use client'

import { getDbDiagnosticLogs } from 'app/actions/dbDiagnostics.server'
import { useDbDiagnosticUploader } from 'hooks/useDbDiagnosticUploader'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzeDbDiagnosticWindows,
  type DbDiagnosticAnalysis,
  type DbDiagnosticOperationReport,
} from 'util/db/dbDiagnostics'
import {
  type DbDiagnosticWindow,
  isDbDiagnosticSessionId,
} from 'util/db/dbDiagnosticTypes'
import {
  ensureDbDiagnosticAuthorization,
  isDbDiagnosticsClientEnabled,
} from 'util/db/dbDiagnosticUploader'

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'loaded'
      analysis: DbDiagnosticAnalysis
      invalidWindows: number
      truncated: boolean
      windows: DbDiagnosticWindow[]
    }

function fmtMs(value: number | null | undefined): string {
  return value == null ? '-' : `${value.toFixed(1)} ms`
}

function OperationReportRow({
  report,
}: {
  report: DbDiagnosticOperationReport
}) {
  const op = report.operation
  return (
    <tr className="border-b border-gray-700 text-left align-top">
      <td className="py-1 pr-2">
        {op.requestType}
        <div className="text-gray-500 text-xs">
          {op.kind} / {op.sourceId} / {op.timelineType}
        </div>
      </td>
      <td className="px-2 py-1">{op.receivedItems}</td>
      <td className="px-2 py-1">
        {op.enqueued} / {op.requestedItems}
        <div className="text-gray-500 text-xs">
          {op.started} started / {op.succeeded + op.failed} done / {op.failed}{' '}
          err / {op.timedOut} to / {op.cancelled} cx
        </div>
      </td>
      <td className="px-2 py-1">
        {fmtMs(report.averageWaitMs)} / {op.queueWaitMaxMs.toFixed(1)} ms
      </td>
      <td className="px-2 py-1">
        {fmtMs(report.averageServiceMs)} / {op.serviceMaxMs.toFixed(1)} ms
      </td>
      <td className="px-2 py-1">
        {fmtMs(report.averageWorkerMs)} / {op.workerMaxMs.toFixed(1)} ms
      </td>
      <td className="px-2 py-1">
        {op.sqlCalls} / {op.sqlTimeMs.toFixed(1)} ms / {op.resultRows} rows
        <div className="text-gray-500 text-xs">
          hit {op.cacheHits ?? 0} / miss {op.cacheMisses ?? 0}
        </div>
      </td>
      <td className="px-2 py-1">
        {report.arrivalPerSecond.toFixed(2)} /{' '}
        {report.completionPerSecond.toFixed(2)}
      </td>
      <td className="px-2 py-1 text-gray-500 text-xs">
        tl {op.cleanupTimelineDeleted ?? 0} nt{' '}
        {op.cleanupNotificationsDeleted ?? 0} ps {op.cleanupPostsDeleted ?? 0}
        <div>
          timeline {fmtMs(op.cleanupTimelineMs)} / notification{' '}
          {fmtMs(op.cleanupNotificationsMs)} / postsCount{' '}
          {fmtMs(op.cleanupPostsCountMs)} / postsDelete{' '}
          {fmtMs(op.cleanupPostsDeleteMs)} / total {fmtMs(op.cleanupTotalMs)}
        </div>
      </td>
    </tr>
  )
}

function WindowRow({ window }: { window: DbDiagnosticWindow }) {
  return (
    <tr className="border-b border-gray-700 text-left">
      <td className="py-1 pr-2">#{window.sequence}</td>
      <td className="px-2 py-1">
        {new Date(window.capturedAt).toLocaleTimeString()}
      </td>
      <td className="px-2 py-1">
        {window.queue.priority}/{window.queue.other}/{window.queue.timeline}
      </td>
      <td className="px-2 py-1">
        {window.queueMax.priority}/{window.queueMax.other}/
        {window.queueMax.timeline}
      </td>
      <td className="px-2 py-1">
        {window.active
          ? `${window.active.requestType} ${window.active.elapsedMs.toFixed(0)} ms`
          : '-'}
      </td>
    </tr>
  )
}

const LOAD_TIMEOUT_MS = 30_000

export function DbDiagnosticsSection() {
  const status = useDbDiagnosticUploader()
  const [sessionInput, setSessionInput] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' })
  const requestSeq = useRef(0)

  useEffect(() => {
    return () => {
      requestSeq.current++
    }
  }, [])

  const onLoad = useCallback(async (sessionIdRaw: string) => {
    const sessionId = sessionIdRaw.trim()
    const seq = ++requestSeq.current
    if (!isDbDiagnosticSessionId(sessionId)) {
      setLoadState({
        message: 'セッション ID の形式が不正です',
        status: 'error',
      })
      return
    }
    setLoadState({ status: 'loading' })
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        (async () => {
          await ensureDbDiagnosticAuthorization()
          return getDbDiagnosticLogs(sessionId)
        })(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('読み込みがタイムアウトしました')),
            LOAD_TIMEOUT_MS,
          )
        }),
      ])
      if (seq !== requestSeq.current) return
      if (!result.success) {
        setLoadState({ message: result.error, status: 'error' })
        return
      }
      const analysis = analyzeDbDiagnosticWindows(result.windows)
      setLoadState({
        analysis,
        invalidWindows: result.invalidWindows,
        status: 'loaded',
        truncated: result.truncated,
        windows: result.windows,
      })
    } catch (error) {
      if (seq !== requestSeq.current) return
      setLoadState({
        message: error instanceof Error ? error.message : String(error),
        status: 'error',
      })
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [])

  const onLoadCurrentSession = useCallback(() => {
    const sessionId = status?.sessionId
    if (!sessionId) return
    setSessionInput(sessionId)
    void onLoad(sessionId)
  }, [onLoad, status?.sessionId])

  if (!isDbDiagnosticsClientEnabled()) return null

  return (
    <div className="mt-3 text-sm text-gray-300">
      <p className="mb-1 font-semibold text-gray-400">DB 診断</p>
      <div className="text-gray-400 text-xs">
        セッション: {status?.sessionId ?? '-'}
        {status && (
          <>
            {' / '}保存 {status.savedWindows} / 待機 {status.pendingWindows}
            {status.uploading ? ' / 送信中' : ''}
            {status.lastError ? ` / エラー: ${status.lastError}` : ''}
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="db-diagnostics-session-input">
          過去セッション UUID
        </label>
        <input
          className="min-w-0 flex-1 basis-full rounded border border-gray-600 bg-transparent px-2 py-1 text-xs"
          id="db-diagnostics-session-input"
          onChange={(e) => {
            requestSeq.current++
            setLoadState({ status: 'idle' })
            setSessionInput(e.target.value)
          }}
          placeholder="過去セッション UUID"
          type="text"
          value={sessionInput}
        />
        <button
          className="rounded border border-gray-600 px-3 py-1 text-xs disabled:opacity-50"
          disabled={!status?.sessionId}
          onClick={onLoadCurrentSession}
          type="button"
        >
          現在のセッション
        </button>
        <button
          className="rounded border border-gray-600 px-3 py-1 text-xs disabled:opacity-50"
          disabled={loadState.status === 'loading'}
          onClick={() => void onLoad(sessionInput)}
          type="button"
        >
          Load
        </button>
      </div>

      {loadState.status === 'loading' && (
        <p className="mt-2 text-gray-400 text-xs">読み込み中…</p>
      )}
      {loadState.status === 'error' && (
        <p className="mt-2 text-red-400 text-xs">{loadState.message}</p>
      )}
      {loadState.status === 'loaded' && (
        <div className="mt-2">
          {loadState.analysis.windows === 0 ? (
            <p className="text-gray-400 text-xs">診断データがありません</p>
          ) : (
            <>
              <p className="text-gray-400 text-xs">
                {loadState.analysis.windows} 窓 /{' '}
                {(loadState.analysis.intervalMs / 1000).toFixed(1)} 秒
                {loadState.truncated && ' / 最新500窓に制限'}
                {loadState.invalidWindows > 0 &&
                  ` / 不正 ${loadState.invalidWindows} 行`}
                {loadState.analysis.missingSequences > 0 &&
                  ` / 欠落 ${loadState.analysis.missingSequences} 窓`}
                {loadState.analysis.droppedEvents +
                  loadState.analysis.droppedWindows +
                  loadState.analysis.transportFailures >
                  0 &&
                  ` / 破棄イベント ${loadState.analysis.droppedEvents}・窓 ${loadState.analysis.droppedWindows}・送信失敗 ${loadState.analysis.transportFailures}`}
              </p>
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-600 text-gray-500">
                      <th className="py-1 pr-2">種別</th>
                      <th className="px-2 py-1">入力</th>
                      <th className="px-2 py-1">件数</th>
                      <th className="px-2 py-1">待機 平均/最大</th>
                      <th className="px-2 py-1">処理 平均/最大</th>
                      <th className="px-2 py-1">Worker 平均/最大</th>
                      <th className="px-2 py-1">SQL 回数/時間/行</th>
                      <th className="px-2 py-1">記録区間内 /秒</th>
                      <th className="px-2 py-1">削除/時間</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadState.analysis.operationReports.map((report) => (
                      <OperationReportRow
                        key={[
                          report.operation.kind,
                          report.operation.requestType,
                          report.operation.sourceId,
                          report.operation.timelineType,
                          report.operation.sqlVerb,
                        ].join(':')}
                        report={report}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-gray-500 text-xs">
                  10 秒窓シリーズ（キュー p/o/t）
                </summary>
                <div className="mt-1 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-600 text-gray-500">
                        <th className="py-1 pr-2">#</th>
                        <th className="px-2 py-1">時刻</th>
                        <th className="px-2 py-1">キュー</th>
                        <th className="px-2 py-1">最大</th>
                        <th className="px-2 py-1">アクティブ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...loadState.windows]
                        .sort((a, b) => b.sequence - a.sequence)
                        .map((window) => (
                          <WindowRow key={window.sequence} window={window} />
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  )
}
