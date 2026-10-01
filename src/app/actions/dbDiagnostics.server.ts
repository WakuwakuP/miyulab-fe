'use server'

import { isDbDiagnosticOwnerAuthenticated } from 'app/actions/dbDiagnosticsAuth.server'
import type { DbDiagnosticSaveResult } from 'util/db/dbDiagnosticTransport'
import {
  DB_DIAGNOSTIC_BATCH_SIZE,
  DB_DIAGNOSTIC_MAX_BYTES,
  type DbDiagnosticWindow,
  dbDiagnosticMarker,
  isDbDiagnosticSessionId,
  sanitizeDbDiagnosticWindow,
} from 'util/db/dbDiagnosticTypes'
import { getNeonClient } from 'util/db/neon/client'

let lastSaveAt = 0
let lastReadAt = 0

export async function createDbDiagnosticLogs(
  sessionId: unknown,
  input: unknown,
): Promise<DbDiagnosticSaveResult> {
  if (process.env.DB_DIAGNOSTICS_ENABLED === 'false')
    return { error: 'Diagnostics are disabled', success: false }
  if (!(await isDbDiagnosticOwnerAuthenticated()))
    return { error: 'Owner authorization required', success: false }
  if (
    !isDbDiagnosticSessionId(sessionId) ||
    !Array.isArray(input) ||
    !input.length ||
    input.length > DB_DIAGNOSTIC_BATCH_SIZE
  ) {
    return { error: 'Invalid diagnostic batch', success: false }
  }
  const windows: DbDiagnosticWindow[] = []
  for (const value of input) {
    const window = sanitizeDbDiagnosticWindow(value)
    if (!window) return { error: 'Invalid diagnostic window', success: false }
    windows.push(window)
  }
  if (
    new Set(windows.map((window) => window.sequence)).size !== windows.length
  ) {
    return { error: 'Duplicate diagnostic sequence', success: false }
  }
  const now = Date.now()
  if (now - lastSaveAt < 1_000) return { error: 'Rate limited', success: false }
  lastSaveAt = now
  const client = getNeonClient()
  if (!client)
    return { error: 'DATABASE_URL is not configured', success: false }
  const marker = dbDiagnosticMarker(sessionId)
  try {
    const saved = await client.queryLog.createMany({
      data: windows.map((window) => ({
        bind: JSON.stringify(window),
        durationMs: 0,
        explainPlan: null,
        id: `${sessionId.toLowerCase()}:${String(window.sequence).padStart(10, '0')}`,
        sql: marker,
        userAgent: null,
      })),
      skipDuplicates: true,
    })
    return { accepted: windows.length, count: saved.count, success: true }
  } catch {
    return { error: 'Failed to save diagnostics', success: false }
  }
}

type ReadResult =
  | {
      success: true
      windows: DbDiagnosticWindow[]
      truncated: boolean
      invalidWindows: number
    }
  | { success: false; error: string }

function parseStoredDiagnosticWindow(
  bind: string | null | undefined,
): DbDiagnosticWindow | null {
  if (!bind || bind.length > DB_DIAGNOSTIC_MAX_BYTES) return null
  try {
    return sanitizeDbDiagnosticWindow(JSON.parse(bind))
  } catch {
    return null
  }
}

export async function getDbDiagnosticLogs(
  sessionId: unknown,
): Promise<ReadResult> {
  if (process.env.DB_DIAGNOSTICS_ENABLED === 'false')
    return { error: 'Diagnostics are disabled', success: false }
  if (!(await isDbDiagnosticOwnerAuthenticated()))
    return { error: 'Owner authorization required', success: false }
  if (!isDbDiagnosticSessionId(sessionId))
    return { error: 'Invalid diagnostic session', success: false }
  const now = Date.now()
  if (now - lastReadAt < 1_000) return { error: 'Rate limited', success: false }
  lastReadAt = now
  const client = getNeonClient()
  if (!client)
    return { error: 'DATABASE_URL is not configured', success: false }
  try {
    const rows = await client.queryLog.findMany({
      orderBy: { id: 'desc' },
      select: { bind: true },
      take: 501,
      where: {
        id: {
          gte: `${sessionId.toLowerCase()}:0000000000`,
          lte: `${sessionId.toLowerCase()}:9999999999`,
        },
        sql: dbDiagnosticMarker(sessionId),
      },
    })
    const windows: DbDiagnosticWindow[] = []
    let invalidWindows = 0
    for (const row of rows.slice(0, 500)) {
      const window = parseStoredDiagnosticWindow(row.bind)
      if (window) windows.push(window)
      else invalidWindows++
    }
    return {
      invalidWindows,
      success: true,
      truncated: rows.length > 500,
      windows,
    }
  } catch {
    return { error: 'Failed to read diagnostics', success: false }
  }
}
